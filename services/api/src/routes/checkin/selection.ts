import type { FastifyInstance } from 'fastify';
import { optionalAuth, requireAuth } from '../../auth/middleware';
import { requireKioskTokenOrStaff } from '../../auth/kioskToken';
import { getHttpError } from '../../checkin/utils';
import { db } from '../../db';
import { getLaneSessionById, getActiveLaneSession } from '../../checkin/helpers';
import type {
  SelectionAcknowledgedPayload,
  SelectionLockedPayload,
  SelectionProposedPayload,
} from '@the-clubs/shared';
import { HttpError } from '../../errors/HttpError';
import {
  selectRental,
  proposeSelection,
  setWaitlistDesired,
  confirmSelection,
  acknowledgeSelection,
  buildSessionPayload,
} from '../../services/selectionService';

function isFlowCommandsEnabled(): boolean {
  return process.env.FLOW_COMMANDS === 'true';
}

async function dispatchProposeSelectionCommand(
  fastify: FastifyInstance, request: any, reply: any, laneId: string, proposedBy: string, rentalType: string
) {
  const session = await db.transaction(async (tx) => getActiveLaneSession(tx, laneId));
  if (session.status !== 'ACTIVE' && session.status !== 'AWAITING_ASSIGNMENT') {
    throw new HttpError(400, 'Session must be ACTIVE or AWAITING_ASSIGNMENT');
  }

  const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `prop-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fastify.inject({
    method: 'POST', url: `/v1/checkin/lane/${laneId}/flow-command`,
    headers: { ...(request.headers.authorization ? { authorization: String(request.headers.authorization) } : {}), ...(request.headers['x-kiosk-token'] ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) } : {}) },
    payload: { sessionId: session.id, commandId, actor: proposedBy, expectedFlowVersion: session.flow_version ?? 0, type: 'PROPOSE_SELECTION', payload: { rentalType } },
  });
  if (response.statusCode !== 200) return reply.status(response.statusCode).send(response.json());
  return reply.send({ sessionId: session.id, proposedRentalType: rentalType, proposedBy });
}

async function dispatchWaitlistDesiredCommand(
  fastify: FastifyInstance, request: any, reply: any, laneId: string, body: any
) {
  const session = await db.transaction(async (tx) => {
    return body.sessionId
      ? getLaneSessionById(tx, body.sessionId)
      : getActiveLaneSession(tx, laneId);
  });
  if (body.sessionId && session.lane_id !== laneId) {
    throw new HttpError(404, 'No active session found');
  }

  const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `wl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fastify.inject({
    method: 'POST', url: `/v1/checkin/lane/${laneId}/flow-command`,
    headers: { ...(request.headers.authorization ? { authorization: String(request.headers.authorization) } : {}), ...(request.headers['x-kiosk-token'] ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) } : {}) },
    payload: {
      sessionId: session.id, commandId, actor: request.staff ? 'EMPLOYEE' : 'CUSTOMER',
      expectedFlowVersion: session.flow_version ?? 0, type: 'WAITLIST_UPDATE',
      payload: { waitlistDesiredType: body.waitlistDesiredType, waitlistDesiredTypes: body.waitlistDesiredTypes ?? [], waitlistRequestedResourceNumber: body.waitlistRequestedResourceNumber, waitlistRequestedResourceType: body.waitlistRequestedResourceType, backupRentalType: body.backupRentalType },
    },
  });
  if (response.statusCode !== 200) return reply.status(response.statusCode).send(response.json());
  return reply.send({ success: true });
}

