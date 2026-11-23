ALTER TABLE "agenda_item" ADD COLUMN "votes_absent" integer;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD COLUMN "unanimous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agenda_item" ADD COLUMN "page" integer;