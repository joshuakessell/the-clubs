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
 *
 * Migrated to Drizzle ORM — uses db.execute(sql) and db.transaction().
 */
const db_1 = require("../db");
const drizzle_orm_1 = require("drizzle-orm");
const types_1 = require("../checkin/types");
const helpers_1 = require("../checkin/helpers");
const waitlist_1 = require("../checkin/waitlist");
const pdf_generator_1 = require("../utils/pdf-generator");
const rounding_1 = require("../time/rounding");
const customerActivityLog_1 = require("../activity/customerActivityLog");
const clubEventLog_1 = require("../activity/clubEventLog");
const shared_1 = require("@the-clubs/shared");
const HttpError_1 = require("../errors/HttpError");
/**
 * Adapter: wraps a Drizzle transaction to satisfy the Queryable/PoolClient interface
 * expected by external helpers (selectRoomForNewCheckin, assertAssignedResourcePersistedAndUnavailable).
 */
function toQueryable(tx) {
    return {
        async query(queryText, params) {
            const values = params ?? [];
            let built = drizzle_orm_1.sql.empty();
            const regex = /\$(\d+)/g;
            let lastIndex = 0;
            for (const match of queryText.matchAll(regex)) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex, match.index))}`;
                const paramIndex = Number.parseInt(match[1], 10) - 1;
                built = (0, drizzle_orm_1.sql) `${built}${values[paramIndex]}`;
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < queryText.length) {
                built = (0, drizzle_orm_1.sql) `${built}${drizzle_orm_1.sql.raw(queryText.slice(lastIndex))}`;
            }
            const result = await tx.execute(built);
            return { rows: result.rows };
        },
    };
}
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
// ── Shared session lookup ──
async function findActiveSession(tx, laneId, sessionId, statusFilter = `('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')`) {
    let sessionResult;
    if (sessionId) {
        sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
       WHERE id = ${sessionId} AND lane_id = ${laneId} AND status IN ${drizzle_orm_1.sql.raw(statusFilter)}
       LIMIT 1`);
    }
    else {
        sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions
       WHERE lane_id = ${laneId} AND status IN ${drizzle_orm_1.sql.raw(statusFilter)}
       ORDER BY created_at DESC
       LIMIT 1`);
    }
    if (sessionResult.rows.length === 0) {
        throw new HttpError_1.HttpError(404, 'No active session found');
    }
    return sessionResult.rows[0];
}
async function validatePrerequisites(tx, session) {
    // Agreement signing is required only for CHECKIN and RENEWAL lane sessions
    if (session.checkin_mode !== 'CHECKIN' && session.checkin_mode !== 'RENEWAL') {
        throw new HttpError_1.HttpError(400, 'Agreement signing is only required for CHECKIN and RENEWAL check-ins');
    }
    // Demo flow: require the rental selection to be confirmed/locked before payment+signature
    if (!session.selection_confirmed || !session.selection_locked_at) {
        throw new HttpError_1.HttpError(400, 'Selection must be confirmed/locked before signing agreement');
    }
    // Check payment is paid
    if (!session.order_id) {
        throw new HttpError_1.HttpError(400, 'Payment intent must be created before signing agreement');
    }
    const intentResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT status FROM orders WHERE id = ${session.order_id}`);
    if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
        throw new HttpError_1.HttpError(400, 'Payment must be marked as paid before signing agreement');
    }
}
async function fetchCustomerInfo(tx, session) {
    const customerResult = session.customer_id
        ? await tx.execute((0, drizzle_orm_1.sql) `SELECT name, dob, membership_number, primary_language FROM customers WHERE id = ${session.customer_id}`)
        : { rows: [] };
    const row = customerResult.rows[0];
    return {
        customerName: row?.name || session.customer_display_name || 'Customer',
        customerDob: row?.dob ?? null,
        membershipNumber: row?.membership_number || session.membership_number || undefined,
        customerLang: row?.primary_language === 'ES' ? 'ES' : 'EN',
    };
}
async function computeRenewalTimeBlock(tx, session, renewalHours) {
    const visitResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM visits WHERE customer_id = ${session.customer_id} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`);
    if (visitResult.rows.length === 0) {
        throw new HttpError_1.HttpError(400, 'No active visit found for renewal');
    }
    const visitId = visitResult.rows[0].id;
    const blocksResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT starts_at, ends_at, resource_id FROM checkin_blocks WHERE visit_id = ${visitId} ORDER BY ends_at DESC`);
    if (blocksResult.rows.length === 0) {
        throw new HttpError_1.HttpError(400, 'Visit has no blocks');
    }
    let currentTotalHours = 0;
    for (const block of blocksResult.rows) {
        const hours = (new Date(block.ends_at).getTime() - new Date(block.starts_at).getTime()) / (1000 * 60 * 60);
        currentTotalHours += hours;
    }
    const latestBlock = blocksResult.rows[0];
    const latestBlockEnd = new Date(latestBlock.ends_at);
    const minutesUntilCheckout = (latestBlockEnd.getTime() - Date.now()) / (1000 * 60);
    // Eligible: < 45 min before checkout AND < 29 min past checkout
    if (minutesUntilCheckout > 45) {
        throw new HttpError_1.HttpError(400, 'Renewal is only available within 45 minutes of checkout');
    }
    if (minutesUntilCheckout < -29) {
        throw new HttpError_1.HttpError(400, 'Renewal window has expired (more than 29 minutes past checkout)');
    }
    if (currentTotalHours + renewalHours > 14) {
        throw new HttpError_1.HttpError(400, `Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add ${renewalHours} hours.`);
    }
    const startsAt = latestBlockEnd;
    const endsAt = new Date(startsAt.getTime() + renewalHours * 60 * 60 * 1000);
    const blockType = renewalHours === 2 ? 'FINAL2H' : 'RENEWAL';
    const resource = await resolveRenewalResource(tx, session, latestBlock);
    return { visitId, blockType, startsAt, endsAt, ...resource };
}
async function resolveRenewalResource(tx, session, latestBlock) {
    if (!latestBlock.resource_id) {
        throw new HttpError_1.HttpError(400, 'Active visit has no assigned resource');
    }
    const resourceResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, number, kind, tier, status, assigned_to_customer_id FROM inventory_resources WHERE id = ${latestBlock.resource_id} LIMIT 1`);
    const resource = resourceResult.rows[0];
    if (!resource)
        throw new HttpError_1.HttpError(400, 'Renewal resource assignment not found');
    if (resource.assigned_to_customer_id !== session.customer_id || resource.status !== 'OCCUPIED') {
        throw new HttpError_1.HttpError(409, `Resource ${resource.number} is not currently assigned to this customer`);
    }
    const resourceType = resource.kind === 'locker' ? 'locker' : 'room';
    return { assignedResourceId: resource.id, assignedResourceType: resourceType, assignedResourceNumber: resource.number };
}
async function resolvePreAssignedResource(tx, session, assignedResourceId, assignedResourceType) {
    const resourceResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, number, kind, tier, status, assigned_to_customer_id FROM inventory_resources WHERE id = ${assignedResourceId} FOR UPDATE`);
    const resource = resourceResult.rows[0];
    if (!resource)
        throw new HttpError_1.HttpError(404, `Selected ${assignedResourceType} not found`);
    if (resource.status !== 'CLEAN' || resource.assigned_to_customer_id) {
        throw new HttpError_1.HttpError(409, `Selected ${assignedResourceType} ${resource.number} is no longer available`);
    }
    const selectedByOther = await tx.execute((0, drizzle_orm_1.sql) `SELECT id FROM lane_sessions
     WHERE id <> ${session.id}
       AND assigned_resource_type = ${assignedResourceType}
       AND assigned_resource_id = ${assignedResourceId}
       AND status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
     LIMIT 1`);
    if (selectedByOther.rows.length > 0) {
        throw new HttpError_1.HttpError(409, `Selected ${assignedResourceType} ${resource.number} is reserved by another lane session`);
    }
    return resource.number;
}
async function autoAssignResource(tx, rentalType) {
    if (rentalType === 'LOCKER' || rentalType === 'GYM_LOCKER') {
        const lockerResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, number, kind, tier, status, assigned_to_customer_id
       FROM inventory_resources
       WHERE kind = 'locker' AND status = 'CLEAN' AND assigned_to_customer_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM lane_sessions ls
         WHERE ls.assigned_resource_type = 'locker'
           AND ls.assigned_resource_id = inventory_resources.id
           AND ls.status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
       )
       ORDER BY number LIMIT 1 FOR UPDATE SKIP LOCKED`);
        const locker = lockerResult.rows[0];
        if (!locker)
            throw new HttpError_1.HttpError(409, 'No available lockers');
        return { id: locker.id, type: 'locker', number: locker.number };
    }
    // Use toQueryable() adapter for external helper that expects PoolClient
    const room = await (0, helpers_1.selectRoomForNewCheckin)(toQueryable(tx), rentalType);
    if (!room)
        throw new HttpError_1.HttpError(409, 'No available rooms');
    return { id: room.id, type: 'room', number: room.number };
}
async function markResourceOccupied(tx, isRenewal, resourceType, customerId, resourceId) {
    if (isRenewal)
        return;
    await tx.execute((0, drizzle_orm_1.sql) `UPDATE inventory_resources SET status = 'OCCUPIED', assigned_to_customer_id = ${customerId}, last_status_change = NOW(), updated_at = NOW() WHERE id = ${resourceId}`);
}
async function maybeInsertFlowCommand(tx, sessionId) {
    if (!isFlowCommandsEnabled())
        return;
    const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `agr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payloadJson = JSON.stringify({ step: 'ASSIGNMENT' });
    await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
     VALUES (${sessionId}, ${commandId}, 'CUSTOMER', 'SET_STEP', ${payloadJson}::jsonb)
     ON CONFLICT (session_id, command_id) DO NOTHING`);
    await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
     SET flow_step = 'ASSIGNMENT',
         flow_version = COALESCE(flow_version, 0) + 1,
         flow_last_command_id = ${commandId},
         flow_last_actor = 'CUSTOMER',
         updated_at = NOW()
     WHERE id = ${sessionId}`);
}
async function createVisitAndBlock(params) {
    let visitId = params.visitId;
    if (!visitId) {
        const visitResult = await params.tx.execute((0, drizzle_orm_1.sql) `INSERT INTO visits (customer_id, started_at) VALUES (${params.customerId}, ${params.startsAt}) RETURNING id`);
        visitId = visitResult.rows[0].id;
    }
    const blockResult = await params.tx.execute((0, drizzle_orm_1.sql) `INSERT INTO checkin_blocks
     (visit_id, block_type, starts_at, ends_at, rental_type, resource_id, session_id, agreement_signed, agreement_pdf, agreement_signed_at)
     VALUES (${visitId}, ${params.blockType}, ${params.startsAt}, ${params.endsAt}, ${params.rentalType}, ${params.resourceId}, ${params.sessionId}, true, ${params.pdfBuffer}, ${params.signedAt})
     RETURNING id`);
    return { visitId: visitId, checkinBlockId: blockResult.rows[0].id };
}
async function maybeCreateWaitlist(tx, session, visitId, checkinBlockId, assignedResourceId) {
    if (!session.waitlist_desired_type || !session.backup_rental_type)
        return undefined;
    // Parse desired_tiers from session's waitlist_desired_types_json
    let desiredTiersArray = [session.waitlist_desired_type];
    if (session.waitlist_desired_types_json) {
        try {
            const parsed = typeof session.waitlist_desired_types_json === 'string'
                ? JSON.parse(session.waitlist_desired_types_json)
                : session.waitlist_desired_types_json;
            if (Array.isArray(parsed) && parsed.length > 0) {
                desiredTiersArray = parsed.map(String);
            }
        }
        catch { /* use default single tier */ }
    }
    const desiredTiersSql = `{${desiredTiersArray.join(',')}}`;
    const waitlistResult = await tx.execute((0, drizzle_orm_1.sql) `INSERT INTO waitlist
     (visit_id, checkin_block_id, desired_tier, desired_tiers, backup_tier, status)
     VALUES (${visitId}, ${checkinBlockId}, ${session.waitlist_desired_type}, ${desiredTiersSql}::rental_type[], ${session.backup_rental_type}, 'ACTIVE')
     RETURNING id`);
    const waitlistId = waitlistResult.rows[0].id;
    await tx.execute((0, drizzle_orm_1.sql) `UPDATE checkin_blocks SET waitlist_id = ${waitlistId} WHERE id = ${checkinBlockId}`);
    return {
        waitlistId,
        status: 'ACTIVE',
        visitId,
        desiredTier: session.waitlist_desired_type,
    };
}
async function storeSignatureArtifact(params) {
    await params.tx.execute((0, drizzle_orm_1.sql) `INSERT INTO agreement_signatures
     (agreement_id, checkin_block_id, customer_name, membership_number, signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, user_agent, ip_address)
     VALUES (${params.agreementId}, ${params.checkinBlockId}, ${params.customerName}, ${params.membershipNumber || null}, ${params.signedAt}, ${params.signatureData}, ${params.agreementTextSnapshot}, ${params.agreementVersion}, ${params.userAgent || null}, ${params.ipAddress || null})`);
}
async function maybeCompleteSession(tx, sessionId) {
    if (isFlowCommandsEnabled())
        return;
    await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = ${sessionId}`);
}
async function fetchActiveAgreement(tx) {
    const result = await tx.execute((0, drizzle_orm_1.sql) `SELECT id, body_text, version, title FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`);
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
async function resolveTimeBlock(tx, session, signedAt) {
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
    const renewal = await computeRenewalTimeBlock(tx, session, renewalHours);
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
async function resolveResourceAssignment(tx, session, timeBlock, rentalType) {
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
        const number = await resolvePreAssignedResource(tx, session, assignedResourceId, assignedResourceType);
        return { id: assignedResourceId, type: assignedResourceType, number };
    }
    return autoAssignResource(tx, rentalType);
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
    const coreResult = await db_1.db.transaction(async (tx) => {
        const session = await findActiveSession(tx, input.laneId, input.sessionId);
        await validatePrerequisites(tx, session);
        const { customerName, customerDob, membershipNumber, customerLang } = await fetchCustomerInfo(tx, session);
        const agreement = await fetchActiveAgreement(tx);
        const signatureData = extractSignatureData(input.signaturePayload, isManualOverride);
        const signedAt = new Date();
        if (!session.customer_id) {
            throw new HttpError_1.HttpError(400, 'Session has no customer; cannot complete check-in');
        }
        const timeBlock = await resolveTimeBlock(tx, session, signedAt);
        const rentalType = (session.desired_rental_type || session.backup_rental_type || 'LOCKER');
        const resource = await resolveResourceAssignment(tx, session, timeBlock, rentalType);
        await markResourceOccupied(tx, timeBlock.isRenewal, resource.type, session.customer_id, resource.id);
        // Update lane session snapshot
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
       SET assigned_resource_id = ${resource.id},
           assigned_resource_type = ${resource.type},
           agreement_signed_method = ${isManualOverride ? 'MANUAL' : 'DIGITAL'},
           agreement_bypass_pending = false,
           updated_at = NOW()
       WHERE id = ${session.id}`);
        await maybeInsertFlowCommand(tx, session.id);
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
            tx, visitId: timeBlock.visitId, customerId: session.customer_id,
            blockType: timeBlock.blockType, startsAt: timeBlock.startsAt, endsAt: timeBlock.endsAt,
            rentalType, resourceType: resource.type, resourceId: resource.id,
            sessionId: session.id, pdfBuffer, signedAt,
        });
        const waitlistInfo = await maybeCreateWaitlist(tx, session, visitId, checkinBlockId, resource.id);
        await (0, helpers_1.assertAssignedResourcePersistedAndUnavailable)({
            client: toQueryable(tx), sessionId: session.id, customerId: session.customer_id,
            resourceType: resource.type, resourceId: resource.id, resourceNumber: resource.number,
        });
        if (!isManualOverride && signatureData) {
            await storeSignatureArtifact({
                tx, agreementId: agreement.id, checkinBlockId, customerName,
                membershipNumber, signedAt, signatureData, agreementTextSnapshot,
                agreementVersion: agreement.version,
                userAgent: input.ctx.userAgent, ipAddress: input.ctx.ipAddress,
            });
        }
        await maybeCompleteSession(tx, session.id);
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
    await db_1.db.transaction(async (tx) => {
        // Look up customer name for event summaries
        const custRow = await tx.execute((0, drizzle_orm_1.sql) `SELECT name FROM customers WHERE id = ${coreResult.customerId}`);
        const customerName = custRow.rows[0]?.name ?? 'Customer';
        await (0, customerActivityLog_1.insertCustomerActivityEventDrizzle)(tx, {
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
        await (0, customerActivityLog_1.insertCustomerActivityEventDrizzle)(tx, {
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
        await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
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
            await (0, clubEventLog_1.insertClubEventDrizzle)(tx, {
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
                dedupeKey: (() => {
                    if (!coreResult.checkinBlockId)
                        return null;
                    const label = isRoom ? 'ROOM' : 'LOCKER';
                    return `CLUB:${label}_ASSIGNED:${coreResult.checkinBlockId}`;
                })(),
            });
        }
    });
    return coreResult;
}
/**
 * Staff-only: request bypass of digital agreement so staff can collect a physical signature.
 */
async function requestAgreementBypass(input) {
    return db_1.db.transaction(async (tx) => {
        const session = await findActiveSession(tx, input.laneId, input.sessionId);
        if (session.checkin_mode !== 'CHECKIN' && session.checkin_mode !== 'RENEWAL') {
            throw new HttpError_1.HttpError(400, 'Agreement bypass is only required for CHECKIN and RENEWAL check-ins');
        }
        if (!session.selection_confirmed) {
            throw new HttpError_1.HttpError(400, 'Selection must be confirmed before bypassing agreement');
        }
        if (!session.order_id) {
            throw new HttpError_1.HttpError(400, 'Payment intent must be created before bypassing agreement');
        }
        const intentResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT status FROM orders WHERE id = ${session.order_id}`);
        if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
            throw new HttpError_1.HttpError(400, 'Payment must be marked as paid before bypassing agreement');
        }
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET agreement_bypass_pending = true, updated_at = NOW() WHERE id = ${session.id}`);
        return { sessionId: session.id, laneId: session.lane_id || input.laneId };
    });
}
/**
 * Customer confirms or declines cross-type assignment.
 */
async function processCustomerConfirm(input) {
    return db_1.db.transaction(async (tx) => {
        const sessionResult = await tx.execute((0, drizzle_orm_1.sql) `SELECT ${drizzle_orm_1.sql.raw(types_1.LANE_SESSION_COLS)} FROM lane_sessions WHERE id = ${input.sessionId} AND lane_id = ${input.laneId}`);
        if (sessionResult.rows.length === 0) {
            throw new HttpError_1.HttpError(404, 'Session not found');
        }
        const session = sessionResult.rows[0];
        if (input.confirmed) {
            return resolveConfirmation(tx, session);
        }
        return resolveDecline(tx, session);
    });
}
async function resolveConfirmation(tx, session) {
    if (!session.assigned_resource_type || !session.assigned_resource_id) {
        throw new HttpError_1.HttpError(400, 'No assigned resource to confirm');
    }
    const { confirmedType, confirmedNumber } = await lookupAssignedResource(tx, session.assigned_resource_type, session.assigned_resource_id);
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
async function lookupAssignedResource(tx, resourceType, resourceId) {
    const res = await tx.execute((0, drizzle_orm_1.sql) `SELECT number, kind FROM inventory_resources WHERE id = ${resourceId} LIMIT 1`);
    if (res.rows.length === 0)
        throw new HttpError_1.HttpError(404, 'Assigned resource not found');
    const row = res.rows[0];
    const confirmedType = row.kind === 'locker' ? 'LOCKER' : (0, waitlist_1.getRoomTier)(row.number);
    return { confirmedType, confirmedNumber: row.number };
}
async function resolveDecline(tx, session) {
    if (session.assigned_resource_id) {
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE inventory_resources SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = ${session.assigned_resource_id}`);
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions SET assigned_resource_id = NULL, assigned_resource_type = NULL, updated_at = NOW() WHERE id = ${session.id}`);
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
    return db_1.db.transaction(async (tx) => {
        const session = await findActiveSession(tx, input.laneId, input.sessionId, `('ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE')`);
        await tx.execute((0, drizzle_orm_1.sql) `UPDATE lane_sessions
       SET agreement_signed_method = 'DIGITAL',
           agreement_bypass_pending = false,
           updated_at = NOW()
       WHERE id = ${session.id}`);
        return session.id;
    });
}
