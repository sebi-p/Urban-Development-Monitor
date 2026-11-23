CREATE TYPE "public"."audit_field" AS ENUM('status', 'location', 'kind', 'title', 'figure', 'summary', 'consultation');--> statement-breakpoint
CREATE TYPE "public"."audit_verdict" AS ENUM('correct', 'wrong', 'unsure', 'not_applicable');--> statement-breakpoint
CREATE TABLE "audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"seed" integer NOT NULL,
	"sample_size" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"field" "audit_field" NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"verdict" "audit_verdict" NOT NULL,
	"note" text,
	"checked_by" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_check_item_id_field_key_unique" UNIQUE("item_id","field","key")
);
--> statement-breakpoint
CREATE TABLE "audit_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "audit_item_audit_id_position_unique" UNIQUE("audit_id","position"),
	CONSTRAINT "audit_item_audit_id_project_id_unique" UNIQUE("audit_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "audit" ADD CONSTRAINT "audit_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_check" ADD CONSTRAINT "audit_check_item_id_audit_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."audit_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_item" ADD CONSTRAINT "audit_item_audit_id_audit_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_item" ADD CONSTRAINT "audit_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;