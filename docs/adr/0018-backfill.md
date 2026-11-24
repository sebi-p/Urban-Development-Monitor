# ADR 0018: Nightly back-fill of notices by article number

- Status: accepted
- Date: 2026-11-23
- Milestone: M5.1

## Context

PLAN §10 launches with 2020–present processed. The M0.2 inventory showed which sources have
history online: the council debates listing already covers 2020–2026 on one page, agendas keep
no history, and the urbanism hub and CTATU show only current items. Notices are the gap: the
listing shows about 90 days, and its date filter is behind a Cloudflare Turnstile check, which we
don't get around. Probes on 2026-11-23 showed that any article opens by its number alone (the
category and slug in the path are not checked), that numbers are sequential across the whole
site (about 10% are articles), and that numbers near 2,000 date from October 2019. There is no
sitemap.

## Decision

- **`Adapter.backfill`** (`IdWalk`: newest number, read one number) and a generic driver,
  `mdu backfill --city brasov [--since 2020-01-01] [--hours 5.5] [--status]`. The Brașov notices
  adapter walks article numbers downwards from the newest on the listing.
- **Same rules as the listing.** A walked article is a planning notice when its title says
  "anunț … informare" and names a PUZ or PUD (walked articles carry no category). Notices about
  plans in another town ("municipiul Săcele", "comuna Hărman") are skipped, here and on the
  daily listing. Projects are written by `write_records` and attachments queued by
  `stages.discover`, so the daily run fetches, reads, classifies and links them as usual, under
  the shared $5/month AI budget (the maintainer chose not to add a back-fill budget).
- **Checkpoints and shards.** Every 100 numbers the cursor (next number, target date, counts per
  year) is saved as a `pipeline_run` row (stage `backfill`): a run resumes there, a crash repeats
  at most 100 numbers, and the years are the shards `--status` reports, newest first. The walk is
  done after 40 articles in a row dated before the target date; an earlier `--since` resumes it.
  No schema change.
- **Nightly budget.** `.github/workflows/backfill.yml` starts between 20:00 and 20:59 UTC (Vercel Cron since
  2026-11-24, ADR 0021), walks for at most 5.5
  hours and never past 06:00 Bucharest (`--night-only`), at the shared client's one request per
  2.5 s: about 7,900 numbers a night, so about 5 nights back to January 2020. The daily and
  back-fill workflows share one concurrency group, so only one job talks to the city at a time.

## Consequences

- Collection reaches 2020 within about a week. With the $5/month budget, AI fields, consultations
  and summaries for the back-filled projects arrive over the following months; text, types,
  links and locations don't need the AI and arrive with the daily runs.
- Each night requests about 7,900 pages of about 230 KB (mostly the site's 404 template).
- Notices whose title names no PUZ/PUD (e.g. "ETAPA 2 – elaborarea propunerilor") are counted and
  skipped, as on the listing. Council minutes (votes, HCL numbers) and the Wayback Machine are
  later steps.
