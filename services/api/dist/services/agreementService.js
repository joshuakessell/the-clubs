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
const shared_1 = require("@the-clubs/shared");
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
        throw { statusCode: 404, message: 'No active session found' };
    }
    return sessionResult.rows[0];
}
async function validatePrerequisites(client, session) {
    // Agreement signing is required only for CHECKIN and RENEWAL lane sessions
    if (session.checkin_mode !== 'CHECKIN' && session.checkin_mode !== 'RENEWAL') {
        throw {
            statusCode: 400,
            message: 'Agreement signing is only required for CHECKIN and RENEWAL check-ins',
        };
    }
    // Demo flow: require the rental selection to be confirmed/locked before payment+signature
    if (!session.selection_confirmed || !session.selection_locked_at) {
        throw {
            statusCode: 400,
            message: 'Selection must be confirmed/locked before signing agreement',
        };
    }
    // Check payment is paid
    if (!session.payment_intent_id) {
        throw {
            statusCode: 400,
            message: 'Payment intent must be created before signing agreement',
        };
    }
    const intentResult = await client.query(`SELECT status FROM payment_intents WHERE id = $1`, [session.payment_intent_id]);
    if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
        throw {
            statusCode: 400,
            message: 'Payment must be marked as paid before signing agreement',
        };
    }
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
        // Get customer identity info for PDF + signature snapshot
        const customerResult = session.customer_id
            ? await client.query(`SELECT name, dob, membership_number, primary_language FROM customers WHERE id = $1`, [session.customer_id])
            : { rows: [] };
        const customerName = customerResult.rows[0]?.name || session.customer_display_name || 'Customer';
        const customerDob = customerResult.rows[0]?.dob ?? null;
        const membershipNumber = customerResult.rows[0]?.membership_number || session.membership_number || undefined;
        const customerLang = customerResult.rows[0]?.primary_language === 'ES' ? 'ES' : 'EN';
        // Get active agreement text
        const agreementResult = await client.query(`SELECT id, body_text, version, title FROM agreements WHERE active = true ORDER BY created_at DESC LIMIT 1`);
        if (agreementResult.rows.length === 0) {
            throw { statusCode: 404, message: 'No active agreement found' };
        }
        const agreement = agreementResult.rows[0];
        // Validate signature (for digital signing only)
        let signatureData;
        if (!isManualOverride) {
            const payload = input.signaturePayload;
            signatureData = payload.startsWith('data:')
                ? payload.split(',')[1]
                : payload;
            if (!signatureData || signatureData.trim().length < 16) {
                throw { statusCode: 400, message: 'Signature payload is required' };
            }
        }
        const signedAt = new Date();
        if (!session.customer_id) {
            throw { statusCode: 400, message: 'Session has no customer; cannot complete check-in' };
        }
        const isRenewal = session.checkin_mode === 'RENEWAL';
        const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6
            ? session.renewal_hours
            : null;
        let visitId = null;
        let blockType;
        let startsAt;
        let endsAt;
        let renewalAssignedResourceId = null;
        let renewalAssignedResourceType = null;
        let renewalAssignedResourceNumber;
        if (isRenewal) {
            if (!renewalHours) {
                throw { statusCode: 400, message: 'Renewal hours not set for this session' };
            }
            const visitResult = await client.query(`SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [session.customer_id]);
            if (visitResult.rows.length === 0) {
                throw { statusCode: 400, message: 'No active visit found for renewal' };
            }
            visitId = visitResult.rows[0].id;
            const blocksResult = await client.query(`SELECT starts_at, ends_at, room_id, locker_id FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`, [visitId]);
            if (blocksResult.rows.length === 0) {
                throw { statusCode: 400, message: 'Visit has no blocks' };
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
                throw { statusCode: 400, message: 'Renewal is only available within 1 hour of checkout' };
            }
            if (currentTotalHours + renewalHours > 14) {
                throw {
                    statusCode: 400,
                    message: `Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add ${renewalHours} hours.`,
                };
            }
            startsAt = latestBlockEnd;
            endsAt =
                renewalHours === 2
                    ? new Date(startsAt.getTime() + 2 * 60 * 60 * 1000)
                    : (0, rounding_1.roundUpToQuarterHour)(new Date(startsAt.getTime() + 6 * 60 * 60 * 1000));
            blockType = renewalHours === 2 ? 'FINAL2H' : 'RENEWAL';
            if (latestBlock.room_id) {
                const room = (await client.query(`SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 LIMIT 1`, [latestBlock.room_id])).rows[0];
                if (!room)
                    throw { statusCode: 400, message: 'Renewal room assignment not found' };
                if (room.assigned_to_customer_id !== session.customer_id || room.status !== 'OCCUPIED') {
                    throw {
                        statusCode: 409,
                        message: `Room ${room.number} is not currently assigned to this customer`,
                    };
                }
                renewalAssignedResourceId = room.id;
                renewalAssignedResourceType = 'room';
                renewalAssignedResourceNumber = room.number;
            }
            else if (latestBlock.locker_id) {
                const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 LIMIT 1`, [latestBlock.locker_id])).rows[0];
                if (!locker)
                    throw { statusCode: 400, message: 'Renewal locker assignment not found' };
                if (locker.assigned_to_customer_id !== session.customer_id || locker.status !== 'OCCUPIED') {
                    throw {
                        statusCode: 409,
                        message: `Locker ${locker.number} is not currently assigned to this customer`,
                    };
                }
                renewalAssignedResourceId = locker.id;
                renewalAssignedResourceType = 'locker';
                renewalAssignedResourceNumber = locker.number;
            }
            else {
                throw { statusCode: 400, message: 'Active visit has no assigned room or locker' };
            }
        }
        else {
            blockType = 'INITIAL';
            startsAt = signedAt;
            endsAt = (0, rounding_1.roundUpToQuarterHour)(new Date(startsAt.getTime() + 6 * 60 * 60 * 1000));
        }
        // Build agreement text + PDF
        const agreementTimeBlockHtml = buildAgreementTimeBlockHtml({
            startsAt,
            endsAt,
            lang: customerLang,
        });
        const baseAgreementTextSnapshot = customerLang === 'ES' ? shared_1.AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES : agreement.body_text;
        const agreementTextSnapshot = `${agreementTimeBlockHtml}${baseAgreementTextSnapshot}`;
        const agreementTitleForPdf = customerLang === 'ES' ? 'Acuerdo del Club' : agreement.title;
        // Generate PDF
        const pdfBuffer = await (0, pdf_generator_1.generateAgreementPdf)({
            agreementTitle: agreementTitleForPdf,
            agreementVersion: agreement.version,
            agreementText: agreementTextSnapshot,
            customerName,
            customerDob,
            membershipNumber,
            checkinAt: startsAt,
            signedAt,
            ...(isManualOverride
                ? { signatureText: 'Manual Signature Override' }
                : { signatureImageBase64: signatureData }),
        });
        // Determine rental type from locked selection snapshot
        const rentalType = (session.desired_rental_type ||
            session.backup_rental_type ||
            'LOCKER');
        // Handle resource assignment
        let assignedResourceId = session.assigned_resource_id;
        let assignedResourceType = session.assigned_resource_type;
        let assignedResourceNumber;
        if (isRenewal) {
            assignedResourceId = renewalAssignedResourceId;
            assignedResourceType = renewalAssignedResourceType;
            assignedResourceNumber = renewalAssignedResourceNumber;
        }
        if (!isRenewal && assignedResourceId && assignedResourceType) {
            if (assignedResourceType === 'room') {
                const room = (await client.query(`SELECT id, number, type, status, assigned_to_customer_id FROM rooms WHERE id = $1 FOR UPDATE`, [assignedResourceId])).rows[0];
                if (!room)
                    throw { statusCode: 404, message: 'Selected room not found' };
                if (room.status !== 'CLEAN' || room.assigned_to_customer_id) {
                    throw { statusCode: 409, message: `Selected room ${room.number} is no longer available` };
                }
                const selectedByOther = await client.query(`SELECT id FROM lane_sessions
           WHERE id <> $1
             AND assigned_resource_type = 'room'
             AND assigned_resource_id = $2
             AND status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
           LIMIT 1`, [session.id, assignedResourceId]);
                if (selectedByOther.rows.length > 0) {
                    throw { statusCode: 409, message: `Selected room ${room.number} is reserved by another lane session` };
                }
                assignedResourceNumber = room.number;
            }
            else {
                const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id FROM lockers WHERE id = $1 FOR UPDATE`, [assignedResourceId])).rows[0];
                if (!locker)
                    throw { statusCode: 404, message: 'Selected locker not found' };
                if (locker.status !== 'CLEAN' || locker.assigned_to_customer_id) {
                    throw { statusCode: 409, message: `Selected locker ${locker.number} is no longer available` };
                }
                const selectedByOther = await client.query(`SELECT id FROM lane_sessions
           WHERE id <> $1
             AND assigned_resource_type = 'locker'
             AND assigned_resource_id = $2
             AND status = ANY(ARRAY['ACTIVE'::public.lane_session_status, 'AWAITING_CUSTOMER'::public.lane_session_status, 'AWAITING_ASSIGNMENT'::public.lane_session_status, 'AWAITING_PAYMENT'::public.lane_session_status, 'AWAITING_SIGNATURE'::public.lane_session_status])
           LIMIT 1`, [session.id, assignedResourceId]);
                if (selectedByOther.rows.length > 0) {
                    throw { statusCode: 409, message: `Selected locker ${locker.number} is reserved by another lane session` };
                }
                assignedResourceNumber = locker.number;
            }
        }
        else if (!isRenewal) {
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
                    throw { statusCode: 409, message: 'No available lockers' };
                assignedResourceId = locker.id;
                assignedResourceType = 'locker';
                assignedResourceNumber = locker.number;
            }
            else {
                const room = await (0, helpers_1.selectRoomForNewCheckin)(client, rentalType);
                if (!room)
                    throw { statusCode: 409, message: 'No available rooms' };
                assignedResourceId = room.id;
                assignedResourceType = 'room';
                assignedResourceNumber = room.number;
            }
        }
        if (!assignedResourceId || !assignedResourceType) {
            throw { statusCode: 500, message: 'Failed to assign a room or locker' };
        }
        // Assign inventory + mark OCCUPIED (server-authoritative)
        if (!isRenewal && assignedResourceType === 'room') {
            await client.query(`UPDATE rooms SET status = 'OCCUPIED', assigned_to_customer_id = $1, last_status_change = NOW(), updated_at = NOW() WHERE id = $2`, [session.customer_id, assignedResourceId]);
        }
        else if (!isRenewal) {
            await client.query(`UPDATE lockers SET status = 'OCCUPIED', assigned_to_customer_id = $1, updated_at = NOW() WHERE id = $2`, [session.customer_id, assignedResourceId]);
        }
        // Update lane session snapshot
        await client.query(`UPDATE lane_sessions
       SET assigned_resource_id = $1,
           assigned_resource_type = $2,
           agreement_signed_method = $3,
           agreement_bypass_pending = false,
           updated_at = NOW()
       WHERE id = $4`, [assignedResourceId, assignedResourceType, isManualOverride ? 'MANUAL' : 'DIGITAL', session.id]);
        // Flow commands (if enabled)
        if (isFlowCommandsEnabled()) {
            const commandId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `agr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            await client.query(`INSERT INTO lane_session_commands (session_id, command_id, actor, type, payload_json)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (session_id, command_id) DO NOTHING`, [session.id, commandId, 'CUSTOMER', 'SET_STEP', { step: 'ASSIGNMENT' }]);
            await client.query(`UPDATE lane_sessions
         SET flow_step = 'ASSIGNMENT',
             flow_version = COALESCE(flow_version, 0) + 1,
             flow_last_command_id = $1,
             flow_last_actor = 'CUSTOMER',
             updated_at = NOW()
         WHERE id = $2`, [commandId, session.id]);
        }
        // Create visit (if needed) and check-in block with PDF
        if (!visitId) {
            const visitResult = await client.query(`INSERT INTO visits (customer_id, started_at) VALUES ($1, $2) RETURNING id`, [session.customer_id, startsAt]);
            visitId = visitResult.rows[0].id;
        }
        const blockResult = await client.query(`INSERT INTO checkin_blocks
       (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_pdf, agreement_signed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
       RETURNING id`, [
            visitId,
            blockType,
            startsAt,
            endsAt,
            rentalType,
            assignedResourceType === 'room' ? assignedResourceId : null,
            assignedResourceType === 'locker' ? assignedResourceId : null,
            session.id,
            pdfBuffer,
            signedAt,
        ]);
        const checkinBlockId = blockResult.rows[0].id;
        // Waitlist entry if customer elected a waitlist/upgrade path
        let waitlistInfo;
        if (session.waitlist_desired_type && session.backup_rental_type) {
            const waitlistResult = await client.query(`INSERT INTO waitlist
         (visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
         RETURNING id`, [visitId, checkinBlockId, session.waitlist_desired_type, session.backup_rental_type, assignedResourceId]);
            const waitlistId = waitlistResult.rows[0].id;
            await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [waitlistId, checkinBlockId]);
            waitlistInfo = {
                waitlistId,
                status: 'ACTIVE',
                visitId: visitId,
                desiredTier: session.waitlist_desired_type,
            };
        }
        // Assert resource assignment persisted
        await (0, helpers_1.assertAssignedResourcePersistedAndUnavailable)({
            client,
            sessionId: session.id,
            customerId: session.customer_id,
            resourceType: assignedResourceType === 'room' ? 'room' : 'locker',
            resourceId: assignedResourceId,
            resourceNumber: assignedResourceNumber,
        });
        // Store signature as immutable audit artifact (only for digital signing)
        if (!isManualOverride && signatureData) {
            await client.query(`INSERT INTO agreement_signatures
         (agreement_id, checkin_block_id, customer_name, membership_number, signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                agreement.id,
                checkinBlockId,
                customerName,
                membershipNumber || null,
                signedAt,
                signatureData,
                agreementTextSnapshot,
                agreement.version,
                input.ctx.userAgent || null,
                input.ctx.ipAddress || null,
            ]);
        }
        // Update session status
        await client.query(`UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [session.id]);
        return {
            success: true,
            sessionId: session.id,
            customerId: session.customer_id,
            visitId: visitId,
            checkinBlockId,
            assignedResourceType: assignedResourceType,
            assignedResourceNumber,
            rentalType,
            laneId: input.laneId,
            waitlist: waitlistInfo,
        };
    });
    // Activity events (separate transaction — after main commit)
    await (0, db_1.transaction)(async (client) => {
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
            throw {
                statusCode: 400,
                message: 'Agreement bypass is only required for CHECKIN and RENEWAL check-ins',
            };
        }
        if (!session.selection_confirmed) {
            throw { statusCode: 400, message: 'Selection must be confirmed before bypassing agreement' };
        }
        if (!session.payment_intent_id) {
            throw { statusCode: 400, message: 'Payment intent must be created before bypassing agreement' };
        }
        const intentResult = await client.query(`SELECT status FROM payment_intents WHERE id = $1`, [session.payment_intent_id]);
        if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
            throw { statusCode: 400, message: 'Payment must be marked as paid before bypassing agreement' };
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
            throw { statusCode: 404, message: 'Session not found' };
        }
        const session = sessionResult.rows[0];
        if (input.confirmed) {
            if (!session.assigned_resource_type || !session.assigned_resource_id) {
                throw { statusCode: 400, message: 'No assigned resource to confirm' };
            }
            let confirmedType;
            let confirmedNumber;
            if (session.assigned_resource_type === 'room') {
                const roomRes = await client.query(`SELECT number FROM rooms WHERE id = $1 LIMIT 1`, [session.assigned_resource_id]);
                if (roomRes.rows.length === 0)
                    throw { statusCode: 404, message: 'Assigned room not found' };
                confirmedNumber = roomRes.rows[0].number;
                confirmedType = (0, waitlist_1.getRoomTier)(confirmedNumber);
            }
            else if (session.assigned_resource_type === 'locker') {
                const lockerRes = await client.query(`SELECT number FROM lockers WHERE id = $1 LIMIT 1`, [session.assigned_resource_id]);
                if (lockerRes.rows.length === 0)
                    throw { statusCode: 404, message: 'Assigned locker not found' };
                confirmedNumber = lockerRes.rows[0].number;
                confirmedType = 'LOCKER';
            }
            else {
                throw { statusCode: 400, message: 'Invalid assigned resource type' };
            }
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
        else {
            // Customer declined — unassign resource
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
    });
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
