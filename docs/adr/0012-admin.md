# ADR 0012: Admin area, GitHub login and audited writes from the web

- Status: accepted
- Date: 2026-11-22
- Milestone: M3.5

## Context

PLAN §8 has an `/admin` area: review queue, merge and split, a geometry editor and re-running a stage for a document, behind a GitHub login allow-list. The acceptance test is that a reviewer can fix a wrong location in under a minute. CLAUDE.md said the web app is read-only against Postgres; the maintainer chose to amend that rule for `/admin` (2026-11-22).

## Decision

- **Login:**
  - **Auth.js v5** (`next-auth@5.0.0-beta.32`, pinned exactly; peer dependency Next ^16) with the GitHub provider and JWT sessions (8 hours, no session tables).
  - **Settings:** `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` and `ADMIN_GITHUB_LOGINS`, a comma-separated, case-insensitive allow-list. Sign-in is refused for anyone not on it.
  - **Not set up yet:** without the settings, `/admin` says it isn't configured.
  - **Why Auth.js:** it's the standard library for Next.js. v5 has been a beta for a long time, but it's widely used, and it saves us maintaining OAuth and cookie-signing code ourselves.
- **The rule, amended:** the public site stays read-only. `/admin` server actions may write, and only these:
  - review decisions (`link_candidate`);
  - merges and splits (`project.merged_into_id`, and `project_document` when a folder is approved);
  - manual locations (`geom`, `geom_precision = 'manual'`, `indicators.location`);
  - re-run marks (clearing a document's text key or its cached `extraction_run` rows).

  Each runs in one transaction in `packages/db/src/admin.ts` and writes an `audit_log` row (actor = GitHub login, before/after).

- **Every check happens twice.** Each server action checks the session and the allow-list again, because a server action is a public POST endpoint. Each admin page checks too, before loading data, because Next.js renders a page even when its layout hides it. A test showed the project table in a signed-out response before this check was added.
- **Review queue:**
  - **Approving a project pair** merges the earlier stage into the later one.
  - **Approving a hub folder** attaches its files, never a register of comments.
  - **Rejecting or splitting** records the pair as `rejected`, and the linker leaves rejected pairs out from then on, so a rejected folder can still join another project or become its own.
- **Location editor:** a draggable MapLibre pin, or a click on the map, then Save. The point must lie inside the city's bounding box. `manual` locations are never changed by the geocoder.
- **Re-run:** the web can't run Python, so it marks the document; the next daily run (or a manual workflow run) redoes the stage.
  - **Text:** clears the text key, so extract runs again.
  - **Type:** clears the classifier's marker.
  - **Fields:** clears the cached field answers of the document's projects.
- **No schema change:** `audit_log`, `link_candidate` and the precision values already exist.

## Consequences

- The web's database role is still the owner role from the Neon integration. A separate role with only the admin grants could come later.
- Playwright tests of the logged-in flow come with M4.1. Until then the writes are tested against PostGIS (`packages/db/src/admin.test.ts`), the allow-list with unit tests, and the signed-out pages by hand.
