# ADR 0007: Source adapters, status history and the daily run

- Status: accepted
- Date: 2026-11-21
- Milestones: M2.4–M2.7

## Context

PLAN §7 defines one adapter per source and a daily schedule for the debates, notices, council agendas and the urbanism hub. Until now `mdu ingest` and `mdu run` were started by hand, from two separate lookup tables. Each run overwrote a project's status, so the timeline lost its history. Some debate files (the _registru opinii_) list the residents who commented and must never be mirrored (docs/sources/brasov.md).

## Decision

- **One `Adapter` per source** (`mdu.core.adapter`), listed in `mdu.adapters.<city>.registry`. Each has a key, a base URL and any of three hooks: `projects` (listing → project records), `events` (events for known projects) and `discover` (document URLs for fetch). This is simpler than PLAN §7's protocol: `backfill_windows` and `hints` wait until back-fills need them, and hints are already part of each discovered item.
- **The four daily Brașov adapters:**
  - `council_debates`: projects and documents.
  - `notices`: projects and attachments, keyed on the decoded article ID.
  - `council_agendas`: events only. No page links to the newest session, so the adapter probes IDs upwards from the newest agenda it has stored, and stops after two empty IDs (about 3 requests a day).
  - `urbanism_hub`: documents only. PUD/PUZ files and the current year's technical urbanism committee files are included; traffic committee files aren't. Hub folder names can name private applicants, so project titles must come from the documents (M3). Hints keep only a 10-character hash of the folder, to group a project's files.
- **Agenda matching:** an agenda item adds a `council_agenda` event to a project when its normalised draft-decision title equals the project's official title exactly. Normalisation removes the "Proiect de hotărâre…" prefix and everything from "inițiator" on, writes P.U.Z./PUZ one way, and expands "mun.". A key that fits more than one project is ignored. The project's status isn't changed: the debate listing stays the source of status. Fuzzier matching is the linker's job (M3.3).
- **Status history:** when a listing shows a status different from the stored one, a `status_change` event is added. It's dated the day the change was first seen, titled with the city's own wording, and its type follows the new status (`expired` → consultation closed, approved/rejected/withdrawn → council vote). The listing's own event is still replaced on each run. Events from other sources (`details.kind = "event"`) are replaced per group, such as one council session.
- **Never-mirror rules:** an adapter lists label patterns. Matching items are queued with `hints.never_mirror`, and fetch marks them `skipped` without sending a request. Brașov's rule covers "Registru opinii" and "Registru propuneri/sugestii/observații". The two registers fetched before this rule existed (2026-11-21) stay in private R2, at the maintainer's decision.
- **`mdu daily --city <city>`** runs every daily adapter in registry order (projects, events, discover), then fetches up to 300 pending documents of up to 30 MB, then extracts text. A failing step is logged as a failed `pipeline_run` with its error, and the other steps still run; the command then exits non-zero.
- **The street index** is read from R2 and rebuilt when it's more than 30 days old (about 60 OpenFreeMap tile requests).
- **Workflow `ingest-daily.yml`:** runs at 04:30 UTC (06:30 in Bucharest in winter, 07:30 in summer) and can be started by hand. Runs don't cancel each other, and time out after 60 minutes. It uses the `DATABASE_URL_UNPOOLED` and R2 secrets. GitHub emails the repository owner when a scheduled run fails; that's the alert for now.

## Consequences

- New documents are collected, stored and extracted every day without anyone running anything. A second run on the same day only re-reads the listings.
- A site redesign shows up as a red daily run naming the failing adapter, while the other sources keep updating.
- The web list takes document links from the newest event that has them, so agenda and status events don't hide a project's files.
