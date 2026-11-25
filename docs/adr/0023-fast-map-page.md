# ADR 0023: A fast map page (filters in the browser, server next to the database)

- Status: accepted
- Date: 2026-11-25
- Milestone: M5.7

## Context

In production the map page `/{city}` took 3.3–3.7 s to its first byte, and every filter change
waited as long again. It was 1.08 MB of HTML for 78 projects and grew with each one the back-fill
added. Going back from a project page lost the map's zoom and the list's scroll, and on phones
the sheet closed.

The causes, measured:

- **Region.** Vercel ran the functions in `iad1` (Washington) while Neon is in eu-central-1
  (Frankfurt). The page's database pool had one connection, so its ~12 queries crossed the
  Atlantic one after another. The list query also ran twice: the second time only to build the
  filter options.
- **No caching.** The page reads its filters from the URL, so it rendered on every request.
- **Heavy cards.** Each card carried its documents (448 inline icons) and every figure's source
  link, and the same data travelled again as React's payload.
- **Rebuilt on back.** The map was created again at the city's bounds and the list started at
  the top.

## Decision

- **Functions in Frankfurt.** `vercel.json` sets `"regions": ["fra1"]`, next to the database
  (Hobby allows one region). The web pool has 4 connections (Neon's PgBouncer pooler takes many),
  so a page's queries run side by side.
- **One cached index, filtered in the browser.**
  - `mapIndex` returns one compact entry per published project: what a card shows plus what the
    filters need (event years, neighbourhood, consultation windows, a point for the area test).
  - It is cached for 5 minutes (`unstable_cache`, tag `city-index`). The admin actions that
    change a project invalidate the tag, and the pipeline runs once a day.
  - The browser fetches it once per session from `/api/{city}/map.json`, which the CDN caches.
  - Filters run in `lib/explore.ts`. The same code serves the server's first view, browsers
    without JavaScript (the form still submits) and every change in the browser, so both sides
    always show the same set. It mirrors `filterConditions` in packages/db; for the drawn area,
    an even-odd point-in-polygon test stands in for `ST_Intersects` (all locations are points).
  - A filter change replaces the URL through the native history API, which Next keeps in step
    with `useSearchParams`: no request, and the URL stays shareable. Until the index arrives,
    the progress bar shows and the server's view stays.
  - The feeds, the archive and the GeoJSON API still filter in the database.
- **Compact cards, 30 at a time.** A card shows the status, type and date, title, address,
  location note, figures and initiator, plus "Arată pe hartă". Documents and each figure's
  source page are on the project page. More cards load as the reader scrolls. Without
  JavaScript, a link (`?afisate=60`) asks the server for more.
- **Back means where you were.** The map's view, the sheet's height, the list's scroll and the
  number of cards shown are saved per URL in `sessionStorage` (this tab only) and restored when
  the page opens again. A filter change carries the view over to the new URL. Without storage
  (private mode), nothing is restored and the page works as before.
- **Budgets.** The 3G phone test (CPU 4× slower) times the interactions inside the page, from the
  input event to the next paint, so Playwright's own overhead doesn't count:
  - opening the list under 500 ms (M4.1);
  - a filter change under 300 ms;
  - going back to the list where it was under 300 ms.

  `live-smoke` fails when the map page passes 400 KB, and checks the index endpoint.

## Consequences

- Locally, the map page is about 160 KB (25 KB gzipped) whatever the city's size, and answers in
  about 0.1 s. The index grows by about 500 bytes per project (about 100 KB gzipped at
  2,000 projects), loaded once per session.
- The filters exist twice: in SQL (feeds, archive, API) and in `lib/explore.ts`. A new filter
  must be added to both, with tests on each side.
- Changes from the pipeline show on the map within 5 minutes; admin edits show at once.
- Polygon project geometries, if they come, are tested by a point on the shape
  (`ST_PointOnSurface`), not by their whole outline.
