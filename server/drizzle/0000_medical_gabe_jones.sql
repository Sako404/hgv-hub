CREATE TABLE IF NOT EXISTS "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"placement_id" text NOT NULL,
	"site_id" text,
	"rate_card_lineage_id" text,
	"start_date" text NOT NULL,
	"end_date" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checklist_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"is_default" boolean NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"rules" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cpc_training_records" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"date" text NOT NULL,
	"hours" double precision NOT NULL,
	"provider" text,
	"notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "defects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"raised_from_check_id" text,
	"raised_from_item_code" text,
	"raised_by_driver_id" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"resolved_at" text,
	"resolved_notes" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"document_type" text NOT NULL,
	"label" text,
	"reference_number" text,
	"expiry_date" text,
	"notes" text,
	"archived_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "driver_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"reference_number" text,
	"default_break_minutes" integer,
	"last_used_assignment_id" text,
	"preferred_assignment_id" text,
	"archived_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_organisation_id" text NOT NULL,
	"employer_organisation_id" text,
	"workspace_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"relationship_type" text NOT NULL,
	"role" text,
	"start_date" text NOT NULL,
	"end_date" text,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"shift_id" text NOT NULL,
	"reference" text,
	"description" text,
	"amount" double precision NOT NULL,
	"distance_miles" double precision,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"person_id" text NOT NULL,
	"roles" text[] NOT NULL,
	"archived_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organisations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"trading_name" text NOT NULL,
	"types" text[] NOT NULL,
	"archived_at" text,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"first_name" text,
	"last_name" text,
	"display_name" text,
	"email" text,
	"archived_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "placements" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_organisation_id" text NOT NULL,
	"site_id" text NOT NULL,
	"rate_card_lineage_id" text NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"archived_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_card_lineages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"pay_type" text,
	"archived_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"lineage_id" text NOT NULL,
	"version" integer NOT NULL,
	"supersedes_id" text,
	"effective_from" text NOT NULL,
	"rates" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"assignment_id" text,
	"date" text NOT NULL,
	"start" text NOT NULL,
	"end" text NOT NULL,
	"break_minutes" integer NOT NULL,
	"driving_hours" double precision NOT NULL,
	"rate_card_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"client_name" text,
	"address" text,
	"notes" text,
	"archived_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicle_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"driver_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"paired_vehicle_id" text,
	"shift_id" text,
	"checklist_template_id" text NOT NULL,
	"items" jsonb NOT NULL,
	"overall_result" text NOT NULL,
	"odometer_reading" integer,
	"performed_at" text NOT NULL,
	"driver_sign_off_name" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"registration" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"make" text,
	"model" text,
	"notes" text,
	"mot_expiry_date" text,
	"insurance_expiry_date" text,
	"archived_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"owner_person_id" text,
	"created_at" text NOT NULL
);
