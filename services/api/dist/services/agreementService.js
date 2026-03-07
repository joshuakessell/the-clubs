"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processAgreementSigning = processAgreementSigning;
exports.requestAgreementBypass = requestAgreementBypass;
exports.processCustomerConfirm = processCustomerConfirm;
exports.recordKioskSignature = recordKioskSignature;
/**
 * Agreement service — business logic for agreement signing, bypass, and confirmation.
 *
 * Extracted from routes/checkin/agreements.ts to separate HTTP concerns from domain logic.
 * Unifies the duplicated sign-agreement + manual-signature-override flows into a single
 * processAgreementSigning() function. This module contains ZERO HTTP/Fastify concepts.
 */
const db_1 = require("../db");
const helpers_1 = require("../checkin/helpers");
const waitlist_1 = require("../checkin/waitlist");
const pdf_generator_1 = require("../utils/pdf-generator");
const rounding_1 = require("../time/rounding");
const customerActivityLog_1 = require("../activity/customerActivityLog");
const clubEventLog_1 = require("../activity/clubEventLog");
const shared_1 = require("@the-clubs/shared");
const HttpError_1 = require("../errors/HttpError");
// ── Helpers ──
function isFlowCommandsEnabled() {
    return process.env.FLOW_COMMANDS === 'true';
}
function formatAgreementTimeBlock(params) {
    const timeZone = params.timeZone ?? 'America/Chicago';
    const dateFmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const timeFmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
    const startDate = dateFmt.format(params.startsAt);
    const endDate = dateFmt.format(params.endsAt);
    const startTime = timeFmt.format(params.startsAt);
    const endTime = timeFmt.format(params.endsAt);
    if (startDate === endDate) {
        return `${startDate} ${startTime} - ${endTime} (${timeZone})`;
    }
    return `${startDate} ${startTime} - ${endDate} ${endTime} (${timeZone})`;
}
function buildAgreementTimeBlockHtml(params) {
    const label = params.lang === 'ES' ? 'Este acuerdo aplica a:' : 'Agreement Applies To:';
    const block = formatAgreementTimeBlock({
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        timeZone: params.timeZone,
    });
    return `<p><strong>${label}</strong> ${block}</p>`;
}
async function findActiveSession(client, laneId, sessionId, statusFilter = `('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')`) {
    let sessionResult;
    if (sessionId) {
        sessionResult = await client.query(`SELECT * FROM lane_sessions
       WHERE id = $1 AND lane_id = $2 AND status IN ${statusFilter}
       LIMIT 1`, [sessionId, laneId]);
    }
    else {
        sessionResult = await client.query(`SELECT * FROM lane_sessions
       WHERE lane_id = $1 AND status IN ${statusFilter}
       ORDER BY created_at DESC
       LIMIT 1`, [laneId]);
    }
    if (sessionResult.rows.length === 0) {
        throw new HttpError_1.HttpError(404, 'No active session found');
    }
    return sessionResult.rows[0];
}
async function validatePrerequisites(client, session) {
    // Agreement signing is required only for CHECKIN and RENEWAL lane sessions
    if (session.checkin_mode !== 'CHECKIN' && session.checkin_mode !== 'RENEWAL') {
        throw new HttpError_1.HttpError(400, 'Agreement signing is only required for CHECKIN and RENEWAL check-ins');
    }
    // Demo flow: require the rental selection to be confirmed/locked before payment+signature
    if (!session.selection_confirmed || !session.selection_locked_at) {
        throw new HttpError_1.HttpError(400, 'Selection must be confirmed/locked before signing agreement');
    }
    // Check payment is paid
    if (!session.payment_intent_id) {
        throw new HttpError_1.HttpError(400, 'Payment intent must be created before signing agreement');
    }
    const intentResult = await client.query(`SELECT status FROM payment_intents WHERE id = $1`, [session.payment_intent_id]);
    if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
        throw new HttpError_1.HttpError(400, 'Payment must be marked as paid before signing agreement');
    }
}
async function fetchCustomerInfo(client, session) {
    const customerResult = session.customer_id
        ? await client.query(`SELECT name, dob, membership_number, primary_language FROM customers WHERE id = $1`, [session.customer_id])
        : { rows: [] };
    return {
        customerName: customerResult.rows[0]?.name || session.customer_display_name || 'Customer',
        customerDob: customerResult.rows[0]?.dob ?? null,
        membershipNumber: customerResult.rows[0]?.membership_number || session.membership_number || undefined,
        customerLang: customerResult.rows[0]?.primary_language === 'ES' ? 'ES' : 'EN',
    };
}
async function computeRenewalTimeBlock(client, session, renewalHours) {
    const visitResult = await client.query(`SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [session.customer_id]);
    if (visitResult.rows.length === 0) {
        throw new HttpError_1.HttpError(400, 'No active visit found for renewal');
    }
    const visitId = visitResult.rows[0].id;
    const blocksResult = await client.query(`SELECT starts_at, ends_at, room_id, locker_id FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`, [visitId]);
    if (blocksResult.rows.length === 0) {
        throw new HttpError_1.HttpError(400, 'Visit has no blocks');
    }
    let currentTotalHours = 0;
    for (const block of blocksResult.rows) {
        const hours = (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
        currentTotalHours += hours;
    }
    const latestBlock = blocksResult.rows[0];
    const latestBlockEnd = latestBlock.ends_at;
    const diffMs = Math.abs(latestBlockEnd.getTime() - Date.now());
    if (diffMs > 60 * 60 * 1000) {
        throw new HttpError_1.HttpError(400, 'Renewal is only available within 1 hour of checkout');
    }
    if (currentTotalHours + renewalHours > 14) {
        throw new HttpError_1.HttpError(400, `Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add ${renewalHours} hours.`);
    }
    const startsAt = latestBlockEnd;
    const endsAt = new Date(startsAt.getTime() + renewalHours * 60 * 60 * 1000);
    const blockType = renewalHours === 2 ? 'FINAL2H' : 'RENEWAL';
    const resource = await resolveRenewalResource(client, session, latestBlock);
    return { visitId, blockType, startsAt, endsAt, ...resource };
}
async function resolveRenewalResource(client, session, latestBlock) {
    if (latestBlock.room_id) {
        const room = (await client.query(`SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 LIMIT 1`, [latestBlock.room_id])).rows[0];
        if (!room)
            throw new HttpError_1.HttpError(400, 'Renewal room assignment not found');
        if (room.assigned_to_customer_id !== session.customer_id || room.status !== 'OCCUPIED') {
            throw new HttpError_1.HttpError(409, `Room ${room.number} is not currently assigned to this customer`);
        }
        return { assignedResourceId: room.id, assignedResourceType: 'room', assignedResourceNumber: room.number };
    }
    if (latestBlock.locker_id) {
        const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 LIMIT 1`, [latestBlock.locker_id])).rows[0];
        if (!locker)
            throw new HttpError_1.HttpError(400, 'Renewal locker assignment not found');
        if (locker.assigned_to_customer_id !== session.customer_id || locker.status !== 'OCCUPIED') {
            throw new HttpError_1.HttpError(409, `Locker ${locker.number} is not currently assigned to this customer`);
        }
        return { assignedResourceId: locker.id, assignedResourceType: 'locker', assignedResourceNumber: locker.number };
    }
    throw new HttpError_1.HttpError(400, 'Active visit has no assigned room or locker');
}
async function resolvePreAssignedResource(client, session, assignedResourceId, assignedResourceType) {
    if (assignedResourceType === 'room') {
        const room = (await client.query(`SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`, [assignedResourceId])).rows[0];
        if (!room)
            throw new HttpError_1.HttpError(404, 'Selected room not found');
        if (room.status !== 'CLEAN' || room.assigned_to_customer_id) {
            throw new HttpError_1.HttpError(409, `Selected room ${room.number} is no longer available`);
        }
        const selectedByOther = await client.query(`SELECT id FROM lane_sessions
       WHERE id <> $1
         AND assigned_resource_type = 'room'
         AND assigned_resource_id = $2
         AND status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
       LIMIT 1`, [session.id, assignedResourceId]);
        if (selectedByOther.rows.length > 0) {
            throw new HttpError_1.HttpError(409, `Selected room ${room.number} is reserved by another lane session`);
        }
        return room.number;
    }
    const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 FOR UPDATE`, [assignedResourceId])).rows[0];
    if (!locker)
        throw new HttpError_1.HttpError(404, 'Selected locker not found');
    if (locker.status !== 'CLEAN' || locker.assigned_to_customer_id) {
        throw new HttpError_1.HttpError(409, `Selected locker ${locker.number} is no longer available`);
    }
    const selectedByOther = await client.query(`SELECT id FROM lane_sessions
     WHERE id <> $1
       AND assigned_resource_type = 'locker'
       AND assigned_resource_id = $2
       AND status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
     LIMIT 1`, [session.id, assignedResourceId]);
    if (selectedByOther.rows.length > 0) {
        throw new HttpError_1.HttpError(409, `Selected locker ${locker.number} is reserved by another lane session`);
    }
    return locker.number;
}
async function autoAssignResource(client, rentalType) {
    if (rentalType === 'LOCKER' || rentalType === 'GYM_LOCKER') {
        const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id
         FROM lockers
         WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM lane_sessions ls
           WHERE ls.assigned_resource_type = 'locker'
             AND ls.assigned_resource_id = lockers.id
             AND ls.status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
         )
         ORDER BY number LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
        if (!locker)
            throw new HttpError_1.HttpError(409, 'No available lockers');
        return { id: locker.id, type: 'locker', number: locker.number };
    }
    const room = await (0, helpers_1.selectRoomForNewCheckin)(client, rentalType);
    if (!room)
        throw new HttpError_1.HttpError(409, 'No available rooms');
    return { id: room.id, type: 'room', number: room.number };
}
async function markResourceOccupied(client, isRenewal, resourceType, customerId, resourceId) {
    if (isRenewal)
        return;
    if (resourceType === 'room') {
        await client.query(`UPDATE rooms SET status = 'OCCUPIED', assigned_to_customer_id = $1, last_status_change = NOW(), updated_at = NOW() WHERE id = $2`, [customerId, resourceId]);
    }
    else {
        await client.query(`UPDATE lockers SET status = 'OCCUPIED', assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`, [customerId, resourceId]);
    }
}
async function maybeInsertFlowCommand(client, sessionId) {
    if (!isFlowCommandsEnabled())
        return;
    const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `agr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await client.query(`INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, command_id) DO NOTHING`, [sessionId, commandId, 'CUSTOMER', 'SET_STEP', { step: 'ASSIGNMENT' }]);
    await client.query(`UPDATE lane_sessions
     SET flow_step = 'ASSIGNMENT',
         flow_version = COALESCE(flow_version, 0) + 1,
         flow_last_command_id = $1,
         flow_last_actor = 'CUSTOMER',
         updated_at = NOW()
     WHERE id = $2`, [commandId, sessionId]);
}
async function createVisitAndBlock(params) {
    let visitId = params.visitId;
    if (!visitId) {
        const visitResult = await params.client.query(`INSERT INTO visits (customer_id, started_at) VALUES ($1, $2) RETURNING id`, [params.customerId, params.startsAt]);
        visitId = visitResult.rows[0].id;
    }
    const blockResult = await params.client.query(`INSERT INTO checkin_blocks
     (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_pdf, agreement_signed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
     RETURNING id`, [
        visitId,
        params.blockType,
        params.startsAt,
        params.endsAt,
        params.rentalType,
        params.resourceType === 'room' ? params.resourceId : null,
        params.resourceType === 'locker' ? params.resourceId : null,
        params.sessionId,
        params.pdfBuffer,
        params.signedAt,
    ]);
    return { visitId, checkinBlockId: blockResult.rows[0].id };
}
async function maybeCreateWaitlist(client, session, visitId, checkinBlockId, assignedResourceId) {
    if (!session.waitlist_desired_type || !session.backup_rental_type)
        return undefined;
    const waitlistResult = await client.query(`INSERT INTO waitlist
     (visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, status)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     RETURNING id`, [visitId, checkinBlockId, session.waitlist_desired_type, session.backup_rental_type, assignedResourceId]);
    const waitlistId = waitlistResult.rows[0].id;
    await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [waitlistId, checkinBlockId]);
    return {
        waitlistId,
        status: 'ACTIVE',
        visitId,
        desiredTier: session.waitlist_desired_type,
    };
}
async function storeSignatureArtifact(params) {
    await params.client.query(`INSERT INTO agreement_signatures
     (agreement_id, checkin_block_id, customer_name, membership_number, signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
        params.agreementId,
        params.checkinBlockId,
        params.customerName,
        params.membershipNumber || null,
        params.signedAt,
        params.signatureData,
        params.agreementTextSnapshot,
        params.agreementVersion,
        params.userAgent || null,
        params.ipAddress || null,
    ]);
}
async function maybeCompleteSession(client, sessionId) {
    if (isFlowCommandsEnabled())
        return;
    await client.query(`UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [sessionId]);
}
async function fetchActiveAgreement(client) {
    const result = await client.query(`SELECT id, body_text, version, title FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`);
    if (result.rows.length === 0) {
        throw new HttpError_1.HttpError(404, 'No active agreement found');
    }
    return result.rows[0];
}
function extractSignatureData(signaturePayload, isManualOverride) {
    if (isManualOverride)
        return undefined;
    const data = signaturePayload.startsWith('data:')
        ? signaturePayload.split(',')[1]
        : signaturePayload;
    if (!data || data.trim().length < 16) {
        throw new HttpError_1.HttpError(400, 'Signature payload is required');
    }
    return data;
}
async function resolveTimeBlock(client, session, signedAt) {
    const isRenewal = session.checkin_mode === 'RENEWAL';
    if (!isRenewal) {
        return {
            isRenewal: false,
            visitId: null,
            blockType: 'INITIAL',
            startsAt: signedAt,
            endsAt: (0, rounding_1.roundUpToQuarterHour)(new Date(signedAt.getTime() + 6 * 60 * 60 * 1000)),
        };
    }
    const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6
        ? session.renewal_hours
        : null;
    if (!renewalHours) {
        throw new HttpError_1.HttpError(400, 'Renewal hours not set for this session');
    }
    const renewal = await computeRenewalTimeBlock(client, session, renewalHours);
    return {
        isRenewal: true,
        visitId: renewal.visitId,
        blockType: renewal.blockType,
        startsAt: renewal.startsAt,
        endsAt: renewal.endsAt,
        renewalResourceId: renewal.assignedResourceId,
        renewalResourceType: renewal.assignedResourceType,
        renewalResourceNumber: renewal.assignedResourceNumber,
    };
}
async function resolveResourceAssignment(client, session, timeBlock, rentalType) {
    if (timeBlock.isRenewal && timeBlock.renewalResourceId && timeBlock.renewalResourceType) {
        return {
            id: timeBlock.renewalResourceId,
            type: timeBlock.renewalResourceType,
            number: timeBlock.renewalResourceNumber,
        };
    }
    const assignedResourceId = session.assigned_resource_id;
    const assignedResourceType = session.assigned_resource_type;
    if (assignedResourceId && assignedResourceType) {
        const number = await resolvePreAssignedResource(client, session, assignedResourceId, assignedResourceType);
        return { id: assignedResourceId, type: assignedResourceType, number };
    }
    return autoAssignResource(client, rentalType);
}
function buildAgreementTextSnapshot(startsAt, endsAt, customerLang, agreementBodyText) {
    const timeBlockHtml = buildAgreementTimeBlockHtml({ startsAt, endsAt, lang: customerLang });
    const baseText = customerLang === 'ES' ? shared_1.AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES : agreementBodyText;
    return `${timeBlockHtml}${baseText}`;
}
// ── Service Methods ──
/**
 * Unified agreement signing flow.
 *
 * Covers both customer digital signature AND employee manual override.
 * When `signaturePayload === 'MANUAL_OVERRIDE'`, generates PDF with override text instead of signature image.
 */
