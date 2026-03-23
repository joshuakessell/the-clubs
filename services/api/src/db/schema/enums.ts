import { pgTable, index, foreignKey, uuid, timestamp, check, varchar, date, text, numeric, unique, serial, boolean, integer, bigint, jsonb, uniqueIndex, inet, time, primaryKey, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
const ENUM_OPEN = 'OPEN';

const ENUM_CLOSED = 'CLOSED';

const ENUM_ACTIVE = 'ACTIVE';

const ENUM_COMPLETED = 'COMPLETED';

const ENUM_CANCELLED = 'CANCELLED';

const ENUM_CANCELED = 'CANCELED';

export const auditAction = pgEnum("audit_action", ['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'ASSIGN', 'RELEASE', 'OVERRIDE', 'CHECK_IN', 'CHECK_OUT', 'UPGRADE_DISCLAIMER', 'STAFF_WEBAUTHN_ENROLLED', 'STAFF_LOGIN_WEBAUTHN', 'STAFF_LOGIN_PIN', 'STAFF_LOGOUT', 'STAFF_WEBAUTHN_REVOKED', 'STAFF_PIN_RESET', 'STAFF_REAUTH_REQUIRED', 'STAFF_CREATED', 'STAFF_UPDATED', 'STAFF_ACTIVATED', 'STAFF_DEACTIVATED', 'REGISTER_SIGN_IN', 'REGISTER_SIGN_OUT', 'REGISTER_FORCE_SIGN_OUT', 'WAITLIST_CREATED', 'WAITLIST_CANCELLED', 'WAITLIST_OFFERED', 'WAITLIST_COMPLETED', 'UPGRADE_STARTED', 'UPGRADE_PAID', 'UPGRADE_COMPLETED', 'FINAL_EXTENSION_STARTED', 'FINAL_EXTENSION_PAID', 'FINAL_EXTENSION_COMPLETED', 'STAFF_REAUTH_PIN', 'STAFF_REAUTH_WEBAUTHN', 'ROOM_STATUS_CHANGE', 'SHIFT_UPDATED', 'TIMECLOCK_ADJUSTED', 'TIMECLOCK_CLOSED', 'DOCUMENT_UPLOADED', 'TIME_OFF_REQUESTED', 'TIME_OFF_APPROVED', 'TIME_OFF_DENIED', 'SHIFT_CREATED', 'SHIFT_CANCELED'])

export const blockType = pgEnum("block_type", ['INITIAL', 'RENEWAL', 'FINAL2H'])

export const breakStatus = pgEnum("break_status", [ENUM_OPEN, ENUM_CLOSED])

export const breakType = pgEnum("break_type", ['MEAL', 'REST', 'OTHER'])

export const cashDrawerEventType = pgEnum("cash_drawer_event_type", ['PAID_IN', 'PAID_OUT', 'DROP', 'NO_SALE_OPEN', 'ADJUSTMENT'])

export const cashDrawerSessionStatus = pgEnum("cash_drawer_session_status", [ENUM_OPEN, ENUM_CLOSED])

export const checkoutRequestStatus = pgEnum("checkout_request_status", ['SUBMITTED', 'CLAIMED', 'VERIFIED', ENUM_CANCELLED])

export const externalProviderEntityType = pgEnum("external_provider_entity_type", ['customer', 'payment', 'refund', 'order', 'shift', 'timeclock_session', 'cash_event', 'receipt'])

export const inventoryReservationKind = pgEnum("inventory_reservation_kind", ['LANE_SELECTION', 'UPGRADE_HOLD'])

export const inventoryResourceType = pgEnum("inventory_resource_type", ['room', 'locker'])

export const keyTagType = pgEnum("key_tag_type", ['QR', 'NFC'])

export const laneSessionStatus = pgEnum("lane_session_status", ['IDLE', ENUM_ACTIVE, 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE', ENUM_COMPLETED, ENUM_CANCELLED])

export const orderLineItemKind = pgEnum("order_line_item_kind", ['RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL', 'CHECKIN_FEE', 'RENEWAL_FEE', 'FINAL_EXTENSION'])

export const orderStatus = pgEnum("order_status", [ENUM_OPEN, 'PAID', ENUM_CANCELED, 'REFUNDED', 'PARTIALLY_REFUNDED'])

export const rentalType = pgEnum("rental_type", ['LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL', 'GYM_LOCKER'])

export const roomStatus = pgEnum("room_status", ['DIRTY', 'CLEANING', 'CLEAN', 'OCCUPIED', 'OUT_OF_SERVICE'])

export const roomType = pgEnum("room_type", ['STANDARD', 'DELUXE', 'VIP', 'LOCKER', 'DOUBLE', 'SPECIAL'])

export const shiftStatus = pgEnum("shift_status", ['SCHEDULED', 'UPDATED', ENUM_CANCELED])

export const staffRole = pgEnum("staff_role", ['STAFF', 'ADMIN'])

export const timeOffRequestStatus = pgEnum("time_off_request_status", ['PENDING', 'APPROVED', 'DENIED'])

export const waitlistStatus = pgEnum("waitlist_status", [ENUM_ACTIVE, 'OFFERED', ENUM_COMPLETED, ENUM_CANCELLED, 'EXPIRED'])
