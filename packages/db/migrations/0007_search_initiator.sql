ALTER TABLE "project" drop column "search";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('romanian', unaccent_immutable(coalesce(title, ''))), 'A') ||
          setweight(to_tsvector('romanian', unaccent_immutable(coalesce(address_text, ''))), 'B') ||
          setweight(to_tsvector('romanian', unaccent_immutable(coalesce(initiator, ''))), 'B') ||
          setweight(to_tsvector('romanian', unaccent_immutable(coalesce(summary_ro, ''))), 'C')) STORED;--> statement-breakpoint
-- Dropping the column dropped its index; the snapshot still lists it, so recreate it here.
CREATE INDEX IF NOT EXISTS "project_search_idx" ON "project" USING gin ("search");