async function processAgreementSigning(input) {
    const isManualOverride = input.signaturePayload === 'MANUAL_OVERRIDE';
    const coreResult = await (0, db_1.transaction)(async (client) => {
        const session = await findActiveSession(client, input.laneId, input.sessionId);
        await validatePrerequisites(client, session);
        const { customerName, customerDob, membershipNumber, customerLang } = await fetchCustomerInfo(client, session);
        const agreement = await fetchActiveAgreement(client);
        const signatureData = extractSignatureData(input.signaturePayload, isManualOverride);
        const signedAt = new Date();
        if (!session.customer_id) {
            throw new HttpError_1.HttpError(400, 'Session has no customer; cannot complete check-in');
        }
        const timeBlock = await resolveTimeBlock(client, session, signedAt);
        const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER');
        const resource = await resolveResourceAssignment(client, session, timeBlock, rentalType);
        await markResourceOccupied(client, timeBlock.isRenewal, resource.type, session.customer_id, resource.id);
        // Update lane session snapshot
        await client.query(`UPDATE lane_sessions
       SET assigned_resource_id = $1,
           assigned_resource_type = $2,
           agreement_signed_method = $3,
           agreement_bypass_pending = false,
           updated_at = NOW()
       WHERE id = $4`, [resource.id, resource.type, isManualOverride ? 'MANUAL' : 'DIGITAL', session.id]);
        await maybeInsertFlowCommand(client, session.id);
        // Build agreement text + PDF
        const agreementTextSnapshot = buildAgreementTextSnapshot(timeBlock.startsAt, timeBlock.endsAt, customerLang, agreement.body_text);
        const agreementTitleForPdf = customerLang === 'ES' ? 'Acuerdo del Club' : agreement.title;
        const pdfBuffer = await (0, pdf_generator_1.generateAgreementPdf)({
            agreementTitle: agreementTitleForPdf,
            agreementVersion: agreement.version,
            agreementText: agreementTextSnapshot,
            customerName,
            customerDob,
            membershipNumber,
            checkinAt: timeBlock.startsAt,
            signedAt,
            ...(isManualOverride
                ? { signatureText: 'Manual Signature Override' }
                : { signatureImageBase64: signatureData }),
        });
        const { visitId, checkinBlockId } = await createVisitAndBlock({
            client, visitId: timeBlock.visitId, customerId: session.customer_id,
            blockType: timeBlock.blockType, startsAt: timeBlock.startsAt, endsAt: timeBlock.endsAt,
            rentalType, resourceType: resource.type, resourceId: resource.id,
            sessionId: session.id, pdfBuffer, signedAt,
        });
        const waitlistInfo = await maybeCreateWaitlist(client, session, visitId, checkinBlockId, resource.id);
        await (0, helpers_1.assertAssignedResourcePersistedAndUnavailable)({
            client, sessionId: session.id, customerId: session.customer_id,
            resourceType: resource.type, resourceId: resource.id, resourceNumber: resource.number,
        });
        if (!isManualOverride && signatureData) {
            await storeSignatureArtifact({
                client, agreementId: agreement.id, checkinBlockId, customerName,
                membershipNumber, signedAt, signatureData, agreementTextSnapshot,
                agreementVersion: agreement.version,
                userAgent: input.ctx.userAgent, ipAddress: input.ctx.ipAddress,
            });
        }
        await maybeCompleteSession(client, session.id);
        return {
            success: true,
            sessionId: session.id,
            customerId: session.customer_id,
            visitId,
            checkinBlockId,
            assignedResourceType: resource.type,
            assignedResourceNumber: resource.number,
            rentalType,
            laneId: input.laneId,
            waitlist: waitlistInfo,
        };
    });
    // Activity events (separate transaction — after main commit)
    await (0, db_1.transaction)(async (client) => {
        // Look up customer name for event summaries
        const custRow = await client.query(`SELECT name FROM customers WHERE id = $1`, [coreResult.customerId]);
        const customerName = custRow.rows[0]?.name ?? 'Customer';
        await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
            customerId: coreResult.customerId,
            actionType: 'AGREEMENT_SIGNED',
            actionCategory: 'CHECKIN',
            sourceApp: input.ctx.sourceApp,
            actorType: input.ctx.actorType,
            actorStaffId: input.ctx.staffId ?? null,
            actorStaffName: input.ctx.staffName ?? null,
            summary: `Agreement signed — ${coreResult.assignedResourceType} ${coreResult.assignedResourceNumber} (${coreResult.rentalType})`,
            metadata: {
                visitId: coreResult.visitId,
                checkinBlockId: coreResult.checkinBlockId,
                laneId: input.laneId,
                laneSessionId: coreResult.sessionId,
                ...(coreResult.assignedResourceType === 'room'
                    ? { roomNumber: coreResult.assignedResourceNumber }
                    : { lockerNumber: coreResult.assignedResourceNumber }),
            },
            dedupeKey: coreResult.checkinBlockId ? `ACT:AGREEMENT_SIGNED:${coreResult.checkinBlockId}` : null,
            searchParts: [coreResult.assignedResourceNumber ?? ''],
        });
        await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
            customerId: coreResult.customerId,
            actionType: 'CHECKIN_COMPLETED',
            actionCategory: 'CHECKIN',
            sourceApp: input.ctx.sourceApp,
            actorType: input.ctx.actorType,
            actorStaffId: input.ctx.staffId ?? null,
            actorStaffName: input.ctx.staffName ?? null,
            summary: 'Check-in completed',
            metadata: {
                visitId: coreResult.visitId,
                checkinBlockId: coreResult.checkinBlockId,
                laneId: input.laneId,
                laneSessionId: coreResult.sessionId,
            },
            dedupeKey: coreResult.visitId ? `ACT:CHECKIN_COMPLETED:${coreResult.visitId}` : null,
            searchParts: [coreResult.visitId ?? '', coreResult.checkinBlockId ?? ''],
        });
        await (0, clubEventLog_1.insertClubEvent)(client, {
            eventType: 'CHECKIN_COMPLETED',
            eventDomain: 'CHECKIN',
            sourceApp: input.ctx.sourceApp === 'CUSTOMER_KIOSK' ? 'CUSTOMER_KIOSK' : 'EMPLOYEE_REGISTER',
            staffId: input.ctx.staffId ?? null,
            staffName: input.ctx.staffName ?? null,
            customerId: coreResult.customerId,
            customerName,
            visitId: coreResult.visitId ?? null,
            summary: `Check-in completed for ${customerName}`,
            metadata: {
                laneId: input.laneId,
                laneSessionId: coreResult.sessionId,
                checkinBlockId: coreResult.checkinBlockId,
                assignedResourceType: coreResult.assignedResourceType,
                assignedResourceNumber: coreResult.assignedResourceNumber,
            },
            dedupeKey: coreResult.visitId ? `CLUB:CHECKIN_COMPLETED:${coreResult.visitId}` : null,
        });
        // Log room/locker assignment
        if (coreResult.assignedResourceType && coreResult.assignedResourceNumber) {
            const isRoom = coreResult.assignedResourceType === 'room';
            await (0, clubEventLog_1.insertClubEvent)(client, {
                eventType: isRoom ? 'ROOM_ASSIGNED' : 'LOCKER_ASSIGNED',
                eventDomain: 'INVENTORY',
                sourceApp: input.ctx.sourceApp === 'CUSTOMER_KIOSK' ? 'CUSTOMER_KIOSK' : 'EMPLOYEE_REGISTER',
                staffId: input.ctx.staffId ?? null,
                staffName: input.ctx.staffName ?? null,
                customerId: coreResult.customerId,
                customerName,
                visitId: coreResult.visitId ?? null,
                summary: `${isRoom ? 'Room' : 'Locker'} ${coreResult.assignedResourceNumber} assigned to ${customerName}`,
                metadata: {
                    resourceType: coreResult.assignedResourceType,
                    resourceNumber: coreResult.assignedResourceNumber,
                    checkinBlockId: coreResult.checkinBlockId,
                    laneSessionId: coreResult.sessionId,
                },
                dedupeKey: coreResult.checkinBlockId ? `CLUB:${isRoom ? 'ROOM' : 'LOCKER'}_ASSIGNED:${coreResult.checkinBlockId}` : null,
            });
        }
    });
    return coreResult;
}
/**
 * Staff-only: request bypass of digital agreement so staff can collect a physical signature.
 */
