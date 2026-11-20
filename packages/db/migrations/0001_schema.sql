CREATE TYPE "public"."agenda_outcome" AS ENUM('adopted', 'rejected', 'withdrawn', 'postponed');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."correction_state" AS ENUM('open', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_role" AS ENUM('memoriu', 'rlu', 'plansa_reglementari', 'raport_specialitate', 'proiect_hcl', 'hcl', 'aviz', 'raport_consultare', 'other');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('announced', 'notice_published', 'committee_review', 'consultation_opened', 'consultation_closed', 'consultation_report', 'council_agenda', 'council_vote', 'decision_adopted', 'certificate_issued', 'permit_issued', 'construction_started', 'completed', 'court_ruling', 'document_added', 'other');--> statement-breakpoint
CREATE TYPE "public"."fetch_status" AS ENUM('pending', 'fetched', 'unchanged', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."geom_precision" AS ENUM('parcel', 'address', 'street', 'neighbourhood', 'manual');--> statement-breakpoint
CREATE TYPE "public"."identifier_scheme" AS ENUM('cu', 'ac', 'hcl', 'cf', 'nr_cadastral', 'puz_code');--> statement-breakpoint
CREATE TYPE "public"."legal_regime" AS ENUM('pre_catuc', 'catuc');--> statement-breakpoint
CREATE TYPE "public"."pipeline_run_status" AS ENUM('running', 'succeeded', 'failed', 'budget_exhausted');--> statement-breakpoint
CREATE TYPE "public"."project_kind" AS ENUM('pug', 'puz', 'pud', 'cu', 'ac', 'ad', 'certificate_of_completion', 'public_infrastructure', 'regulation', 'other_council_decision');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('announced', 'in_preparation', 'in_public_consultation', 'under_committee_review', 'on_council_agenda', 'approved', 'rejected', 'withdrawn', 'permitted', 'under_construction', 'completed', 'contested', 'annulled');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('auto_published', 'pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "agenda_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"session_id" uuid NOT NULL,
	"item_number" integer NOT NULL,
	"item_text" text NOT NULL,
	"project_id" uuid,
	"outcome" "agenda_outcome",
	"votes_for" integer,
	"votes_against" integer,
	"votes_abstain" integer,
	"raw_document_id" uuid,
	CONSTRAINT "agenda_item_session_id_item_number_unique" UNIQUE("session_id","item_number")
);
--> statement-breakpoint
CREATE TABLE "council_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"session_date" date NOT NULL,
	"session_type" text,
	"source_ref" text,
	"agenda_document_id" uuid,
	"minutes_document_id" uuid,
	CONSTRAINT "council_session_jurisdiction_id_source_ref_unique" UNIQUE("jurisdiction_id","source_ref")
);
--> statement-breakpoint
CREATE TABLE "jurisdiction" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jurisdiction_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"county" text NOT NULL,
	"country" text DEFAULT 'RO' NOT NULL,
	"bbox" geometry(Polygon,4326),
	"timezone" text DEFAULT 'Europe/Bucharest' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jurisdiction_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "neighbourhood" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"boundary_source" text NOT NULL,
	CONSTRAINT "neighbourhood_jurisdiction_id_slug_unique" UNIQUE("jurisdiction_id","slug")
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"adapter" text NOT NULL,
	"base_url" text NOT NULL,
	"schedule" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_jurisdiction_id_adapter_unique" UNIQUE("jurisdiction_id","adapter")
);
--> statement-breakpoint
CREATE TABLE "extraction_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"raw_document_id" uuid NOT NULL,
	"task" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" char(64) NOT NULL,
	"output" jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_run_cache_key" UNIQUE("input_hash","prompt_version","model")
);
--> statement-breakpoint
CREATE TABLE "fetch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status" "fetch_status" DEFAULT 'pending' NOT NULL,
	"hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_at" timestamp with time zone,
	"http_status" integer,
	"etag" text,
	"last_modified" text,
	"raw_document_id" uuid,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "pipeline_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer,
	"adapter" text,
	"stage" text NOT NULL,
	"status" "pipeline_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "raw_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"sha256" char(64) NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"page_count" integer,
	"r2_key" text,
	"text_r2_key" text,
	"text_head" text,
	"ocr_used" boolean DEFAULT false NOT NULL,
	"doc_type" text,
	"contains_personal_data" boolean,
	"is_archived_copy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_document_jurisdiction_id_sha256_unique" UNIQUE("jurisdiction_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"jurisdiction_id" integer,
	"actor" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"field" text NOT NULL,
	"proposed_value" text NOT NULL,
	"evidence_url" text,
	"contact" text,
	"state" "correction_state" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "consultation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"opens_on" date,
	"closes_on" date,
	"submit_email" text,
	"submit_address" text,
	"submit_instructions" text,
	"public_meeting_at" timestamp with time zone,
	"public_meeting_place" text,
	"raw_document_id" uuid
);
--> statement-breakpoint
CREATE TABLE "identifier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"scheme" "identifier_scheme" NOT NULL,
	"value" text NOT NULL,
	"issued_on" date,
	"raw_document_id" uuid,
	CONSTRAINT "identifier_jurisdiction_id_scheme_value_unique" UNIQUE("jurisdiction_id","scheme","value")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"slug" text NOT NULL,
	"kind" "project_kind" NOT NULL,
	"status" "project_status" NOT NULL,
	"title" text NOT NULL,
	"address_text" text,
	"geom" geometry(Geometry,4326),
	"geom_precision" "geom_precision",
	"neighbourhood_id" uuid,
	"initiator" text,
	"designer" text,
	"indicators" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary_ro" text,
	"summary_en" text,
	"legal_regime" "legal_regime",
	"review_state" "review_state" DEFAULT 'pending_review' NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('romanian', unaccent_immutable(coalesce(title, ''))), 'A') ||
          setweight(to_tsvector('romanian', unaccent_immutable(coalesce(address_text, ''))), 'B') ||
          setweight(to_tsvector('romanian', unaccent_immutable(coalesce(summary_ro, ''))), 'C')) STORED,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_jurisdiction_id_slug_unique" UNIQUE("jurisdiction_id","slug")
);
--> statement-breakpoint
CREATE TABLE "project_document" (
	"jurisdiction_id" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"raw_document_id" uuid NOT NULL,
	"role" "document_role" NOT NULL,
	CONSTRAINT "project_document_project_id_raw_document_id_role_pk" PRIMARY KEY("project_id","raw_document_id","role")
);
--> statement-breakpoint
CREATE TABLE "project_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"event_type" "event_type" NOT NULL,
	"raw_document_id" uuid,
	"title" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" "confidence" NOT NULL,
	"review_state" "review_state" DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_session_id_council_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."council_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD CONSTRAINT "agenda_item_raw_document_id_raw_document_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_session" ADD CONSTRAINT "council_session_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_session" ADD CONSTRAINT "council_session_agenda_document_id_raw_document_id_fk" FOREIGN KEY ("agenda_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "council_session" ADD CONSTRAINT "council_session_minutes_document_id_raw_document_id_fk" FOREIGN KEY ("minutes_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neighbourhood" ADD CONSTRAINT "neighbourhood_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_run" ADD CONSTRAINT "extraction_run_raw_document_id_raw_document_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch" ADD CONSTRAINT "fetch_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch" ADD CONSTRAINT "fetch_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch" ADD CONSTRAINT "fetch_raw_document_id_raw_document_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_document" ADD CONSTRAINT "raw_document_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction" ADD CONSTRAINT "correction_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction" ADD CONSTRAINT "correction_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_raw_document_id_raw_document_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identifier" ADD CONSTRAINT "identifier_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identifier" ADD CONSTRAINT "identifier_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identifier" ADD CONSTRAINT "identifier_raw_document_id_raw_document_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_neighbourhood_id_neighbourhood_id_fk" FOREIGN KEY ("neighbourhood_id") REFERENCES "public"."neighbourhood"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document" ADD CONSTRAINT "project_document_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document" ADD CONSTRAINT "project_document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document" ADD CONSTRAINT "project_document_raw_document_id_raw_document_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_event" ADD CONSTRAINT "project_event_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_event" ADD CONSTRAINT "project_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_event" ADD CONSTRAINT "project_event_raw_document_id_raw_document_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agenda_item_project_idx" ON "agenda_item" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "council_session_date_idx" ON "council_session" USING btree ("jurisdiction_id","session_date");--> statement-breakpoint
CREATE INDEX "neighbourhood_geom_idx" ON "neighbourhood" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "extraction_run_document_idx" ON "extraction_run" USING btree ("raw_document_id");--> statement-breakpoint
CREATE INDEX "fetch_source_status_idx" ON "fetch" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "fetch_url_idx" ON "fetch" USING btree ("url");--> statement-breakpoint
CREATE INDEX "pipeline_run_started_idx" ON "pipeline_run" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "raw_document_url_idx" ON "raw_document" USING btree ("url");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "correction_state_idx" ON "correction" USING btree ("jurisdiction_id","state");--> statement-breakpoint
CREATE INDEX "consultation_closes_idx" ON "consultation" USING btree ("jurisdiction_id","closes_on");--> statement-breakpoint
CREATE INDEX "consultation_project_idx" ON "consultation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "identifier_project_idx" ON "identifier" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_geom_idx" ON "project" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "project_search_idx" ON "project" USING gin ("search");--> statement-breakpoint
CREATE INDEX "project_title_trgm_idx" ON "project" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "project_address_trgm_idx" ON "project" USING gin ("address_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "project_status_idx" ON "project" USING btree ("jurisdiction_id","status");--> statement-breakpoint
CREATE INDEX "project_document_document_idx" ON "project_document" USING btree ("raw_document_id");--> statement-breakpoint
CREATE INDEX "project_event_project_date_idx" ON "project_event" USING btree ("project_id","event_date");