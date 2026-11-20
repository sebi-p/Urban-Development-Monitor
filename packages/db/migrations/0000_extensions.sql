-- Extensions and SQL functions the schema depends on (PLAN §4, §6). Must run before 0001.
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
-- Generated columns need immutable functions; unaccent() is only STABLE because its dictionary
-- could change. Pinning the dictionary makes it safe to declare IMMUTABLE, so "Racadau" matches
-- "Răcădău" in project.search.
CREATE OR REPLACE FUNCTION public.unaccent_immutable(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