async function requestAgreementBypass(input) {
    return (0, db_1.transaction)(async (client) => {
        const session = await findActiveSession(client, input.laneId, input.sessionId);
        if (session.checkin_mode !== 'CHECKIN' && session.checkin_mode !== 'RENEWAL') {
            throw new HttpError_1.HttpError(400, 'Agreement bypass is only required for CHECKIN and RENEWAL check-ins');
        }
        if (!session.selection_confirmed) {
            throw new HttpError_1.HttpError(400, 'Selection must be confirmed before bypassing agreement');
        }
        if (!session.payment_intent_id) {
            throw new HttpError_1.HttpError(400, 'Payment intent must be created before bypassing agreement');
        }
        const intentResult = await client.query(`SELECT status FROM payment_intents WHERE id = $1`, [session.payment_intent_id]);
        if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
            throw new HttpError_1.HttpError(400, 'Payment must be marked as paid before bypassing agreement');
        }
        await client.query(`UPDATE lane_sessions SET agreement_bypass_pending = true, updated_at = NOW() WHERE id = $1`, [session.id]);
        return { sessionId: session.id, laneId: session.lane_id || input.laneId };
    });
}
/**
 * Customer confirms or declines cross-type assignment.
 */
async function processCustomerConfirm(input) {
    return (0, db_1.transaction)(async (client) => {
        const sessionResult = await client.query(`SELECT * FROM lane_sessions WHERE id = $1 AND lane_id = $2`, [input.sessionId, input.laneId]);
        if (sessionResult.rows.length === 0) {
            throw new HttpError_1.HttpError(404, 'Session not found');
        }
        const session = sessionResult.rows[0];
        if (input.confirmed) {
            return resolveConfirmation(client, session);
        }
        return resolveDecline(client, session);
    });
}
async function resolveConfirmation(client, session) {
    if (!session.assigned_resource_type || !session.assigned_resource_id) {
        throw new HttpError_1.HttpError(400, 'No assigned resource to confirm');
    }
    const { confirmedType, confirmedNumber } = await lookupAssignedResource(client, session.assigned_resource_type, session.assigned_resource_id);
    return {
        success: true,
        confirmed: true,
        confirmedPayload: {
            sessionId: session.id,
            confirmedType,
            confirmedNumber,
        },
    };
}
async function lookupAssignedResource(client, resourceType, resourceId) {
    if (resourceType === 'room') {
        const roomRes = await client.query(`SELECT number FROM rooms WHERE id = $1 LIMIT 1`, [resourceId]);
        if (roomRes.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Assigned room not found');
        return { confirmedType: (0, waitlist_1.getRoomTier)(roomRes.rows[0].number), confirmedNumber: roomRes.rows[0].number };
    }
    if (resourceType === 'locker') {
        const lockerRes = await client.query(`SELECT number FROM lockers WHERE id = $1 LIMIT 1`, [resourceId]);
        if (lockerRes.rows.length === 0)
            throw new HttpError_1.HttpError(404, 'Assigned locker not found');
        return { confirmedType: 'LOCKER', confirmedNumber: lockerRes.rows[0].number };
    }
    throw new HttpError_1.HttpError(400, 'Invalid assigned resource type');
}
async function resolveDecline(client, session) {
    if (session.assigned_resource_id) {
        if (session.assigned_resource_type === 'room') {
            await client.query(`UPDATE rooms SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $1`, [session.assigned_resource_id]);
        }
        else if (session.assigned_resource_type === 'locker') {
            await client.query(`UPDATE lockers SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $1`, [session.assigned_resource_id]);
        }
        await client.query(`UPDATE lane_sessions SET assigned_resource_id = NULL, assigned_resource_type = NULL, updated_at = NOW() WHERE id = $1`, [session.id]);
    }
    return {
        success: true,
        confirmed: false,
        declinedPayload: {
            sessionId: session.id,
            requestedType: session.desired_rental_type || '',
        },
    };
}
/**
 * Lightweight kiosk endpoint: records that the customer signed the agreement digitally.
 * Does NOT trigger full check-in completion.
 */
async function recordKioskSignature(input) {
    return (0, db_1.transaction)(async (client) => {
        const session = await findActiveSession(client, input.laneId, input.sessionId, `('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')`);
        await client.query(`UPDATE lane_sessions
       SET agreement_signed_method = 'DIGITAL',
           agreement_bypass_pending = false,
           updated_at = NOW()
       WHERE id = $1`, [session.id]);
        return session.id;
    });
}
