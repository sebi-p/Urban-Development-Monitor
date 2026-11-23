# ADR 0017: Neighbourhoods, consultations page, feeds, English pages and accessibility checks

- Status: accepted
- Date: 2026-11-23
- Milestone: M4.4

## Context

PLAN §8 lists a consultations calendar, RSS per neighbourhood, about and method pages, and a
neighbourhood facet in the archive; M4.4 adds the English site and asks that every page pass axe.
The `neighbourhood` table existed but was empty. OpenStreetMap, the source chosen in PLAN §14, has
a named point for most Brașov neighbourhoods (place = suburb, neighbourhood, village) and no
outlines; some are missing (Răcădău). The city's zoning units (UTR) may become available later.

## Decision

- **Approximate areas, replaceable.** A pipeline stage (`mdu run --stage neighbourhoods`, part
  of `mdu daily`) reads the place points and municipal borders from the same OpenFreeMap tiles as
  the street index, and draws each area as the Voronoi cell of its point (PostGIS
  `ST_VoronoiPolygons`) inside the city's bounding box. Places in neighbouring towns are seeds too,
  so edge cells stop halfway to them; only points inside the municipality become neighbourhoods
  (`boundary_source = 'osm'`, shown as "approximate"). The areas are drawn once; `--refresh`
  redraws them. Missing places go in the jurisdiction config (`neighbourhoods.extra`).
  `mdu neighbourhoods import --source pug_unit|manual --file x.geojson` replaces them with official
  or hand-drawn boundaries, which later runs never overwrite. Every run assigns each located
  project the area that contains it (`project.neighbourhood_id`). No schema change.
- **Archive facet** `cartier` (repeatable, counted without its own selection), the neighbourhood
  on each result and in the CSV, and `GET /api/{city}/neighbourhoods.geojson`.
- **Consultations page** `/{city}/consultari`: open and upcoming consultations by deadline, then
  closed ones with the notice and the city's consultation reports (`raport_consultare`).
- **Feeds**: Atom 1.0 at `/{city}/feed.xml` and `?cartier=<slug>`, new projects and their events,
  newest first (50). The path is rewritten to an API route (`next.config.ts`) so it carries no
  locale segment; `/en/{city}/feed.xml` gives the English feed.
- **English** at `/en/...` with the same paths (next-intl routing, `localePrefix: "as-needed"`,
  `proxy.ts`); Romanian stays unprefixed and the browser language never redirects, so a link
  shared in a Romanian group opens in Romanian. Pages declare canonical and hreflang links. The
  project page and share image use `summary_en` when there is one. The admin area is its own root
  layout, Romanian only.
- **About and method pages** (`/despre`, `/metodologie`), and a footer with them, the city feed
  and the licences: data CC BY 4.0, code AGPL-3.0 (`LICENSE`), map and neighbourhood areas
  © OpenStreetMap contributors (ODbL).
- **@axe-core/playwright** (MPL-2.0, test-only dev dependency): `e2e/a11y.e2e.ts` runs axe with
  the WCAG 2.1 A/AA rules on every public page, desktop and phone, Romanian and English, and fails
  on any violation. The map canvas is excluded (its contents are also in the list).

## Consequences

- Neighbourhood edges are rough (a Voronoi cell, not a street boundary); the facet and the method
  page say so. Projects outside every area (beyond the halfway line to a neighbouring town) have
  no neighbourhood.
- Fixes axe asked for: links inside text are underlined, link names start with their visible text,
  and the consultation orange text is darker (`#b23c0a`, 4.5:1 on its tint).
- The archive searches and shows Romanian text in both languages; interface strings, statuses,
  types and summaries are translated.
