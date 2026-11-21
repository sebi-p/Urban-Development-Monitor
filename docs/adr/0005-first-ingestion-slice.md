# ADR 0005: First ingestion slice: listings, street-level locations, privacy guards

- Status: accepted (amended by ADR 0007: adapters, status history, daily run)
- Date: 2026-11-20
- Milestones: an early slice of M2.4 (debates), M2.6 (notices) and M3.4 (geocoding)

## Context

The maintainer wanted real data on the live site before the full pipeline (document fetching, text extraction, LLM fields, linker) exists. The public-debate listing and the urbanism notices already state official titles, dates, statuses and document links, which is enough for a useful, sourced project list and map.

## Decision

- **`mdu ingest --adapter brasov.council_debates | brasov.notices`** turns listing pages into projects:
  - **Scope:** only PUZ/PUD items (urban planning); council decisions on taxes, budgets and similar are out of scope.
  - **Statuses:** debates map to approved, in public consultation, withdrawn or rejected. "Termen expirat conform legii" maps to `expired` (added 2026-11-21): the public-debate period has ended and the draft goes on to the council. Such drafts appear on later council agendas, so the phrase doesn't mean the draft lapsed. Notices are "in preparation", with a "notice published" event.
  - **Each project gets a timeline event citing a `raw_document`** (later status changes add events, ADR 0007): the listing or article snapshot, stored privately in R2 under `raw/<city>/<yyyy>/<sha256>.<ext>`. The event's details hold the official title, the source URL and links to the city's own document copies; nothing is re-hosted.
  - **Writes happen in one transaction per run, and are idempotent.** Slugs come from the title plus a hash of a private key, never the city's folder names.
- **The Python side writes Postgres with `psycopg` 3** and plain SQL against the Drizzle-managed tables. The enum values it writes are checked against `packages/shared` by a test.
- **Privacy guards (PLAN §11), applied before anything is written:**
  - Titles with words that name a private person (`domnul`, `doamna`, `persoană fizică`, CNP and similar) are skipped.
  - Titles with a role word (initiator, beneficiary, applicant, owner) are skipped unless an organisation follows (SRL, SA, foundation, municipality, parish and so on).
  - **Single private homes** (`locuință` in the singular, unifamilial or individual) are skipped. A street and house number identify the owner even without a name.
- **Street-level locations:** street names come from the OpenFreeMap vector tiles the map already uses (layer `transportation_name`, 72 zoom-14 tiles for Brașov, via `mapbox-vector-tile`).
  - **Neighbouring towns are excluded:** a street sample is kept only if the line from it to the city centre crosses an even number of municipal borders (the tiles' `boundary` layer, admin level ≤ 8, clipped per tile). Without this, a street name shared with Săcele placed a Brașov project in Săcele.
  - **Matching:** street mentions in titles are matched locally after normalisation (diacritics, both ș/ț forms, street-type words). Locations are marked `geom_precision = "street"` and shown as approximate.
  - **The index is cached** locally (`pipeline/.cache/`, gitignored) and in R2 (`cache/streets/<city>.json`).
- **Sources not used:** each one's robots.txt disallows the path, or it failed when tried on 2026-11-20.
  - Nominatim: robots.txt disallows `/search`.
  - The OSM API: robots.txt disallows `/api/0.6/`.
  - Wikimedia geoshapes: robots.txt disallows the service.
  - The public Overpass instances: one answered 406 and then refused connections; another timed out.
- **The deploy step no longer seeds demo data.** It upserts jurisdictions and deletes `demo-%` projects; `MDU_DEMO_DATA=on` brings the demo back.

## Consequences

- Pins mark the street, not the building, and a long street puts the pin near its middle. Exact locations wait for document extraction (M3) or a city GIS export.
- Items with a skipped status, or caught by a privacy guard, don't appear on the site. The guards are deliberately conservative, so a few legitimate projects may be missing until reviewed (M3.5).
- Ingestion runs every day from the `ingest-daily` workflow (ADR 0007), and can still be run by hand against the production database.