async function dispatchConfirmSelectionCommand(
  fastify: FastifyInstance, request: any, reply: any, laneId: string, confirmedBy: string
) {
  const session = await db.transaction(async (tx) => getActiveLaneSession(tx, laneId));
  if (session.status !== 'ACTIVE' && session.status !== 'AWAITING_ASSIGNMENT') {
    throw new HttpError(400, 'Session must be ACTIVE or AWAITING_ASSIGNMENT');
  }
  const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `conf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await fastify.inject({
    method: 'POST', url: `/v1/checkin/lane/${laneId}/flow-command`,
    headers: { ...(request.headers.authorization ? { authorization: String(request.headers.authorization) } : {}), ...(request.headers['x-kiosk-token'] ? { 'x-kiosk-token': String(request.headers['x-kiosk-token']) } : {}) },
    payload: { sessionId: session.id, commandId, actor: confirmedBy, expectedFlowVersion: session.flow_version ?? 0, type: 'CONFIRM_SELECTION' },
  });
  if (response.statusCode !== 200) return reply.status(response.statusCode).send(response.json());
  return reply.send({ sessionId: session.id, rentalType: session.proposed_rental_type, confirmedBy, alreadyConfirmed: Boolean(session.selection_confirmed) });
}

async function handleProposeSelection(request: any, reply: any, laneId: string) {
  const { proposedBy } = request.body;
  if (proposedBy !== 'CUSTOMER' && proposedBy !== 'EMPLOYEE') return reply.status(400).send({ error: 'proposedBy must be CUSTOMER or EMPLOYEE' });
  if (proposedBy === 'EMPLOYEE' && !request.staff) return reply.status(401).send({ error: 'Unauthorized - employee proposals require authentication' });

  try {
    if (isFlowCommandsEnabled()) {
      return await dispatchProposeSelectionCommand(request.server, request, reply, laneId, proposedBy, request.body.rentalType);
    }

    const result = await proposeSelection({ laneId, ...request.body });
    const proposePayload: SelectionProposedPayload = { sessionId: result.sessionId, rentalType: request.body.rentalType, proposedBy };
    request.server.broadcaster.broadcastToLane({ type: 'SELECTION_PROPOSED', payload: proposePayload, timestamp: new Date().toISOString() }, laneId);
    const { payload } = await buildSessionPayload(result.sessionId);
    request.server.broadcaster.broadcastSessionUpdated(payload, laneId);
    return reply.send(result);
  } catch (error: unknown) {
    request.log.error(error, 'Failed to propose selection');
    const httpErr = getHttpError(error);
    if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to propose selection', code: httpErr.code });
    return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to propose selection' });
  }
}

async function handleWaitlistDesired(request: any, reply: any, laneId: string) {
  const hasDesiredType = request.body && Object.prototype.hasOwnProperty.call(request.body, 'waitlistDesiredType');
  if (!hasDesiredType) return reply.status(400).send({ error: 'waitlistDesiredType is required' });

  try {
    if (isFlowCommandsEnabled()) {
      return await dispatchWaitlistDesiredCommand(request.server, request, reply, laneId, request.body);
    }

    const result = await setWaitlistDesired({ laneId, ...request.body });
    const { payload } = await buildSessionPayload(result.sessionId);
    request.server.broadcaster.broadcastSessionUpdated(payload, result.laneId);
    return reply.send({ success: true });
  } catch (error: unknown) {
    request.log.error(error, 'Failed to set waitlist desired type');
    const httpErr = getHttpError(error);
    if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to set waitlist desired type', code: httpErr.code });
    return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to set waitlist desired type' });
  }
}

async function handleConfirmSelection(request: any, reply: any, laneId: string) {
  const { confirmedBy } = request.body;
  if (confirmedBy !== 'CUSTOMER' && confirmedBy !== 'EMPLOYEE') return reply.status(400).send({ error: 'confirmedBy must be CUSTOMER or EMPLOYEE' });
  if (confirmedBy === 'EMPLOYEE' && !request.staff) return reply.status(401).send({ error: 'Unauthorized - employee confirmations require authentication' });

  try {
    if (isFlowCommandsEnabled()) {
      return await dispatchConfirmSelectionCommand(request.server, request, reply, laneId, confirmedBy);
    }

    const result = await confirmSelection(laneId, confirmedBy);
    if (result.lockedPayload) {
      const lockedPayload: SelectionLockedPayload = result.lockedPayload;
      request.server.broadcaster.broadcastToLane({ type: 'SELECTION_LOCKED', payload: lockedPayload, timestamp: new Date().toISOString() }, laneId);
      if (result.isEmployeeForced) {
        request.server.broadcaster.broadcastSelectionForced({ sessionId: result.sessionId, rentalType: result.rentalType!, forcedBy: 'EMPLOYEE' }, laneId);
      }
    }
    const { payload } = await buildSessionPayload(result.sessionId);
    request.server.broadcaster.broadcastSessionUpdated(payload, laneId);
    return reply.send({ sessionId: result.sessionId, rentalType: result.rentalType, confirmedBy: result.confirmedBy, alreadyConfirmed: result.alreadyConfirmed });
  } catch (error: unknown) {
    request.log.error(error, 'Failed to confirm selection');
    const httpErr = getHttpError(error);
    if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to confirm selection', code: httpErr.code });
    return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to confirm selection' });
  }
}

async function handleAcknowledgeSelection(request: any, reply: any, laneId: string) {
  const { acknowledgedBy } = request.body;
  if (acknowledgedBy !== 'CUSTOMER' && acknowledgedBy !== 'EMPLOYEE') return reply.status(400).send({ error: 'acknowledgedBy must be CUSTOMER or EMPLOYEE' });
  if (acknowledgedBy === 'EMPLOYEE' && !request.staff) return reply.status(401).send({ error: 'Unauthorized - employee acknowledgements require authentication' });

  try {
    const result = await acknowledgeSelection(laneId, acknowledgedBy);
    const ackPayload: SelectionAcknowledgedPayload = { sessionId: result.sessionId, acknowledgedBy };
    request.server.broadcaster.broadcastToLane({ type: 'SELECTION_ACKNOWLEDGED', payload: ackPayload, timestamp: new Date().toISOString() }, laneId);
    return reply.send(result);
  } catch (error: unknown) {
    request.log.error(error, 'Failed to acknowledge selection');
    const httpErr = getHttpError(error);
    if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to acknowledge selection' });
    return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to acknowledge selection' });
  }
}

export function registerCheckinSelectionRoutes(fastify: FastifyInstance): void {
  // POST /v1/checkin/lane/:laneId/select-rental
  fastify.post<{
    Params: { laneId: string };
    Body: {
      rentalType: string; waitlistDesiredType?: string; waitlistDesiredTypes?: string[];
      backupRentalType?: string; waitlistRequestedResourceNumber?: string;
      waitlistRequestedResourceType?: 'room' | 'locker';
    };
  }>('/v1/checkin/lane/:laneId/select-rental', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.staff) return reply.status(401).send({ error: 'Unauthorized' });
    const { laneId } = request.params;

    try {
      const result = await selectRental({ laneId, ...request.body });
      const { payload } = await buildSessionPayload(result.sessionId);
      fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
      return reply.send(result);
    } catch (error: unknown) {
      request.log.error(error, 'Failed to select rental');
      const httpErr = getHttpError(error);
      if (httpErr) return reply.status(httpErr.statusCode).send({ error: httpErr.message ?? 'Failed to select rental' });
      return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to select rental' });
    }
  });

  // POST /v1/checkin/lane/:laneId/propose-selection
  fastify.post<{
    Params: { laneId: string };
    Body: {
      rentalType: string; proposedBy: 'CUSTOMER' | 'EMPLOYEE';
      waitlistDesiredType?: string; waitlistDesiredTypes?: string[];
      backupRentalType?: string; waitlistRequestedResourceNumber?: string;
      waitlistRequestedResourceType?: 'room' | 'locker';
    };
  }>('/v1/checkin/lane/:laneId/propose-selection', { preHandler: [optionalAuth, requireKioskTokenOrStaff] }, async (request, reply) => handleProposeSelection(request, reply, request.params.laneId));

  // POST /v1/checkin/lane/:laneId/waitlist-desired
  fastify.post<{
    Params: { laneId: string };
    Body: {
      waitlistDesiredType: string | null; waitlistDesiredTypes?: string[];
      waitlistRequestedResourceNumber?: string | null; waitlistRequestedResourceType?: 'room' | 'locker' | null;
      backupRentalType?: string | null; sessionId?: string;
    };
  }>('/v1/checkin/lane/:laneId/waitlist-desired', { preHandler: [optionalAuth, requireKioskTokenOrStaff] }, async (request, reply) => handleWaitlistDesired(request, reply, request.params.laneId));

  // POST /v1/checkin/lane/:laneId/confirm-selection
  fastify.post<{ Params: { laneId: string }; Body: { confirmedBy: 'CUSTOMER' | 'EMPLOYEE' } }>(
    '/v1/checkin/lane/:laneId/confirm-selection', { preHandler: [optionalAuth] }, async (request, reply) => handleConfirmSelection(request, reply, request.params.laneId));

  // POST /v1/checkin/lane/:laneId/acknowledge-selection
  fastify.post<{ Params: { laneId: string }; Body: { acknowledgedBy: 'CUSTOMER' | 'EMPLOYEE' } }>(
    '/v1/checkin/lane/:laneId/acknowledge-selection', { preHandler: [optionalAuth] }, async (request, reply) => handleAcknowledgeSelection(request, reply, request.params.laneId));
}
