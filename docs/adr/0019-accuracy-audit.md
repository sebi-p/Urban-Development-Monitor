# ADR 0019: Accuracy audits with a side-by-side source viewer

- Status: accepted
- Date: 2026-11-23
- Milestone: M5.2

## Context

PLAN §10.7 asks for a hand check of a random sample of 100 projects against the source PDFs,
with targets of at least 95% correct status and 90% correct location to street level, and the
measured accuracy published on `/metodologie`. The city's site sends its files with
`X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`, so its PDFs can't be shown inside
another site.

## Decision

- **Schema** (migration `0008_accuracy_audit`, approved by the maintainer): `audit` (city, seed,
  sample size, who started it, when published), `audit_item` (one sampled project, with a snapshot
  of the values and their sources as shown when drawn, so later pipeline runs don't change what
  was judged) and `audit_check` (one verdict per item, field and figure key: `correct`, `wrong`,
  `unsure`, `not_applicable`, with a note). `AUDIT_FIELDS` and `AUDIT_VERDICTS` live in
  `packages/shared`. Writes are in `packages/db/src/audit.ts`, each with an `audit_log` row.
- **Sample:** published projects ordered by `md5(seed || id)`, so the same seed redraws the same
  sample. Checked: status, location (street level), type, title, every extracted figure, the
  summary and the consultation (period and email).
- **Publishing** requires status and location on every sampled project. `/metodologie` shows the
  latest published audit per city: per field, correct over checked (unsure answers left out, and
  counted), the Wilson 95% interval, and the PLAN target. A published audit can't be changed.
- **Viewer:** `/admin/audit/{id}/{n}` lists the values with verdict buttons beside our mirrored
  copy of the cited document, opened at its page. `GET /admin/documents/{id}` streams that copy
  from R2 to signed-in reviewers only, and only PDFs and images: an HTML page from the city served
  from our origin could run scripts with the reviewer's session. Files we don't mirror (plan sheets
  over 5 MB) open on the city's site in a new tab.
- **aws4fetch** (MIT, about 3 KB, no dependencies) signs the R2 requests. The web app gets a
  read-only R2 token (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` in
  Vercel); the public pages never read R2. Without the variables the viewer says so and the links
  still work.

## Consequences

- A 100-project audit with about 8 values each is a few hours of review; it can be done in
  sittings, since every verdict is saved at once.
- With 100 projects, a measured 95% has an interval of about 89–98%: enough to show whether the
  targets are met, not to rank small differences.
