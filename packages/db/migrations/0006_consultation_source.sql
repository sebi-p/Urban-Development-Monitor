ALTER TABLE "consultation" ADD COLUMN "page" integer;--> statement-breakpoint
ALTER TABLE "consultation" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "consultation" ADD CONSTRAINT "consultation_project_id_raw_document_id_unique" UNIQUE("project_id","raw_document_id");