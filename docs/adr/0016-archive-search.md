# ADR 0016: Archive search and list–map highlighting

- Status: accepted
- Date: 2026-11-23
- Milestone: M4.3

## Context

PLAN §8 asks for a searchable archive (`/{city}/arhiva`): full text with highlighted snippets,
facets, two sort orders and a CSV export, where "Racadau" finds "Răcădău" and cached results come
back in under 300 ms. The maintainer also asked for list–map highlighting on the map page.

## Decision

- **Postgres full text only**, no search service. `project.search` (Romanian stemming over
  `unaccent`) now also covers the initiator (migration `0007_search_initiator`, which rebuilds the
  generated column and its GIN index). A query becomes a prefix tsquery of its words
  (`racadau:* & bloc:*`); only letters and digits pass, so user text is never tsquery syntax.
- **Facets** (type, status, year, initiator) are counted without their own selection, so several
  values of one facet can be ticked. Neighbourhoods wait for neighbourhood data (M4.4).
- **Highlighting is done in the page**, not with `ts_headline` (which can't match "racadau" in
  "Răcădău"): words are folded per character and rendered as text parts, never as HTML.
- **Caching:** results are cached for 5 minutes per city and query (`unstable_cache`); the JSON
  and CSV routes send `s-maxage=300`.
- **CSV:** UTF-8 with a byte-order mark (Excel), every field quoted, and a leading `= + - @`
  prefixed with `'` so a spreadsheet never runs it as a formula. At most 5,000 rows.
- **Without JavaScript** the archive is one GET form; with it, a facet change submits at once.
  Checked values repeat in the URL (`tip=puz&tip=pud`); the map page now reads that form too.
- **List–map highlighting:** cards and map talk through window events (`lib/map-events.ts`). A
  card's hover or keyboard focus draws its pin larger with an accent ring; "Arată pe hartă" zooms
  past the cluster level, opens the popup and, on phones, lowers the sheet. The map reports the
  drawn highlight in `data-highlighted` for the browser tests.

## Consequences

- No new dependency or service. Search cost grows with the number of projects; with a few
  thousand rows Postgres answers in milliseconds.
- A search term matches word beginnings and Romanian stems, so "gradinii" also finds
  "grădiniță" (same stem).
