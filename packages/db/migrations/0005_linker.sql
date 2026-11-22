CREATE TABLE "link_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" integer NOT NULL,
	"subject" text NOT NULL,
	"subject_project_id" uuid,
	"candidate_project_id" uuid NOT NULL,
	"score" numeric(4, 3) NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "review_state" DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "link_candidate_pair" UNIQUE("jurisdiction_id","subject","candidate_project_id")
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "link_candidate" ADD CONSTRAINT "link_candidate_jurisdiction_id_jurisdiction_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdiction"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_candidate" ADD CONSTRAINT "link_candidate_subject_project_id_project_id_fk" FOREIGN KEY ("subject_project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_candidate" ADD CONSTRAINT "link_candidate_candidate_project_id_project_id_fk" FOREIGN KEY ("candidate_project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_candidate_state_idx" ON "link_candidate" USING btree ("jurisdiction_id","state");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_merged_into_id_project_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_merged_into_idx" ON "project" USING btree ("merged_into_id");