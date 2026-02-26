-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'ASSIGN', 'RELEASE', 'OVERRIDE', 'CHECK_IN', 'CHECK_OUT', 'UPGRADE_DISCLAIMER', 'STAFF_WEBAUTHN_ENROLLED', 'STAFF_LOGIN_WEBAUTHN', 'STAFF_LOGIN_PIN', 'STAFF_LOGOUT', 'STAFF_WEBAUTHN_REVOKED', 'STAFF_PIN_RESET', 'STAFF_REAUTH_REQUIRED', 'STAFF_CREATED', 'STAFF_UPDATED', 'STAFF_ACTIVATED', 'STAFF_DEACTIVATED', 'REGISTER_SIGN_IN', 'REGISTER_SIGN_OUT', 'REGISTER_FORCE_SIGN_OUT', 'WAITLIST_CREATED', 'WAITLIST_CANCELLED', 'WAITLIST_OFFERED', 'WAITLIST_COMPLETED', 'UPGRADE_STARTED', 'UPGRADE_PAID', 'UPGRADE_COMPLETED', 'FINAL_EXTENSION_STARTED', 'FINAL_EXTENSION_PAID', 'FINAL_EXTENSION_COMPLETED', 'STAFF_REAUTH_PIN', 'STAFF_REAUTH_WEBAUTHN', 'ROOM_STATUS_CHANGE', 'SHIFT_UPDATED', 'TIMECLOCK_ADJUSTED', 'TIMECLOCK_CLOSED', 'DOCUMENT_UPLOADED', 'TIME_OFF_REQUESTED', 'TIME_OFF_APPROVED', 'TIME_OFF_DENIED', 'SHIFT_CREATED', 'SHIFT_CANCELED');--> statement-breakpoint
CREATE TYPE "public"."block_type" AS ENUM('INITIAL', 'RENEWAL', 'FINAL2H');--> statement-breakpoint
CREATE TYPE "public"."break_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."break_type" AS ENUM('MEAL', 'REST', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."cash_drawer_event_type" AS ENUM('PAID_IN', 'PAID_OUT', 'DROP', 'NO_SALE_OPEN', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."cash_drawer_session_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."checkout_request_status" AS ENUM('SUBMITTED', 'CLAIMED', 'VERIFIED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."external_provider_entity_type" AS ENUM('customer', 'payment', 'refund', 'order', 'shift', 'timeclock_session', 'cash_event', 'receipt');--> statement-breakpoint
CREATE TYPE "public"."inventory_reservation_kind" AS ENUM('LANE_SELECTION', 'UPGRADE_HOLD');--> statement-breakpoint
CREATE TYPE "public"."inventory_resource_type" AS ENUM('room', 'locker');--> statement-breakpoint
CREATE TYPE "public"."key_tag_type" AS ENUM('QR', 'NFC');--> statement-breakpoint
CREATE TYPE "public"."lane_session_status" AS ENUM('IDLE', 'ACTIVE', 'AWAITING_CUSTOMER', 'AWAITING_ASSIGNMENT', 'AWAITING_PAYMENT', 'AWAITING_SIGNATURE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."order_line_item_kind" AS ENUM('RETAIL', 'ADDON', 'UPGRADE', 'LATE_FEE', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('OPEN', 'PAID', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('DUE', 'PAID', 'CANCELLED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."rental_type" AS ENUM('LOCKER', 'STANDARD', 'DOUBLE', 'SPECIAL', 'GYM_LOCKER');--> statement-breakpoint
CREATE TYPE "public"."room_status" AS ENUM('DIRTY', 'CLEANING', 'CLEAN', 'OCCUPIED');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('STANDARD', 'DELUXE', 'VIP', 'LOCKER', 'DOUBLE', 'SPECIAL');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('SCHEDULED', 'UPDATED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('STAFF', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."time_off_request_status" AS ENUM('PENDING', 'APPROVED', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('ACTIVE', 'OFFERED', 'COMPLETED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"dob" date,
	"membership_number" varchar(50),
	"membership_card_type" varchar(20),
	"membership_valid_until" date,
	"banned_until" timestamp with time zone,
	"id_scan_hash" varchar(255),
	"id_scan_value" text,
	"primary_language" text,
	"past_due_balance" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id_expiration_date" date,
	"id_number" text,
	"id_state" text,
	"id_type" text,
	"id_type_other" text,
	CONSTRAINT "customers_primary_language_check" CHECK (primary_language = ANY (ARRAY['EN'::text, 'ES'::text]))
);
--> statement-breakpoint
CREATE TABLE "schema_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filename" text,
	CONSTRAINT "schema_migrations_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" "staff_role" DEFAULT 'STAFF' NOT NULL,
	"qr_token_hash" varchar(255),
	"pin_hash" varchar(255),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"force_pin_change" boolean DEFAULT false NOT NULL,
	CONSTRAINT "staff_qr_token_hash_key" UNIQUE("qr_token_hash")
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"doc_type" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"sha256_hash" text,
	CONSTRAINT "employee_documents_doc_type_check" CHECK (doc_type = ANY (ARRAY['ID'::text, 'W4'::text, 'I9'::text, 'OFFER_LETTER'::text, 'NDA'::text, 'OTHER'::text]))
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"device_type" varchar(50) NOT NULL,
	"session_token" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"reauth_ok_until" timestamp with time zone,
	CONSTRAINT "staff_sessions_session_token_key" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "employee_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"shift_code" text NOT NULL,
	"role" text,
	"status" "shift_status" DEFAULT 'SCHEDULED' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"color" text DEFAULT '#3b82f6',
	"template_id" uuid,
	"break_minutes" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "staff_webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "time_off_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reason" text,
	"status" time_off_request_status DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeclock_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_id" uuid,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone,
	"source" text NOT NULL,
	"created_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timeclock_sessions_source_check" CHECK (source = ANY (ARRAY['EMPLOYEE_REGISTER'::text, 'OFFICE_DASHBOARD'::text]))
);
--> statement-breakpoint
CREATE TABLE "webauthn_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge" text NOT NULL,
	"staff_id" uuid,
	"device_id" varchar(255),
	"type" varchar(50) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_challenges_challenge_key" UNIQUE("challenge")
);
--> statement-breakpoint
CREATE TABLE "lockers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(20) NOT NULL,
	"status" "room_status" DEFAULT 'CLEAN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_to_customer_id" uuid,
	CONSTRAINT "lockers_number_key" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(20) NOT NULL,
	"type" "room_type" DEFAULT 'STANDARD' NOT NULL,
	"status" "room_status" DEFAULT 'CLEAN' NOT NULL,
	"floor" integer DEFAULT 1 NOT NULL,
	"last_status_change" timestamp with time zone DEFAULT now() NOT NULL,
	"override_flag" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_to_customer_id" uuid,
	CONSTRAINT "rooms_number_key" UNIQUE("number"),
	CONSTRAINT "rooms_type_no_deprecated" CHECK (type <> ALL (ARRAY['DELUXE'::room_type, 'VIP'::room_type]))
);
--> statement-breakpoint
CREATE TABLE "key_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid,
	"locker_id" uuid,
	"tag_type" "key_tag_type" NOT NULL,
	"tag_code" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "key_tags_tag_code_key" UNIQUE("tag_code"),
	CONSTRAINT "key_tags_exactly_one_target_chk" CHECK ((
CASE
    WHEN (room_id IS NULL) THEN 0
    ELSE 1
END +
CASE
    WHEN (locker_id IS NULL) THEN 0
    ELSE 1
END) = 1)
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"checkin_block_id" uuid NOT NULL,
	"desired_tier" "rental_type" NOT NULL,
	"backup_tier" "rental_type" NOT NULL,
	"locker_or_room_assigned_initially" uuid,
	"room_id" uuid,
	"status" "waitlist_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offered_at" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"last_offered_at" timestamp with time zone,
	"offer_attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_staff_id" uuid,
	"desired_tiers" "rental_type"[] DEFAULT '{""}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agreement_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"customer_name" varchar(255) NOT NULL,
	"membership_number" varchar(50),
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_png_base64" text,
	"signature_strokes_json" jsonb,
	"agreement_text_snapshot" text NOT NULL,
	"agreement_version" varchar(50) NOT NULL,
	"device_id" varchar(255),
	"device_type" varchar(50),
	"user_agent" text,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checkin_block_id" uuid
);
--> statement-breakpoint
CREATE TABLE "checkin_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"block_type" "block_type" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"room_id" uuid,
	"locker_id" uuid,
	"session_id" uuid,
	"agreement_signed" boolean DEFAULT false NOT NULL,
	"agreement_pdf" "bytea",
	"agreement_signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"has_tv_remote" boolean DEFAULT false NOT NULL,
	"waitlist_id" uuid,
	"rental_type" "rental_type" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" "inventory_resource_type" NOT NULL,
	"resource_id" uuid NOT NULL,
	"kind" "inventory_reservation_kind" NOT NULL,
	"lane_session_id" uuid,
	"waitlist_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "inventory_reservations_lane_session_required" CHECK ((kind <> 'LANE_SELECTION'::inventory_reservation_kind) OR (lane_session_id IS NOT NULL)),
	CONSTRAINT "inventory_reservations_waitlist_required" CHECK ((kind <> 'UPGRADE_HOLD'::inventory_reservation_kind) OR (waitlist_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"checkin_block_id" uuid,
	"type" varchar(50) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"payment_intent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane_session_id" uuid,
	"amount" numeric(10, 2) NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"status" "payment_status" DEFAULT 'DUE' NOT NULL,
	"quote_json" jsonb NOT NULL,
	"square_transaction_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by_staff_id" uuid,
	"payment_method" text,
	"failure_reason" text,
	"failure_at" timestamp with time zone,
	"register_number" integer,
	CONSTRAINT "payment_intents_payment_method_check" CHECK (payment_method = ANY (ARRAY['CASH'::text, 'CREDIT'::text]))
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"device_id" varchar(255) PRIMARY KEY NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "register_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"register_number" integer NOT NULL,
	"last_heartbeat" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_out_at" timestamp with time zone,
	"closeout_summary_json" jsonb,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "register_sessions_register_number_check" CHECK (register_number = ANY (ARRAY[1, 2, 3]))
);
--> statement-breakpoint
CREATE TABLE "checkout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occupancy_id" uuid NOT NULL,
	"key_tag_id" uuid,
	"kiosk_device_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by_staff_id" uuid,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"customer_checklist_json" jsonb NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"late_fee_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"ban_applied" boolean DEFAULT false NOT NULL,
	"items_confirmed" boolean DEFAULT false NOT NULL,
	"fee_paid" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "checkout_request_status" DEFAULT 'SUBMITTED'
);
--> statement-breakpoint
CREATE TABLE "cleaning_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" varchar(255) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"room_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cleaning_batch_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"status_from" "room_status" NOT NULL,
	"status_to" "room_status" NOT NULL,
	"transition_time" timestamp with time zone DEFAULT now() NOT NULL,
	"override_flag" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cleaning_batch_rooms_batch_id_room_id_key" UNIQUE("batch_id","room_id")
);
--> statement-breakpoint
CREATE TABLE "cleaning_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"from_status" "room_status" NOT NULL,
	"to_status" "room_status" NOT NULL,
	"override_flag" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"device_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "late_checkout_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occupancy_id" uuid NOT NULL,
	"checkout_request_id" uuid,
	"late_minutes" integer NOT NULL,
	"fee_amount" numeric(10, 2) NOT NULL,
	"ban_applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255),
	"user_role" varchar(50),
	"action" "audit_action" NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"override_reason" text,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"staff_id" uuid,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "cash_drawer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"register_session_id" uuid NOT NULL,
	"opened_by_staff_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_float_cents" integer NOT NULL,
	"closed_by_staff_id" uuid,
	"closed_at" timestamp with time zone,
	"counted_cash_cents" integer,
	"expected_cash_cents" integer,
	"over_short_cents" integer,
	"notes" text,
	"status" "cash_drawer_session_status" DEFAULT 'OPEN' NOT NULL,
	"closeout_snapshot_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "cash_drawer_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cash_drawer_session_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" "cash_drawer_event_type" NOT NULL,
	"amount_cents" integer,
	"reason" text,
	"created_by_staff_id" uuid NOT NULL,
	"metadata_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "staff_break_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"timeclock_session_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"break_type" "break_type" NOT NULL,
	"status" "break_status" DEFAULT 'OPEN' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"register_session_id" uuid,
	"created_by_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "order_status" DEFAULT 'OPEN' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"metadata_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_line_item_kind" NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"metadata_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_number" text NOT NULL,
	"receipt_json" jsonb NOT NULL,
	"pdf_storage_key" text,
	"metadata_json" jsonb,
	CONSTRAINT "receipts_receipt_number_key" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "external_provider_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"entity_type" "external_provider_entity_type" NOT NULL,
	"internal_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"external_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_provider_refs_provider_entity_type_internal_id_key" UNIQUE("provider","entity_type","internal_id"),
	CONSTRAINT "external_provider_refs_provider_entity_type_external_id_key" UNIQUE("provider","entity_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "demo_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lane_feature_flags" (
	"lane_id" varchar(50) PRIMARY KEY NOT NULL,
	"lockstep_v2_enabled" boolean,
	"flow_commands_enabled" boolean,
	"lan_fallback_enabled" boolean,
	"lan_authoritative_enabled" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offline_command_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane_id" varchar(50) NOT NULL,
	"session_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"actor" varchar(20) NOT NULL,
	"type" varchar(50) NOT NULL,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replayed_at" timestamp with time zone,
	"replay_attempts" integer DEFAULT 0 NOT NULL,
	"last_replay_error" text,
	CONSTRAINT "offline_command_outbox_session_command_unique" UNIQUE("session_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid,
	"created_by_staff_name" text NOT NULL,
	"source_app" text NOT NULL,
	"note" text NOT NULL,
	"is_important" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customer_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"action_category" text NOT NULL,
	"source_app" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_staff_id" uuid,
	"actor_staff_name" text,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_blob" text NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_spend_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL,
	"visit_id" uuid,
	"entry_type" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"source_app" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_staff_id" uuid,
	"actor_staff_name" text,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"default_start_time" time NOT NULL,
	"default_end_time" time NOT NULL,
	"color" text DEFAULT '#3b82f6' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "late_checkout_ban_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"checkout_request_id" uuid,
	"occupancy_id" uuid NOT NULL,
	"visit_id" uuid,
	"late_minutes" integer NOT NULL,
	"fee_amount_cents" integer NOT NULL,
	"recommended_ban_days" integer DEFAULT 30 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_id" uuid,
	"created_by_staff_name" text,
	"decided_at" timestamp with time zone,
	"decided_by_staff_id" uuid,
	"decided_by_staff_name" text,
	"decision" text,
	"ban_days" integer,
	"manager_notes" text
);
--> statement-breakpoint
CREATE TABLE "schedule_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"template_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_patterns_day_of_week_check" CHECK ((day_of_week >= 0) AND (day_of_week <= 6))
);
--> statement-breakpoint
CREATE TABLE "lane_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lane_id" varchar(50) NOT NULL,
	"status" "lane_session_status" DEFAULT 'IDLE' NOT NULL,
	"staff_id" uuid,
	"customer_display_name" varchar(255),
	"membership_number" varchar(50),
	"desired_rental_type" "rental_type",
	"waitlist_desired_type" "rental_type",
	"backup_rental_type" "rental_type",
	"assigned_resource_id" uuid,
	"assigned_resource_type" varchar(20),
	"price_quote_json" jsonb,
	"disclaimers_ack_json" jsonb,
	"payment_intent_id" uuid,
	"membership_purchase_intent" varchar(20),
	"membership_purchase_requested_at" timestamp with time zone,
	"membership_choice" varchar(20),
	"kiosk_acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checkin_mode" varchar(20) DEFAULT 'CHECKIN',
	"renewal_hours" integer,
	"customer_id" uuid,
	"proposed_rental_type" "rental_type",
	"proposed_by" varchar(20),
	"selection_confirmed" boolean DEFAULT false,
	"selection_confirmed_by" varchar(20),
	"selection_locked_at" timestamp with time zone,
	"waitlist_desired_types_json" jsonb,
	"waitlist_requested_resource_number" varchar(20),
	"waitlist_requested_resource_type" varchar(20),
	"flow_step" varchar(50),
	"flow_version" integer DEFAULT 0 NOT NULL,
	"flow_last_command_id" uuid,
	"flow_last_actor" varchar(20),
	"agreement_bypass_pending" boolean DEFAULT false NOT NULL,
	"agreement_signed_method" varchar(16),
	"past_due_bypassed" boolean DEFAULT false NOT NULL,
	"past_due_bypassed_by_staff_id" uuid,
	"past_due_bypassed_at" timestamp with time zone,
	"last_payment_decline_reason" text,
	"last_payment_decline_at" timestamp with time zone,
	"last_past_due_decline_reason" text,
	"last_past_due_decline_at" timestamp with time zone,
	CONSTRAINT "lane_sessions_membership_choice_check" CHECK (((membership_choice)::text = ANY (ARRAY[('ONE_TIME'::character varying)::text, ('SIX_MONTH'::character varying)::text])) OR (membership_choice IS NULL)),
	CONSTRAINT "lane_sessions_renewal_hours_check" CHECK ((renewal_hours = ANY (ARRAY[2, 6])) OR (renewal_hours IS NULL)),
	CONSTRAINT "lane_sessions_proposed_by_check" CHECK ((proposed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])),
	CONSTRAINT "lane_sessions_selection_confirmed_by_check" CHECK ((selection_confirmed_by)::text = ANY (ARRAY[('CUSTOMER'::character varying)::text, ('EMPLOYEE'::character varying)::text])),
	CONSTRAINT "lane_sessions_waitlist_requested_resource_type_check" CHECK ((waitlist_requested_resource_type IS NULL) OR ((waitlist_requested_resource_type)::text = ANY ((ARRAY['room'::character varying, 'locker'::character varying])::text[]))),
	CONSTRAINT "lane_sessions_flow_last_actor_check" CHECK ((flow_last_actor IS NULL) OR ((flow_last_actor)::text = ANY ((ARRAY['CUSTOMER'::character varying, 'EMPLOYEE'::character varying, 'SYSTEM'::character varying])::text[])))
);
--> statement-breakpoint
CREATE TABLE "club_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"event_domain" text NOT NULL,
	"source_app" text NOT NULL,
	"register_id" text,
	"staff_id" uuid,
	"staff_name" text,
	"customer_id" uuid,
	"customer_name" text,
	"visit_id" uuid,
	"order_id" uuid,
	"amount_cents" integer,
	"currency" varchar(3) DEFAULT 'USD',
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_blob" text NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text,
	"name" text NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'RETAIL' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_sku_key" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lane_session_commands" (
	"session_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" varchar(20) NOT NULL,
	"type" varchar(100) NOT NULL,
	"payload_json" jsonb,
	CONSTRAINT "lane_session_commands_pkey" PRIMARY KEY("session_id","command_id"),
	CONSTRAINT "lane_session_commands_actor_check" CHECK ((actor)::text = ANY ((ARRAY['CUSTOMER'::character varying, 'EMPLOYEE'::character varying, 'SYSTEM'::character varying])::text[]))
);
--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."shift_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_webauthn_credentials" ADD CONSTRAINT "staff_webauthn_credentials_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeclock_sessions" ADD CONSTRAINT "timeclock_sessions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeclock_sessions" ADD CONSTRAINT "timeclock_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeclock_sessions" ADD CONSTRAINT "timeclock_sessions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."employee_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lockers" ADD CONSTRAINT "lockers_assigned_to_customer_id_fkey" FOREIGN KEY ("assigned_to_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_assigned_to_customer_id_fkey" FOREIGN KEY ("assigned_to_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_tags" ADD CONSTRAINT "key_tags_locker_id_fkey" FOREIGN KEY ("locker_id") REFERENCES "public"."lockers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_tags" ADD CONSTRAINT "key_tags_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_cancelled_by_staff_id_fkey" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_checkin_block_id_fkey" FOREIGN KEY ("checkin_block_id") REFERENCES "public"."checkin_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_checkin_block_id_fkey" FOREIGN KEY ("checkin_block_id") REFERENCES "public"."checkin_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_blocks" ADD CONSTRAINT "checkin_blocks_locker_id_fkey" FOREIGN KEY ("locker_id") REFERENCES "public"."lockers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_blocks" ADD CONSTRAINT "checkin_blocks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_blocks" ADD CONSTRAINT "checkin_blocks_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."lane_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_blocks" ADD CONSTRAINT "checkin_blocks_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_blocks" ADD CONSTRAINT "checkin_blocks_waitlist_id_fkey" FOREIGN KEY ("waitlist_id") REFERENCES "public"."waitlist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_lane_session_fk" FOREIGN KEY ("lane_session_id") REFERENCES "public"."lane_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_waitlist_fk" FOREIGN KEY ("waitlist_id") REFERENCES "public"."waitlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_checkin_block_id_fkey" FOREIGN KEY ("checkin_block_id") REFERENCES "public"."checkin_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_lane_session_id_fkey" FOREIGN KEY ("lane_session_id") REFERENCES "public"."lane_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_paid_by_staff_id_fkey" FOREIGN KEY ("paid_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_sessions" ADD CONSTRAINT "register_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_claimed_by_staff_id_fkey" FOREIGN KEY ("claimed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_requests_key_tag_id_fkey" FOREIGN KEY ("key_tag_id") REFERENCES "public"."key_tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_batch_rooms" ADD CONSTRAINT "cleaning_batch_rooms_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."cleaning_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_batch_rooms" ADD CONSTRAINT "cleaning_batch_rooms_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_events" ADD CONSTRAINT "cleaning_events_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_events" ADD CONSTRAINT "cleaning_events_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_checkout_events" ADD CONSTRAINT "late_checkout_events_checkout_request_id_fkey" FOREIGN KEY ("checkout_request_id") REFERENCES "public"."checkout_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_checkout_events" ADD CONSTRAINT "late_checkout_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_sessions" ADD CONSTRAINT "cash_drawer_sessions_register_session_id_fkey" FOREIGN KEY ("register_session_id") REFERENCES "public"."register_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_sessions" ADD CONSTRAINT "cash_drawer_sessions_opened_by_staff_id_fkey" FOREIGN KEY ("opened_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_sessions" ADD CONSTRAINT "cash_drawer_sessions_closed_by_staff_id_fkey" FOREIGN KEY ("closed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_events" ADD CONSTRAINT "cash_drawer_events_cash_drawer_session_id_fkey" FOREIGN KEY ("cash_drawer_session_id") REFERENCES "public"."cash_drawer_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_drawer_events" ADD CONSTRAINT "cash_drawer_events_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_break_sessions" ADD CONSTRAINT "staff_break_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_break_sessions" ADD CONSTRAINT "staff_break_sessions_timeclock_session_id_fkey" FOREIGN KEY ("timeclock_session_id") REFERENCES "public"."timeclock_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_register_session_id_fkey" FOREIGN KEY ("register_session_id") REFERENCES "public"."register_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_activity_events" ADD CONSTRAINT "customer_activity_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_activity_events" ADD CONSTRAINT "customer_activity_events_actor_staff_id_fkey" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_spend_ledger_entries" ADD CONSTRAINT "customer_spend_ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_spend_ledger_entries" ADD CONSTRAINT "customer_spend_ledger_entries_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_spend_ledger_entries" ADD CONSTRAINT "customer_spend_ledger_entries_actor_staff_id_fkey" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_checkout_ban_alerts" ADD CONSTRAINT "late_checkout_ban_alerts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_checkout_ban_alerts" ADD CONSTRAINT "late_checkout_ban_alerts_checkout_request_id_fkey" FOREIGN KEY ("checkout_request_id") REFERENCES "public"."checkout_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_checkout_ban_alerts" ADD CONSTRAINT "late_checkout_ban_alerts_occupancy_id_fkey" FOREIGN KEY ("occupancy_id") REFERENCES "public"."checkin_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_checkout_ban_alerts" ADD CONSTRAINT "late_checkout_ban_alerts_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_checkout_ban_alerts" ADD CONSTRAINT "late_checkout_ban_alerts_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "late_checkout_ban_alerts" ADD CONSTRAINT "late_checkout_ban_alerts_decided_by_staff_id_fkey" FOREIGN KEY ("decided_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_patterns" ADD CONSTRAINT "schedule_patterns_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_patterns" ADD CONSTRAINT "schedule_patterns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."shift_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_patterns" ADD CONSTRAINT "schedule_patterns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_sessions" ADD CONSTRAINT "fk_lane_sessions_payment_intent" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_sessions" ADD CONSTRAINT "lane_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_sessions" ADD CONSTRAINT "lane_sessions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_sessions" ADD CONSTRAINT "lane_sessions_past_due_bypassed_by_staff_id_fkey" FOREIGN KEY ("past_due_bypassed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_events" ADD CONSTRAINT "club_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lane_session_commands" ADD CONSTRAINT "lane_session_commands_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."lane_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_visits_started" ON "visits" USING btree ("started_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_customers_banned" ON "customers" USING btree ("banned_until" timestamptz_ops) WHERE (banned_until IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_customers_dob" ON "customers" USING btree ("dob" date_ops) WHERE (dob IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_customers_id_hash" ON "customers" USING btree ("id_scan_hash" text_ops) WHERE (id_scan_hash IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_customers_membership" ON "customers" USING btree ("membership_number" text_ops) WHERE (membership_number IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_staff_active" ON "staff" USING btree ("active" bool_ops) WHERE (active = true);--> statement-breakpoint
CREATE INDEX "idx_staff_qr_token_hash" ON "staff" USING btree ("qr_token_hash" text_ops) WHERE (qr_token_hash IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_staff_role" ON "staff" USING btree ("role" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_employee_documents_employee" ON "employee_documents" USING btree ("employee_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_employee_documents_type" ON "employee_documents" USING btree ("doc_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_employee_documents_uploaded_by" ON "employee_documents" USING btree ("uploaded_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_staff_sessions_active" ON "staff_sessions" USING btree ("staff_id" timestamptz_ops,"revoked_at" timestamptz_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_staff_sessions_device" ON "staff_sessions" USING btree ("device_id" text_ops,"device_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_staff_sessions_reauth_ok" ON "staff_sessions" USING btree ("session_token" timestamptz_ops,"reauth_ok_until" timestamptz_ops) WHERE ((revoked_at IS NULL) AND (reauth_ok_until IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_staff_sessions_staff_id" ON "staff_sessions" USING btree ("staff_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_staff_sessions_token" ON "staff_sessions" USING btree ("session_token" text_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_employee_shifts_dates" ON "employee_shifts" USING btree ("starts_at" timestamptz_ops,"ends_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_employee_shifts_employee" ON "employee_shifts" USING btree ("employee_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_employee_shifts_shift_code" ON "employee_shifts" USING btree ("shift_code" text_ops);--> statement-breakpoint
CREATE INDEX "idx_employee_shifts_status" ON "employee_shifts" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_webauthn_credentials_active" ON "staff_webauthn_credentials" USING btree ("staff_id" timestamptz_ops,"revoked_at" timestamptz_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_webauthn_credentials_credential_id" ON "staff_webauthn_credentials" USING btree ("credential_id" text_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_webauthn_credentials_device_id" ON "staff_webauthn_credentials" USING btree ("device_id" text_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_webauthn_credentials_staff_id" ON "staff_webauthn_credentials" USING btree ("staff_id" uuid_ops) WHERE (revoked_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_time_off_requests_day" ON "time_off_requests" USING btree ("day" date_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_time_off_requests_employee_day" ON "time_off_requests" USING btree ("employee_id" date_ops,"day" date_ops);--> statement-breakpoint
CREATE INDEX "idx_time_off_requests_status" ON "time_off_requests" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_timeclock_sessions_dates" ON "timeclock_sessions" USING btree ("clock_in_at" timestamptz_ops,"clock_out_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_timeclock_sessions_employee" ON "timeclock_sessions" USING btree ("employee_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_timeclock_sessions_employee_open" ON "timeclock_sessions" USING btree ("employee_id" uuid_ops) WHERE (clock_out_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_timeclock_sessions_open" ON "timeclock_sessions" USING btree ("clock_out_at" timestamptz_ops) WHERE (clock_out_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_timeclock_sessions_shift" ON "timeclock_sessions" USING btree ("shift_id" uuid_ops) WHERE (shift_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_webauthn_challenges_challenge" ON "webauthn_challenges" USING btree ("challenge" text_ops);--> statement-breakpoint
CREATE INDEX "idx_webauthn_challenges_expires" ON "webauthn_challenges" USING btree ("expires_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_webauthn_challenges_staff_device" ON "webauthn_challenges" USING btree ("staff_id" text_ops,"device_id" uuid_ops) WHERE (expires_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_lockers_assigned_customer" ON "lockers" USING btree ("assigned_to_customer_id" uuid_ops) WHERE (assigned_to_customer_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_lockers_status" ON "lockers" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_rooms_assigned_customer" ON "rooms" USING btree ("assigned_to_customer_id" uuid_ops) WHERE (assigned_to_customer_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_rooms_floor" ON "rooms" USING btree ("floor" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_rooms_status" ON "rooms" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_rooms_type" ON "rooms" USING btree ("type" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_key_tags_active" ON "key_tags" USING btree ("is_active" bool_ops) WHERE (is_active = true);--> statement-breakpoint
CREATE INDEX "idx_key_tags_code" ON "key_tags" USING btree ("tag_code" text_ops);--> statement-breakpoint
CREATE INDEX "idx_key_tags_room" ON "key_tags" USING btree ("room_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_active" ON "waitlist" USING btree ("status" enum_ops,"created_at" timestamptz_ops) WHERE (status = 'ACTIVE'::waitlist_status);--> statement-breakpoint
CREATE INDEX "idx_waitlist_block" ON "waitlist" USING btree ("checkin_block_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_created_at" ON "waitlist" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_desired_tier" ON "waitlist" USING btree ("desired_tier" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_desired_tiers" ON "waitlist" USING gin ("desired_tiers" array_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_offered" ON "waitlist" USING btree ("status" enum_ops,"created_at" enum_ops) WHERE (status = 'OFFERED'::waitlist_status);--> statement-breakpoint
CREATE INDEX "idx_waitlist_status" ON "waitlist" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_waitlist_visit" ON "waitlist" USING btree ("visit_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agreements_active" ON "agreements" USING btree ("active" bool_ops) WHERE (active = true);--> statement-breakpoint
CREATE INDEX "idx_agreement_signatures_agreement" ON "agreement_signatures" USING btree ("agreement_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_agreement_signatures_checkin_block" ON "agreement_signatures" USING btree ("checkin_block_id" uuid_ops) WHERE (checkin_block_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_agreement_signatures_signed_at" ON "agreement_signatures" USING btree ("signed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_checkin_blocks_ends_at" ON "checkin_blocks" USING btree ("ends_at" timestamptz_ops) WHERE (ends_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_checkin_blocks_session" ON "checkin_blocks" USING btree ("session_id" uuid_ops) WHERE (session_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_checkin_blocks_tv_remote" ON "checkin_blocks" USING btree ("has_tv_remote" bool_ops) WHERE (has_tv_remote = true);--> statement-breakpoint
CREATE INDEX "idx_checkin_blocks_type" ON "checkin_blocks" USING btree ("block_type" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_checkin_blocks_visit" ON "checkin_blocks" USING btree ("visit_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_checkin_blocks_waitlist" ON "checkin_blocks" USING btree ("waitlist_id" uuid_ops) WHERE (waitlist_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_inventory_reservations_active_expires_at" ON "inventory_reservations" USING btree ("expires_at" timestamptz_ops) WHERE (released_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_inventory_reservations_waitlist_active" ON "inventory_reservations" USING btree ("waitlist_id" uuid_ops) WHERE (released_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_inventory_reservations_active_resource" ON "inventory_reservations" USING btree ("resource_type" uuid_ops,"resource_id" enum_ops) WHERE (released_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_charges_block" ON "charges" USING btree ("checkin_block_id" uuid_ops) WHERE (checkin_block_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_charges_payment_intent" ON "charges" USING btree ("payment_intent_id" uuid_ops) WHERE (payment_intent_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_charges_visit" ON "charges" USING btree ("visit_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_payment_intents_due" ON "payment_intents" USING btree ("status" enum_ops) WHERE (status = 'DUE'::payment_status);--> statement-breakpoint
CREATE INDEX "idx_payment_intents_lane_session" ON "payment_intents" USING btree ("lane_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_payment_intents_paid_by_staff" ON "payment_intents" USING btree ("paid_by_staff_id" uuid_ops) WHERE (paid_by_staff_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_payment_intents_status" ON "payment_intents" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_devices_enabled" ON "devices" USING btree ("enabled" bool_ops) WHERE (enabled = true);--> statement-breakpoint
CREATE INDEX "idx_register_sessions_activity" ON "register_sessions" USING btree ("last_activity_at" timestamptz_ops) WHERE (signed_out_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_register_sessions_device" ON "register_sessions" USING btree ("device_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_register_sessions_device_active" ON "register_sessions" USING btree ("device_id" text_ops) WHERE (signed_out_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_register_sessions_employee" ON "register_sessions" USING btree ("employee_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_register_sessions_heartbeat" ON "register_sessions" USING btree ("last_heartbeat" timestamptz_ops) WHERE (signed_out_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_register_sessions_register_active" ON "register_sessions" USING btree ("register_number" int4_ops) WHERE (signed_out_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_checkout_requests_claim_expires" ON "checkout_requests" USING btree ("claim_expires_at" timestamptz_ops) WHERE (claim_expires_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_checkout_requests_claimed" ON "checkout_requests" USING btree ("claimed_by_staff_id" uuid_ops) WHERE (claimed_by_staff_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_checkout_requests_kiosk" ON "checkout_requests" USING btree ("kiosk_device_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_checkout_requests_occupancy" ON "checkout_requests" USING btree ("occupancy_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_batches_incomplete" ON "cleaning_batches" USING btree ("completed_at" timestamptz_ops) WHERE (completed_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_cleaning_batches_staff" ON "cleaning_batches" USING btree ("staff_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_batches_started" ON "cleaning_batches" USING btree ("started_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_batch_rooms_batch" ON "cleaning_batch_rooms" USING btree ("batch_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_batch_rooms_room" ON "cleaning_batch_rooms" USING btree ("room_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_batch_rooms_transition" ON "cleaning_batch_rooms" USING btree ("transition_time" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_events_completed" ON "cleaning_events" USING btree ("completed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_events_device" ON "cleaning_events" USING btree ("device_id" text_ops) WHERE (device_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_cleaning_events_override" ON "cleaning_events" USING btree ("override_flag" bool_ops) WHERE (override_flag = true);--> statement-breakpoint
CREATE INDEX "idx_cleaning_events_room" ON "cleaning_events" USING btree ("room_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_events_staff" ON "cleaning_events" USING btree ("staff_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_cleaning_events_started" ON "cleaning_events" USING btree ("started_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_late_checkout_events_created" ON "late_checkout_events" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_late_checkout_events_occupancy" ON "late_checkout_events" USING btree ("occupancy_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_late_checkout_events_request" ON "late_checkout_events" USING btree ("checkout_request_id" uuid_ops) WHERE (checkout_request_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "audit_log" USING btree ("action" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_created" ON "audit_log" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type" uuid_ops,"entity_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_overrides" ON "audit_log" USING btree ("created_at" timestamptz_ops) WHERE (action = 'OVERRIDE'::audit_action);--> statement-breakpoint
CREATE INDEX "idx_audit_log_staff_id" ON "audit_log" USING btree ("staff_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_log_user" ON "audit_log" USING btree ("user_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_cash_drawer_sessions_opened_by" ON "cash_drawer_sessions" USING btree ("opened_by_staff_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_cash_drawer_sessions_register_session" ON "cash_drawer_sessions" USING btree ("register_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_cash_drawer_sessions_status" ON "cash_drawer_sessions" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_cash_drawer_events_created_by" ON "cash_drawer_events" USING btree ("created_by_staff_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_cash_drawer_events_occurred_at" ON "cash_drawer_events" USING btree ("occurred_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_cash_drawer_events_session" ON "cash_drawer_events" USING btree ("cash_drawer_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_staff_break_sessions_staff" ON "staff_break_sessions" USING btree ("staff_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_staff_break_sessions_status" ON "staff_break_sessions" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_staff_break_sessions_timeclock" ON "staff_break_sessions" USING btree ("timeclock_session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_orders_created_at" ON "orders" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_orders_created_by" ON "orders" USING btree ("created_by_staff_id" uuid_ops) WHERE (created_by_staff_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_orders_customer" ON "orders" USING btree ("customer_id" uuid_ops) WHERE (customer_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_orders_register_session" ON "orders" USING btree ("register_session_id" uuid_ops) WHERE (register_session_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_orders_status" ON "orders" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_order_line_items_order" ON "order_line_items" USING btree ("order_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_receipts_order" ON "receipts" USING btree ("order_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_offline_command_outbox_pending" ON "offline_command_outbox" USING btree ("created_at" timestamptz_ops) WHERE (replayed_at IS NULL);--> statement-breakpoint
CREATE INDEX "idx_customer_notes_customer_created" ON "customer_notes" USING btree ("customer_id" timestamptz_ops,"created_at" uuid_ops,"id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_customer_notes_customer_important" ON "customer_notes" USING btree ("customer_id" timestamptz_ops,"created_at" timestamptz_ops,"id" timestamptz_ops) WHERE (is_important = true);--> statement-breakpoint
CREATE INDEX "idx_customer_activity_events_action_category" ON "customer_activity_events" USING btree ("action_category" text_ops,"occurred_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_customer_activity_events_action_type" ON "customer_activity_events" USING btree ("action_type" timestamptz_ops,"occurred_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_customer_activity_events_customer_occurred" ON "customer_activity_events" USING btree ("customer_id" uuid_ops,"occurred_at" uuid_ops,"id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customer_activity_events_dedupe" ON "customer_activity_events" USING btree ("dedupe_key" text_ops) WHERE (dedupe_key IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_customer_activity_events_occurred" ON "customer_activity_events" USING btree ("occurred_at" uuid_ops,"id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_customer_activity_events_search_trgm" ON "customer_activity_events" USING gin ("search_blob" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_customer_spend_ledger_customer_occurred" ON "customer_spend_ledger_entries" USING btree ("customer_id" timestamptz_ops,"occurred_at" uuid_ops,"id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_customer_spend_ledger_customer_visit_occurred" ON "customer_spend_ledger_entries" USING btree ("customer_id" uuid_ops,"visit_id" timestamptz_ops,"occurred_at" uuid_ops,"id" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_customer_spend_ledger_dedupe" ON "customer_spend_ledger_entries" USING btree ("dedupe_key" text_ops) WHERE (dedupe_key IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_customer_spend_ledger_entry_type" ON "customer_spend_ledger_entries" USING btree ("entry_type" text_ops,"occurred_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_customer_spend_ledger_visit_occurred" ON "customer_spend_ledger_entries" USING btree ("visit_id" timestamptz_ops,"occurred_at" uuid_ops,"id" uuid_ops) WHERE (visit_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_shift_templates_active" ON "shift_templates" USING btree ("active" bool_ops) WHERE (active = true);--> statement-breakpoint
CREATE INDEX "idx_late_checkout_ban_alerts_customer" ON "late_checkout_ban_alerts" USING btree ("customer_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_late_checkout_ban_alerts_occupancy_manual" ON "late_checkout_ban_alerts" USING btree ("occupancy_id" uuid_ops) WHERE (checkout_request_id IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_late_checkout_ban_alerts_request" ON "late_checkout_ban_alerts" USING btree ("checkout_request_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_late_checkout_ban_alerts_status_created" ON "late_checkout_ban_alerts" USING btree ("status" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_schedule_patterns_employee_day" ON "schedule_patterns" USING btree ("employee_id" int4_ops,"day_of_week" int4_ops) WHERE (active = true);--> statement-breakpoint
CREATE INDEX "idx_lane_sessions_checkin_mode" ON "lane_sessions" USING btree ("checkin_mode" text_ops);--> statement-breakpoint
CREATE INDEX "idx_lane_sessions_lane" ON "lane_sessions" USING btree ("lane_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_lane_sessions_lane_active" ON "lane_sessions" USING btree ("lane_id" enum_ops,"status" text_ops) WHERE (status = ANY (ARRAY['ACTIVE'::lane_session_status, 'AWAITING_CUSTOMER'::lane_session_status, 'AWAITING_ASSIGNMENT'::lane_session_status, 'AWAITING_PAYMENT'::lane_session_status, 'AWAITING_SIGNATURE'::lane_session_status]));--> statement-breakpoint
CREATE INDEX "idx_lane_sessions_selection_state" ON "lane_sessions" USING btree ("proposed_rental_type" bool_ops,"selection_confirmed" enum_ops) WHERE (proposed_rental_type IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_lane_sessions_staff" ON "lane_sessions" USING btree ("staff_id" uuid_ops) WHERE (staff_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_lane_sessions_status" ON "lane_sessions" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "idx_club_events_amount" ON "club_events" USING btree ("amount_cents" int4_ops,"occurred_at" int4_ops) WHERE (amount_cents IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_club_events_customer" ON "club_events" USING btree ("customer_id" uuid_ops,"occurred_at" timestamptz_ops) WHERE (customer_id IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_club_events_dedupe" ON "club_events" USING btree ("dedupe_key" text_ops) WHERE (dedupe_key IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_club_events_domain" ON "club_events" USING btree ("event_domain" text_ops,"occurred_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_club_events_occurred" ON "club_events" USING btree ("occurred_at" timestamptz_ops,"id" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_club_events_order" ON "club_events" USING btree ("order_id" uuid_ops) WHERE (order_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_club_events_register" ON "club_events" USING btree ("register_id" timestamptz_ops,"occurred_at" text_ops) WHERE (register_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_club_events_search_trgm" ON "club_events" USING gin ("search_blob" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_club_events_staff" ON "club_events" USING btree ("staff_id" timestamptz_ops,"occurred_at" uuid_ops) WHERE (staff_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_club_events_type" ON "club_events" USING btree ("event_type" timestamptz_ops,"occurred_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_club_events_visit" ON "club_events" USING btree ("visit_id" uuid_ops) WHERE (visit_id IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_products_category_active" ON "products" USING btree ("category" text_ops,"is_active" text_ops);--> statement-breakpoint
CREATE INDEX "idx_products_sku" ON "products" USING btree ("sku" text_ops) WHERE (sku IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_messages_created" ON "messages" USING btree ("created_at" timestamptz_ops);
*/