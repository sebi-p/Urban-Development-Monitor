# ADR 0013: Map page filters, clustering, phone layout and Playwright

- Status: accepted
- Date: 2026-11-22
- Milestone: M4.1

## Context

PLAN §8 makes the map the home page, with filters in the URL so any view can be shared, a result list, and a mobile-first layout, because most residents arrive from a link shared in a Facebook or WhatsApp group. The acceptance test is "works on a mid-range phone at 3G speed". CLAUDE.md planned Playwright for this milestone.

## Decision

- **Filters in the URL** (`apps/web/lib/filters.ts`): `tip` (plan type), `stare` (status), `din`/`pana` (years with an event) and `consultare=deschisa` (a public consultation open today). Unknown values are ignored rather than failing, because shared links get edited. The JSON API takes the same filters as `kind`, `status`, `from`, `to` and `open=1`.
- **One filter for the map and the list:** `filterConditions` in `packages/db/src/queries.ts`. A test checks that both return the same projects for each filter.
- **The filter bar is a plain GET form,** so it works without JavaScript (an Apply button). With JavaScript, each change replaces the URL at once. Only values that occur in the data are offered. Not yet included: neighbourhoods (no neighbourhood data yet) and drawing an area.
- **Map:**
  - Created once; a filter change only swaps its data (`setData`), so a phone doesn't reload the style.
  - MapLibre's own clustering: radius 40 px, up to zoom 15, and a click on a cluster zooms in on it.
  - A pin's popup is built with `textContent` and links to the project's entry in the list.
- **Layout:** on screens under 64rem, Map and List are tabs (map first); a link to a list entry switches to the list. On wider screens the list sits beside the map. The list is in the first HTML response, so it doesn't wait for the map library.
- **Playwright** (`@playwright/test` 1.65, Apache-2.0, a dev dependency) runs against a production build with the demo data, in CI after the build, with Chromium. Traces are uploaded when a test fails.
  - **Two device profiles:** desktop Chrome, and a Moto G4 (Lighthouse's mid-range phone).
  - **Map tiles in tests:** the OpenFreeMap style is replaced by a minimal local one, so tests don't depend on an outside service.
- **The 3G budget, as a test** (`e2e/budget.e2e.ts`):
  - **Emulated conditions:** a Moto G4 screen, a network of 1.6 Mbit/s down, 750 kbit/s up and 150 ms latency, and the CPU slowed 4×.
  - **Targets:** filters usable in under 3 s, pins drawn in under 10 s, the list tab in under 0.5 s, and no sideways scrolling.
  - **Measured locally on 2026-11-22:** 0.3 s, 3.3 s and 0.12 s.

## Consequences

- Any filtered view is a link. The map stays usable on slow phones, because the list and filters don't wait for it.
- The budget doesn't include OpenFreeMap's tiles, which we don't control. On a real 3G phone the base map fills in after the pins.
- The UI kit (Tailwind and shadcn/ui, PLAN §4) is still to come. The styles stay minimal and hand-written.
