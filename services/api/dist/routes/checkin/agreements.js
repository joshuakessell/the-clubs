"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCheckinAgreementRoutes = registerCheckinAgreementRoutes;
const middleware_1 = require("../../auth/middleware");
const kioskToken_1 = require("../../auth/kioskToken");
const shared_1 = require("@the-clubs/shared");
const db_1 = require("../../db");
const payload_1 = require("../../checkin/payload");
const helpers_1 = require("../../checkin/helpers");
const utils_1 = require("../../checkin/utils");
const waitlist_1 = require("../../checkin/waitlist");
const pdf_generator_1 = require("../../utils/pdf-generator");
const rounding_1 = require("../../time/rounding");
const broadcast_1 = require("../../inventory/broadcast");
const auditLog_1 = require("../../audit/auditLog");
const customerActivityLog_1 = require("../../activity/customerActivityLog");
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
function registerCheckinAgreementRoutes(fastify) {
    /**
     * POST /v1/checkin/lane/:laneId/sign-agreement
     *
     * Store agreement signature, generate PDF, auto-assign resource, and create check-in block.
     * Public endpoint (customer kiosk can call without auth).
     */
    fastify.post('/v1/checkin/lane/:laneId/sign-agreement', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const { signaturePayload } = request.body;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Get active session (by sessionId if provided, otherwise latest for lane)
                let sessionResult;
                if (request.body.sessionId) {
                    sessionResult = await client.query(`SELECT * FROM lane_sessions
             WHERE id = $1 AND lane_id = $2 AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
             LIMIT 1`, [request.body.sessionId, laneId]);
                }
                else {
                    sessionResult = await client.query(`SELECT * FROM lane_sessions
             WHERE lane_id = $1 AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
             ORDER BY created_at DESC
             LIMIT 1`, [laneId]);
                }
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
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
                // Get customer identity info for PDF + signature snapshot
                const customerResult = session.customer_id
                    ? await client.query(`SELECT name, dob, membership_number, primary_language FROM customers WHERE id = $1`, [session.customer_id])
                    : {
                        rows: [],
                    };
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
                // Store signature (extract base64 from data URL if needed)
                const signatureData = signaturePayload.startsWith('data:')
                    ? signaturePayload.split(',')[1]
                    : signaturePayload;
                if (!signatureData || signatureData.trim().length < 16) {
                    throw { statusCode: 400, message: 'Signature payload is required' };
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
                    const visitResult = await client.query(`SELECT id
               FROM visits
               WHERE customer_id = $1 AND ended_at IS NULL
               ORDER BY started_at DESC
               LIMIT 1`, [session.customer_id]);
                    if (visitResult.rows.length === 0) {
                        throw { statusCode: 400, message: 'No active visit found for renewal' };
                    }
                    visitId = visitResult.rows[0].id;
                    const blocksResult = await client.query(`SELECT starts_at, ends_at, room_id, locker_id
               FROM checkin_blocks
               WHERE visit_id = $1
               ORDER BY ends_at DESC`, [visitId]);
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
                        throw {
                            statusCode: 400,
                            message: 'Renewal is only available within 1 hour of checkout',
                        };
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
                        const room = (await client.query(`SELECT id, number, type, status, assigned_to_customer_id
                   FROM rooms
                   WHERE id = $1
                   LIMIT 1`, [latestBlock.room_id])).rows[0];
                        if (!room) {
                            throw { statusCode: 400, message: 'Renewal room assignment not found' };
                        }
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
                        const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id
                   FROM lockers
                   WHERE id = $1
                   LIMIT 1`, [latestBlock.locker_id])).rows[0];
                        if (!locker) {
                            throw { statusCode: 400, message: 'Renewal locker assignment not found' };
                        }
                        if (locker.assigned_to_customer_id !== session.customer_id ||
                            locker.status !== 'OCCUPIED') {
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
                const agreementTimeBlockHtml = buildAgreementTimeBlockHtml({
                    startsAt,
                    endsAt,
                    lang: customerLang,
                });
                const baseAgreementTextSnapshot = customerLang === 'ES' ? shared_1.AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES : agreement.body_text;
                const agreementTextSnapshot = `${agreementTimeBlockHtml}${baseAgreementTextSnapshot}`;
                const agreementTitleForPdf = customerLang === 'ES' ? 'Acuerdo del Club' : agreement.title;
                // Generate PDF (robust pdf-lib)
                let pdfBuffer;
                try {
                    pdfBuffer = await (0, pdf_generator_1.generateAgreementPdf)({
                        agreementTitle: agreementTitleForPdf,
                        agreementVersion: agreement.version,
                        agreementText: agreementTextSnapshot,
                        customerName,
                        customerDob,
                        membershipNumber,
                        checkinAt: startsAt,
                        signedAt,
                        signatureImageBase64: signatureData,
                    });
                }
                catch (e) {
                    request.log.warn({ err: e }, 'Failed to generate agreement PDF from provided signature');
                    throw {
                        statusCode: 400,
                        message: 'Invalid signature image (expected PNG data URL or base64)',
                    };
                }
                // Determine rental type from locked selection snapshot
                const rentalType = (session.desired_rental_type ||
                    session.backup_rental_type ||
                    'LOCKER');
                // Assignment happens AFTER agreement signing (demo requirement).
                // We either use the pre-selected resource on the lane session, or auto-pick the first available.
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
                        const room = (await client.query(`SELECT id, number, type, status, assigned_to_customer_id
                 FROM rooms
                 WHERE id = $1
                 FOR UPDATE`, [assignedResourceId])).rows[0];
                        if (!room)
                            throw { statusCode: 404, message: 'Selected room not found' };
                        if (room.status !== 'CLEAN' || room.assigned_to_customer_id) {
                            throw {
                                statusCode: 409,
                                message: `Selected room ${room.number} is no longer available`,
                            };
                        }
                        // Ensure another active lane session did not also "select" this room.
                        const selectedByOther = await client.query(`SELECT id, lane_id
                 FROM lane_sessions
                 WHERE id <> $1
                   AND assigned_resource_type = 'room'
                   AND assigned_resource_id = $2
                   AND status = ANY (
                     ARRAY[
                       'ACTIVE'::public.lane_session_status,
                       'AWAITING_CUSTOMER'::public.lane_session_status,
                       'AWAITING_ASSIGNMENT'::public.lane_session_status,
                       'AWAITING_PAYMENT'::public.lane_session_status,
                       'AWAITING_SIGNATURE'::public.lane_session_status
                     ]
                   )
                 LIMIT 1`, [session.id, assignedResourceId]);
                        if (selectedByOther.rows.length > 0) {
                            throw {
                                statusCode: 409,
                                message: `Selected room ${room.number} is reserved by another lane session`,
                            };
                        }
                        assignedResourceNumber = room.number;
                    }
                    else {
                        const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id
                 FROM lockers
                 WHERE id = $1
                 FOR UPDATE`, [assignedResourceId])).rows[0];
                        if (!locker)
                            throw { statusCode: 404, message: 'Selected locker not found' };
                        if (locker.status !== 'CLEAN' || locker.assigned_to_customer_id) {
                            throw {
                                statusCode: 409,
                                message: `Selected locker ${locker.number} is no longer available`,
                            };
                        }
                        // Ensure another active lane session did not also "select" this locker.
                        const selectedByOther = await client.query(`SELECT id, lane_id
                 FROM lane_sessions
                 WHERE id <> $1
                   AND assigned_resource_type = 'locker'
                   AND assigned_resource_id = $2
                   AND status = ANY (
                     ARRAY[
                       'ACTIVE'::public.lane_session_status,
                       'AWAITING_CUSTOMER'::public.lane_session_status,
                       'AWAITING_ASSIGNMENT'::public.lane_session_status,
                       'AWAITING_PAYMENT'::public.lane_session_status,
                       'AWAITING_SIGNATURE'::public.lane_session_status
                     ]
                   )
                 LIMIT 1`, [session.id, assignedResourceId]);
                        if (selectedByOther.rows.length > 0) {
                            throw {
                                statusCode: 409,
                                message: `Selected locker ${locker.number} is reserved by another lane session`,
                            };
                        }
                        assignedResourceNumber = locker.number;
                    }
                }
                else if (!isRenewal) {
                    if (rentalType === 'LOCKER' || rentalType === 'GYM_LOCKER') {
                        const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id
                 FROM lockers
                 WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL
                 -- Exclude lockers "selected" by an active lane session (reservation semantics).
                 AND NOT EXISTS (
                   SELECT 1
                   FROM lane_sessions ls
                   WHERE ls.assigned_resource_type = 'locker'
                     AND ls.assigned_resource_id = lockers.id
                     AND ls.status = ANY (
                       ARRAY[
                         'ACTIVE'::public.lane_session_status,
                         'AWAITING_CUSTOMER'::public.lane_session_status,
                         'AWAITING_ASSIGNMENT'::public.lane_session_status,
                         'AWAITING_PAYMENT'::public.lane_session_status,
                         'AWAITING_SIGNATURE'::public.lane_session_status
                       ]
                     )
                 )
                 ORDER BY number
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`)).rows[0];
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
                // Assign inventory + mark OCCUPIED (server-authoritative, transactional)
                if (!isRenewal && assignedResourceType === 'room') {
                    await client.query(`UPDATE rooms
             SET status = 'OCCUPIED',
                 assigned_to_customer_id = $1,
                 last_status_change = NOW(),
                 updated_at = NOW()
             WHERE id = $2`, [session.customer_id, assignedResourceId]);
                }
                else if (!isRenewal) {
                    await client.query(`UPDATE lockers
             SET status = 'OCCUPIED',
                 assigned_to_customer_id = $1,
                 updated_at = NOW()
             WHERE id = $2`, [session.customer_id, assignedResourceId]);
                }
                // Ensure lane session snapshot fields are set
                await client.query(`UPDATE lane_sessions
           SET assigned_resource_id = $1,
               assigned_resource_type = $2,
               agreement_signed_method = 'DIGITAL',
               agreement_bypass_pending = false,
               updated_at = NOW()
           WHERE id = $3`, [assignedResourceId, assignedResourceType, session.id]);
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
                // Complete check-in: create visit (if needed) and check-in block with PDF
                if (!visitId) {
                    const visitResult = await client.query(`INSERT INTO visits (customer_id, started_at) VALUES ($1, $2) RETURNING id`, [session.customer_id, startsAt]);
                    visitId = visitResult.rows[0].id;
                }
                // Create checkin_block with PDF
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
                // If customer elected a waitlist/upgrade path (desired tier + backup tier), persist waitlist entry now.
                if (session.waitlist_desired_type && session.backup_rental_type) {
                    const waitlistResult = await client.query(`INSERT INTO waitlist
               (visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, status)
               VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
               RETURNING id`, [
                        visitId,
                        checkinBlockId,
                        session.waitlist_desired_type,
                        session.backup_rental_type,
                        assignedResourceId,
                    ]);
                    const waitlistId = waitlistResult.rows[0].id;
                    await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [
                        waitlistId,
                        checkinBlockId,
                    ]);
                    // Broadcast waitlist update (employee register will refetch list)
                    fastify.broadcaster.broadcast({
                        type: 'WAITLIST_UPDATED',
                        payload: {
                            waitlistId,
                            status: 'ACTIVE',
                            visitId,
                            desiredTier: session.waitlist_desired_type,
                        },
                        timestamp: new Date().toISOString(),
                    });
                }
                // Part A: server-side assertion (same TX) that assignment persisted and the resource
                // cannot qualify as "available" immediately after successful check-in creation.
                await (0, helpers_1.assertAssignedResourcePersistedAndUnavailable)({
                    client,
                    sessionId: session.id,
                    customerId: session.customer_id,
                    resourceType: assignedResourceType === 'room' ? 'room' : 'locker',
                    resourceId: assignedResourceId,
                    resourceNumber: assignedResourceNumber,
                });
                // Store signature as immutable audit artifact
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
                    request.headers['user-agent'] || null,
                    request.ip || null,
                ]);
                // Legacy notes cleanup removed; structured notes live in customer_notes.
                // Update session status
                await client.query(`UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [session.id]);
                // Broadcast assignment created (final, after signing)
                const assignmentPayload = {
                    sessionId: session.id,
                    roomId: assignedResourceType === 'room' ? assignedResourceId : undefined,
                    roomNumber: assignedResourceType === 'room' ? assignedResourceNumber : undefined,
                    lockerId: assignedResourceType === 'locker' ? assignedResourceId : undefined,
                    lockerNumber: assignedResourceType === 'locker' ? assignedResourceNumber : undefined,
                    rentalType,
                };
                fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);
                return { success: true, sessionId: session.id, customerId: session.customer_id, visitId, checkinBlockId, assignedResourceType, assignedResourceNumber, rentalType };
            });
            await (0, db_1.transaction)(async (client) => {
                // Activity event: AGREEMENT_SIGNED (resource assignment details)
                await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
                    customerId: result.customerId,
                    actionType: 'AGREEMENT_SIGNED',
                    actionCategory: 'CHECKIN',
                    sourceApp: request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
                    actorType: request.staff ? 'STAFF' : 'CUSTOMER',
                    actorStaffId: request.staff?.staffId ?? null,
                    actorStaffName: request.staff?.name ?? null,
                    summary: `Agreement signed — ${result.assignedResourceType} ${result.assignedResourceNumber} (${result.rentalType})`,
                    metadata: {
                        visitId: result.visitId,
                        checkinBlockId: result.checkinBlockId,
                        laneId,
                        laneSessionId: result.sessionId,
                        ...(result.assignedResourceType === 'room'
                            ? { roomNumber: result.assignedResourceNumber }
                            : { lockerNumber: result.assignedResourceNumber }),
                    },
                    dedupeKey: result.checkinBlockId ? `ACT:AGREEMENT_SIGNED:${result.checkinBlockId}` : null,
                    searchParts: [result.assignedResourceNumber ?? ''],
                });
                // Activity event: CHECKIN_COMPLETED
                const event = await (0, customerActivityLog_1.insertCustomerActivityEvent)(client, {
                    customerId: result.customerId,
                    actionType: 'CHECKIN_COMPLETED',
                    actionCategory: 'CHECKIN',
                    sourceApp: request.staff ? 'EMPLOYEE_REGISTER' : 'CUSTOMER_KIOSK',
                    actorType: request.staff ? 'STAFF' : 'CUSTOMER',
                    actorStaffId: request.staff?.staffId ?? null,
                    actorStaffName: request.staff?.name ?? null,
                    summary: 'Check-in completed',
                    metadata: {
                        visitId: result.visitId,
                        checkinBlockId: result.checkinBlockId,
                        laneId,
                        laneSessionId: result.sessionId,
                    },
                    dedupeKey: result.visitId ? `ACT:CHECKIN_COMPLETED:${result.visitId}` : null,
                    searchParts: [result.visitId ?? '', result.checkinBlockId ?? ''],
                });
                request.log.info({
                    customerActivityEventId: event.id,
                    customerId: result.customerId,
                    sessionId: result.sessionId,
                    assignedResourceType: result.assignedResourceType,
                    assignedResourceNumber: result.assignedResourceNumber,
                    rentalType: result.rentalType,
                    laneId,
                }, 'Agreement signed and check-in completed');
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to sign agreement');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to sign agreement',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to sign agreement',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/manual-signature-override
     *
     * Employee override to complete agreement signing without customer signature.
     * Requires authentication. Generates PDF with "Manual Signature Override" text.
     */
    fastify.post('/v1/checkin/lane/:laneId/manual-signature-override', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const { sessionId } = request.body;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                // Get active session (by sessionId if provided, otherwise latest for lane)
                let sessionResult;
                if (sessionId) {
                    sessionResult = await client.query(`SELECT * FROM lane_sessions
             WHERE id = $1 AND lane_id = $2 AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
             LIMIT 1`, [sessionId, laneId]);
                }
                else {
                    sessionResult = await client.query(`SELECT * FROM lane_sessions
             WHERE lane_id = $1 AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
             ORDER BY created_at DESC
             LIMIT 1`, [laneId]);
                }
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
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
                // Get customer identity info for PDF + signature snapshot
                const customerResult = session.customer_id
                    ? await client.query(`SELECT name, dob, membership_number, primary_language FROM customers WHERE id = $1`, [session.customer_id])
                    : {
                        rows: [],
                    };
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
                    const visitResult = await client.query(`SELECT id
               FROM visits
               WHERE customer_id = $1 AND ended_at IS NULL
               ORDER BY started_at DESC
               LIMIT 1`, [session.customer_id]);
                    if (visitResult.rows.length === 0) {
                        throw { statusCode: 400, message: 'No active visit found for renewal' };
                    }
                    visitId = visitResult.rows[0].id;
                    const blocksResult = await client.query(`SELECT starts_at, ends_at, room_id, locker_id
               FROM checkin_blocks
               WHERE visit_id = $1
               ORDER BY ends_at DESC`, [visitId]);
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
                        throw {
                            statusCode: 400,
                            message: 'Renewal is only available within 1 hour of checkout',
                        };
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
                        const room = (await client.query(`SELECT id, number, type, status, assigned_to_customer_id
                   FROM rooms
                   WHERE id = $1
                   LIMIT 1`, [latestBlock.room_id])).rows[0];
                        if (!room) {
                            throw { statusCode: 400, message: 'Renewal room assignment not found' };
                        }
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
                        const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id
                   FROM lockers
                   WHERE id = $1
                   LIMIT 1`, [latestBlock.locker_id])).rows[0];
                        if (!locker) {
                            throw { statusCode: 400, message: 'Renewal locker assignment not found' };
                        }
                        if (locker.assigned_to_customer_id !== session.customer_id ||
                            locker.status !== 'OCCUPIED') {
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
                const agreementTimeBlockHtml = buildAgreementTimeBlockHtml({
                    startsAt,
                    endsAt,
                    lang: customerLang,
                });
                const baseAgreementTextSnapshot = customerLang === 'ES' ? shared_1.AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES : agreement.body_text;
                const agreementTextSnapshot = `${agreementTimeBlockHtml}${baseAgreementTextSnapshot}`;
                const agreementTitleForPdf = customerLang === 'ES' ? 'Acuerdo del Club' : agreement.title;
                // Generate PDF with override text instead of signature image
                let pdfBuffer;
                try {
                    pdfBuffer = await (0, pdf_generator_1.generateAgreementPdf)({
                        agreementTitle: agreementTitleForPdf,
                        agreementVersion: agreement.version,
                        agreementText: agreementTextSnapshot,
                        customerName,
                        customerDob,
                        membershipNumber,
                        checkinAt: startsAt,
                        signatureText: 'Manual Signature Override',
                        signedAt,
                    });
                }
                catch (e) {
                    request.log.warn({ err: e }, 'Failed to generate agreement PDF for manual override');
                    throw { statusCode: 500, message: 'Failed to generate agreement PDF' };
                }
                // Determine rental type from locked selection snapshot
                const rentalType = (session.desired_rental_type ||
                    session.backup_rental_type ||
                    'LOCKER');
                // Assignment happens AFTER agreement signing (same as normal flow)
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
                        const room = (await client.query(`SELECT id, number, type, status, assigned_to_customer_id
                 FROM rooms
                 WHERE id = $1
                 FOR UPDATE`, [assignedResourceId])).rows[0];
                        if (!room)
                            throw { statusCode: 404, message: 'Selected room not found' };
                        if (room.status !== 'CLEAN' || room.assigned_to_customer_id) {
                            throw {
                                statusCode: 409,
                                message: `Selected room ${room.number} is no longer available`,
                            };
                        }
                        // Ensure another active lane session did not also "select" this room.
                        const selectedByOther = await client.query(`SELECT id, lane_id
                 FROM lane_sessions
                 WHERE id <> $1
                   AND assigned_resource_type = 'room'
                   AND assigned_resource_id = $2
                   AND status = ANY (
                     ARRAY[
                       'ACTIVE'::public.lane_session_status,
                       'AWAITING_CUSTOMER'::public.lane_session_status,
                       'AWAITING_ASSIGNMENT'::public.lane_session_status,
                       'AWAITING_PAYMENT'::public.lane_session_status,
                       'AWAITING_SIGNATURE'::public.lane_session_status
                     ]
                   )
                 LIMIT 1`, [session.id, assignedResourceId]);
                        if (selectedByOther.rows.length > 0) {
                            throw {
                                statusCode: 409,
                                message: `Selected room ${room.number} is reserved by another lane session`,
                            };
                        }
                        assignedResourceNumber = room.number;
                    }
                    else {
                        const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id
                 FROM lockers
                 WHERE id = $1
                 FOR UPDATE`, [assignedResourceId])).rows[0];
                        if (!locker)
                            throw { statusCode: 404, message: 'Selected locker not found' };
                        if (locker.status !== 'CLEAN' || locker.assigned_to_customer_id) {
                            throw {
                                statusCode: 409,
                                message: `Selected locker ${locker.number} is no longer available`,
                            };
                        }
                        // Ensure another active lane session did not also "select" this locker.
                        const selectedByOther = await client.query(`SELECT id, lane_id
                 FROM lane_sessions
                 WHERE id <> $1
                   AND assigned_resource_type = 'locker'
                   AND assigned_resource_id = $2
                   AND status = ANY (
                     ARRAY[
                       'ACTIVE'::public.lane_session_status,
                       'AWAITING_CUSTOMER'::public.lane_session_status,
                       'AWAITING_ASSIGNMENT'::public.lane_session_status,
                       'AWAITING_PAYMENT'::public.lane_session_status,
                       'AWAITING_SIGNATURE'::public.lane_session_status
                     ]
                   )
                 LIMIT 1`, [session.id, assignedResourceId]);
                        if (selectedByOther.rows.length > 0) {
                            throw {
                                statusCode: 409,
                                message: `Selected locker ${locker.number} is reserved by another lane session`,
                            };
                        }
                        assignedResourceNumber = locker.number;
                    }
                }
                else if (!isRenewal) {
                    if (rentalType === 'LOCKER' || rentalType === 'GYM_LOCKER') {
                        const locker = (await client.query(`SELECT id, number, status, assigned_to_customer_id
                 FROM lockers
                 WHERE status = 'CLEAN' AND assigned_to_customer_id IS NULL
                 -- Exclude lockers "selected" by an active lane session (reservation semantics).
                 AND NOT EXISTS (
                   SELECT 1
                   FROM lane_sessions ls
                   WHERE ls.assigned_resource_type = 'locker'
                     AND ls.assigned_resource_id = lockers.id
                     AND ls.status = ANY (
                       ARRAY[
                         'ACTIVE'::public.lane_session_status,
                         'AWAITING_CUSTOMER'::public.lane_session_status,
                         'AWAITING_ASSIGNMENT'::public.lane_session_status,
                         'AWAITING_PAYMENT'::public.lane_session_status,
                         'AWAITING_SIGNATURE'::public.lane_session_status
                       ]
                     )
                 )
                 ORDER BY number
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`)).rows[0];
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
                // Assign inventory + mark OCCUPIED (server-authoritative, transactional)
                if (!isRenewal && assignedResourceType === 'room') {
                    await client.query(`UPDATE rooms
             SET status = 'OCCUPIED',
                 assigned_to_customer_id = $1,
                 last_status_change = NOW(),
                 updated_at = NOW()
             WHERE id = $2`, [session.customer_id, assignedResourceId]);
                }
                else if (!isRenewal) {
                    await client.query(`UPDATE lockers
             SET status = 'OCCUPIED',
                 assigned_to_customer_id = $1,
                 updated_at = NOW()
             WHERE id = $2`, [session.customer_id, assignedResourceId]);
                }
                // Ensure lane session snapshot fields are set
                await client.query(`UPDATE lane_sessions
           SET assigned_resource_id = $1,
               assigned_resource_type = $2,
               agreement_signed_method = 'MANUAL',
               agreement_bypass_pending = false,
               updated_at = NOW()
           WHERE id = $3`, [assignedResourceId, assignedResourceType, session.id]);
                // Complete check-in: create visit (if needed) and check-in block with PDF
                if (!visitId) {
                    const visitResult = await client.query(`INSERT INTO visits (customer_id, started_at) VALUES ($1, $2) RETURNING id`, [session.customer_id, startsAt]);
                    visitId = visitResult.rows[0]?.id ?? null;
                }
                if (!visitId) {
                    throw { statusCode: 500, message: 'Failed to create visit' };
                }
                const checkoutAt = endsAt;
                const blockResult = await client.query(`INSERT INTO checkin_blocks
           (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, session_id, agreement_signed, agreement_pdf, agreement_signed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
           RETURNING id`, [
                    visitId,
                    blockType,
                    startsAt,
                    checkoutAt,
                    rentalType,
                    assignedResourceType === 'room' ? assignedResourceId : null,
                    assignedResourceType === 'locker' ? assignedResourceId : null,
                    session.id,
                    pdfBuffer,
                    signedAt,
                ]);
                const blockId = blockResult.rows[0].id;
                await client.query(`INSERT INTO agreement_signatures
           (agreement_id, checkin_block_id, customer_name, membership_number, signed_at, signature_png_base64, agreement_text_snapshot, agreement_version, user_agent, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [
                    agreement.id,
                    blockId,
                    customerName,
                    membershipNumber || null,
                    signedAt,
                    null,
                    agreementTextSnapshot,
                    agreement.version,
                    request.headers['user-agent'] || null,
                    request.ip || null,
                ]);
                // If customer elected a waitlist/upgrade path (desired tier + backup tier), persist waitlist entry now.
                if (session.waitlist_desired_type && session.backup_rental_type) {
                    const waitlistResult = await client.query(`INSERT INTO waitlist
               (visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, status)
               VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
               RETURNING id`, [
                        visitId,
                        blockId,
                        session.waitlist_desired_type,
                        session.backup_rental_type,
                        assignedResourceId,
                    ]);
                    const waitlistId = waitlistResult.rows[0].id;
                    await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [
                        waitlistId,
                        blockId,
                    ]);
                    fastify.broadcaster.broadcast({
                        type: 'WAITLIST_UPDATED',
                        payload: {
                            waitlistId,
                            status: 'ACTIVE',
                            visitId,
                            desiredTier: session.waitlist_desired_type,
                        },
                        timestamp: new Date().toISOString(),
                    });
                }
                // Part A: server-side assertion (same TX) that assignment persisted and the resource
                // cannot qualify as "available" immediately after successful check-in creation.
                await (0, helpers_1.assertAssignedResourcePersistedAndUnavailable)({
                    client,
                    sessionId: session.id,
                    customerId: session.customer_id,
                    resourceType: assignedResourceType === 'room' ? 'room' : 'locker',
                    resourceId: assignedResourceId,
                    resourceNumber: assignedResourceNumber,
                });
                // Update lane session status to COMPLETED
                await client.query(`UPDATE lane_sessions
           SET status = 'COMPLETED',
               updated_at = NOW()
           WHERE id = $1`, [session.id]);
                const assignmentPayload = {
                    sessionId: session.id,
                    roomId: assignedResourceType === 'room' ? assignedResourceId : undefined,
                    roomNumber: assignedResourceType === 'room' ? assignedResourceNumber : undefined,
                    lockerId: assignedResourceType === 'locker' ? assignedResourceId : undefined,
                    lockerNumber: assignedResourceType === 'locker' ? assignedResourceNumber : undefined,
                    rentalType,
                };
                fastify.broadcaster.broadcastAssignmentCreated(assignmentPayload, laneId);
                // Log audit entry for manual override
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId: request.staff?.staffId ?? null,
                    action: 'OVERRIDE',
                    entityType: 'checkin_block',
                    entityId: blockId,
                    metadata: {
                        overrideType: 'MANUAL_SIGNATURE_OVERRIDE',
                        sessionId: session.id,
                        laneId,
                        customerId: session.customer_id,
                        customerName,
                        rentalType,
                        assignedResourceType,
                        assignedResourceNumber,
                    },
                });
                return {
                    success: true,
                    sessionId: session.id,
                    blockId,
                    assignedResourceType,
                    assignedResourceNumber,
                    checkoutAt: checkoutAt.toISOString(),
                };
            });
            // Broadcast session update
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            await (0, broadcast_1.broadcastInventoryUpdate)(fastify.broadcaster);
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to process manual signature override');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to process manual signature override',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to process manual signature override',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/agreement-bypass
     *
     * Staff-only: request bypass of digital agreement so staff can collect a physical signature.
     */
    fastify.post('/v1/checkin/lane/:laneId/agreement-bypass', {
        preHandler: [middleware_1.requireAuth],
    }, async (request, reply) => {
        if (!request.staff)
            return reply.status(401).send({ error: 'Unauthorized' });
        const { laneId } = request.params;
        const { sessionId } = request.body;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = sessionId
                    ? await client.query(`SELECT * FROM lane_sessions
                 WHERE id = $1 AND lane_id = $2
                   AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
                 LIMIT 1`, [sessionId, laneId])
                    : await client.query(`SELECT * FROM lane_sessions
                 WHERE lane_id = $1
                   AND status IN ('AWAITING_SIGNATURE', 'AWAITING_PAYMENT')
                 ORDER BY created_at DESC
                 LIMIT 1`, [laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                if (session.checkin_mode !== 'CHECKIN' && session.checkin_mode !== 'RENEWAL') {
                    throw {
                        statusCode: 400,
                        message: 'Agreement bypass is only required for CHECKIN and RENEWAL check-ins',
                    };
                }
                if (!session.selection_confirmed) {
                    throw {
                        statusCode: 400,
                        message: 'Selection must be confirmed before bypassing agreement',
                    };
                }
                if (!session.payment_intent_id) {
                    throw {
                        statusCode: 400,
                        message: 'Payment intent must be created before bypassing agreement',
                    };
                }
                const intentResult = await client.query(`SELECT status FROM payment_intents WHERE id = $1`, [session.payment_intent_id]);
                if (intentResult.rows.length === 0 || intentResult.rows[0].status !== 'PAID') {
                    throw {
                        statusCode: 400,
                        message: 'Payment must be marked as paid before bypassing agreement',
                    };
                }
                await client.query(`UPDATE lane_sessions
             SET agreement_bypass_pending = true,
                 updated_at = NOW()
             WHERE id = $1`, [session.id]);
                return { sessionId: session.id, laneId: session.lane_id || laneId };
            });
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, result.sessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, result.laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to bypass agreement');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to bypass agreement',
                    code: httpErr.code,
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to bypass agreement',
            });
        }
    });
    /**
     * POST /v1/checkin/lane/:laneId/customer-confirm
     *
     * Customer confirms or declines cross-type assignment.
     */
    fastify.post('/v1/checkin/lane/:laneId/customer-confirm', { preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff] }, async (request, reply) => {
        const { laneId } = request.params;
        const { sessionId, confirmed } = request.body;
        try {
            const result = await (0, db_1.transaction)(async (client) => {
                const sessionResult = await client.query(`SELECT * FROM lane_sessions WHERE id = $1 AND lane_id = $2`, [sessionId, laneId]);
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'Session not found' };
                }
                const session = sessionResult.rows[0];
                if (confirmed) {
                    // Customer confirmed - broadcast confirmation.
                    //
                    // IMPORTANT: assigned_resource_id is a UUID. The customer-confirm event payload expects
                    // a human-facing type+number (room tier + room number, or locker number). Do NOT derive
                    // tier/number from the UUID.
                    if (!session.assigned_resource_type || !session.assigned_resource_id) {
                        throw { statusCode: 400, message: 'No assigned resource to confirm' };
                    }
                    let confirmedType;
                    let confirmedNumber;
                    if (session.assigned_resource_type === 'room') {
                        const roomRes = await client.query(`SELECT number FROM rooms WHERE id = $1 LIMIT 1`, [session.assigned_resource_id]);
                        if (roomRes.rows.length === 0) {
                            throw { statusCode: 404, message: 'Assigned room not found' };
                        }
                        confirmedNumber = roomRes.rows[0].number;
                        confirmedType = (0, waitlist_1.getRoomTier)(confirmedNumber);
                    }
                    else if (session.assigned_resource_type === 'locker') {
                        const lockerRes = await client.query(`SELECT number FROM lockers WHERE id = $1 LIMIT 1`, [session.assigned_resource_id]);
                        if (lockerRes.rows.length === 0) {
                            throw { statusCode: 404, message: 'Assigned locker not found' };
                        }
                        confirmedNumber = lockerRes.rows[0].number;
                        confirmedType = 'LOCKER';
                    }
                    else {
                        throw { statusCode: 400, message: 'Invalid assigned resource type' };
                    }
                    const confirmedPayload = {
                        sessionId: session.id,
                        confirmedType,
                        confirmedNumber,
                    };
                    fastify.broadcaster.broadcastCustomerConfirmed(confirmedPayload, laneId);
                }
                else {
                    // Customer declined - unassign resource and broadcast decline
                    if (session.assigned_resource_id) {
                        if (session.assigned_resource_type === 'room') {
                            await client.query(`UPDATE rooms SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $1`, [session.assigned_resource_id]);
                        }
                        else if (session.assigned_resource_type === 'locker') {
                            await client.query(`UPDATE lockers SET assigned_to_customer_id = NULL, updated_at = NOW() WHERE id = $1`, [session.assigned_resource_id]);
                        }
                        await client.query(`UPDATE lane_sessions SET assigned_resource_id = NULL, assigned_resource_type = NULL, updated_at = NOW() WHERE id = $1`, [session.id]);
                    }
                    const declinedPayload = {
                        sessionId: session.id,
                        requestedType: session.desired_rental_type || '',
                    };
                    fastify.broadcaster.broadcastCustomerDeclined(declinedPayload, laneId);
                }
                return { success: true, confirmed };
            });
            return reply.send(result);
        }
        catch (error) {
            request.log.error(error, 'Failed to process customer confirmation');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({
                    error: httpErr.message ?? 'Failed to process confirmation',
                });
            }
            return reply.status(500).send({
                error: 'Internal Server Error',
                message: 'Failed to process customer confirmation',
            });
        }
    });
    /**
     * Complete check-in: create visit, check-in block, and transition resources.
     */
    void completeCheckIn;
    async function completeCheckIn(client, session, staffId) {
        if (!session.customer_id || !session.assigned_resource_id || !session.assigned_resource_type) {
            throw new Error('Cannot complete check-in without customer and resource assignment');
        }
        const isRenewal = session.checkin_mode === 'RENEWAL';
        const renewalHours = session.renewal_hours === 2 || session.renewal_hours === 6 ? session.renewal_hours : null;
        const rentalType = (session.desired_rental_type ||
            session.backup_rental_type ||
            'LOCKER');
        let visitId;
        let startsAt;
        let endsAt;
        let blockType;
        if (isRenewal) {
            if (!renewalHours) {
                throw new Error('Renewal hours not set for this session');
            }
            // For RENEWAL: find existing visit and get latest block end time
            const visitResult = await client.query(`SELECT id FROM visits WHERE customer_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`, [session.customer_id]);
            if (visitResult.rows.length === 0) {
                throw new Error('No active visit found for renewal');
            }
            visitId = visitResult.rows[0].id;
            // Get existing blocks to calculate total hours and find latest checkout
            const blocksResult = await client.query(`SELECT starts_at, ends_at FROM checkin_blocks WHERE visit_id = $1 ORDER BY ends_at DESC`, [visitId]);
            if (blocksResult.rows.length === 0) {
                throw new Error('Visit has no blocks');
            }
            // Calculate total hours if renewal is added
            let currentTotalHours = 0;
            for (const block of blocksResult.rows) {
                const hours = (block.ends_at.getTime() - block.starts_at.getTime()) / (1000 * 60 * 60);
                currentTotalHours += hours;
            }
            const latestBlockEnd = blocksResult.rows[0].ends_at;
            const diffMs = Math.abs(latestBlockEnd.getTime() - Date.now());
            if (diffMs > 60 * 60 * 1000) {
                throw new Error('Renewal is only available within 1 hour of checkout');
            }
            // Check 14-hour limit
            if (currentTotalHours + renewalHours > 14) {
                throw new Error(`Renewal would exceed 14-hour maximum. Current total: ${currentTotalHours} hours, renewal would add ${renewalHours} hours.`);
            }
            // Renewal extends from previous checkout time, not from now
            startsAt = latestBlockEnd;
            endsAt =
                renewalHours === 2
                    ? new Date(startsAt.getTime() + 2 * 60 * 60 * 1000)
                    : (0, rounding_1.roundUpToQuarterHour)(new Date(startsAt.getTime() + 6 * 60 * 60 * 1000));
            blockType = renewalHours === 2 ? 'FINAL2H' : 'RENEWAL';
        }
        else {
            // For CHECKIN: create new visit
            const visitResult = await client.query(`INSERT INTO visits (customer_id, started_at)
         VALUES ($1, NOW())
         RETURNING id`, [session.customer_id]);
            visitId = visitResult.rows[0].id;
            // Create check-in block (6 hours from now)
            startsAt = new Date();
            endsAt = (0, rounding_1.roundUpToQuarterHour)(new Date(startsAt.getTime() + 6 * 60 * 60 * 1000));
            blockType = 'INITIAL';
        }
        const blockResult = await client.query(`INSERT INTO checkin_blocks 
       (visit_id, block_type, starts_at, ends_at, rental_type, room_id, locker_id, agreement_signed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id`, [
            visitId,
            blockType,
            startsAt,
            endsAt,
            rentalType,
            session.assigned_resource_type === 'room' ? session.assigned_resource_id : null,
            session.assigned_resource_type === 'locker' ? session.assigned_resource_id : null,
        ]);
        const blockId = blockResult.rows[0].id;
        // Transition room/locker to OCCUPIED status + persist assignment (server-authoritative)
        if (session.assigned_resource_type === 'room') {
            await client.query(`UPDATE rooms 
         SET status = 'OCCUPIED',
             assigned_to_customer_id = $1,
             last_status_change = NOW(),
             updated_at = NOW()
         WHERE id = $2`, [session.customer_id, session.assigned_resource_id]);
        }
        else if (session.assigned_resource_type === 'locker') {
            await client.query(`UPDATE lockers 
         SET status = 'OCCUPIED',
             assigned_to_customer_id = $1,
             updated_at = NOW()
         WHERE id = $2`, [session.customer_id, session.assigned_resource_id]);
        }
        // Update session status
        await client.query(`UPDATE lane_sessions SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [session.id]);
        // Log audit (only if staffId is a valid UUID)
        if (staffId &&
            staffId !== 'system' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)) {
            await (0, auditLog_1.insertAuditLog)(client, {
                staffId,
                action: 'CHECK_IN',
                entityType: 'visit',
                entityId: visitId,
                oldValue: {},
                newValue: {
                    visit_id: visitId,
                    block_id: blockId,
                    resource_type: session.assigned_resource_type,
                },
            });
        }
        // Create waitlist entry if waitlist_desired_type is set
        if (session.waitlist_desired_type && session.backup_rental_type) {
            const waitlistResult = await client.query(`INSERT INTO waitlist 
         (visit_id, checkin_block_id, desired_tier, backup_tier, locker_or_room_assigned_initially, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
         RETURNING id`, [
                visitId,
                blockId,
                session.waitlist_desired_type,
                session.backup_rental_type,
                session.assigned_resource_id,
            ]);
            const waitlistId = waitlistResult.rows[0].id;
            // Update checkin_block with waitlist_id
            await client.query(`UPDATE checkin_blocks SET waitlist_id = $1 WHERE id = $2`, [
                waitlistId,
                blockId,
            ]);
            // Log waitlist created (include desired+backup and the assigned resource number for debugging)
            if (staffId &&
                staffId !== 'system' &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)) {
                let assignedResourceNumber = null;
                if (session.assigned_resource_type === 'room') {
                    const r = await client.query(`SELECT number FROM rooms WHERE id = $1`, [session.assigned_resource_id]);
                    assignedResourceNumber = r.rows[0]?.number ?? null;
                }
                else if (session.assigned_resource_type === 'locker') {
                    const l = await client.query(`SELECT number FROM lockers WHERE id = $1`, [session.assigned_resource_id]);
                    assignedResourceNumber = l.rows[0]?.number ?? null;
                }
                await (0, auditLog_1.insertAuditLog)(client, {
                    staffId,
                    action: 'WAITLIST_CREATED',
                    entityType: 'waitlist',
                    entityId: waitlistId,
                    oldValue: {},
                    newValue: {
                        visit_id: visitId,
                        checkin_block_id: blockId,
                        desired_tier: session.waitlist_desired_type,
                        backup_tier: session.backup_rental_type,
                        initial_resource_id: session.assigned_resource_id,
                        initial_resource_number: assignedResourceNumber,
                    },
                });
            }
            // Broadcast waitlist update
            fastify.broadcaster.broadcast({
                type: 'WAITLIST_UPDATED',
                payload: {
                    waitlistId,
                    status: 'ACTIVE',
                    visitId,
                    desiredTier: session.waitlist_desired_type,
                },
                timestamp: new Date().toISOString(),
            });
        }
    }
    /**
     * POST /v1/checkin/lane/:laneId/kiosk-sign
     *
     * Lightweight kiosk endpoint: records that the customer signed the agreement
     * digitally, without triggering full check-in completion (no payment/assignment
     * prereqs). Broadcasts SESSION_UPDATED so the employee register sees the signed status.
     */
    fastify.post('/v1/checkin/lane/:laneId/kiosk-sign', {
        preHandler: [middleware_1.optionalAuth, kioskToken_1.requireKioskTokenOrStaff],
    }, async (request, reply) => {
        const { laneId } = request.params;
        const { signaturePayload, sessionId } = request.body;
        if (!signaturePayload || signaturePayload.length < 16) {
            return reply.status(400).send({ error: 'Signature payload is required' });
        }
        try {
            const updatedSessionId = await (0, db_1.transaction)(async (client) => {
                let sessionResult;
                if (sessionId) {
                    sessionResult = await client.query(`SELECT id, lane_id FROM lane_sessions
               WHERE id = $1 AND lane_id = $2 AND status NOT IN ('COMPLETED', 'CANCELLED')
               LIMIT 1`, [sessionId, laneId]);
                }
                else {
                    sessionResult = await client.query(`SELECT id, lane_id FROM lane_sessions
               WHERE lane_id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED')
               ORDER BY created_at DESC
               LIMIT 1`, [laneId]);
                }
                if (sessionResult.rows.length === 0) {
                    throw { statusCode: 404, message: 'No active session found' };
                }
                const session = sessionResult.rows[0];
                await client.query(`UPDATE lane_sessions
             SET agreement_signed_method = 'DIGITAL',
                 agreement_bypass_pending = false,
                 updated_at = NOW()
             WHERE id = $1`, [session.id]);
                return session.id;
            });
            // Broadcast so employee register sees the signed status
            const { payload } = await (0, db_1.transaction)((client) => (0, payload_1.buildFullSessionUpdatedPayload)(client, updatedSessionId));
            fastify.broadcaster.broadcastSessionUpdated(payload, laneId);
            return reply.send({ success: true });
        }
        catch (error) {
            request.log.error(error, 'Failed to record kiosk signature');
            const httpErr = (0, utils_1.getHttpError)(error);
            if (httpErr) {
                return reply.status(httpErr.statusCode).send({ error: httpErr.message });
            }
            return reply.status(500).send({ error: 'Failed to record signature' });
        }
    });
}
