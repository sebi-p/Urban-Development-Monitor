# ADR 0021: Monitoring and alerts

- Status: accepted
- Date: 2026-11-24
- Milestone: M5.4

## Context

The pipeline runs on GitHub's scheduler: `ingest-daily` every morning and `backfill` every
night. Nothing said when a run failed, when a source broke, or when GitHub skipped a scheduled
run, which it did in November 2026. A run that never started leaves nothing to notice, so a check
on the same scheduler can't catch it. The site has one environment, so a bad deploy is a broken
production site.

## Decision

- **Run records.** `mdu daily` ends with one `pipeline_run` row, stage `daily`: succeeded, or
  failed with its failed steps. `mdu backfill` writes one `backfill_night` row per run: whether
  it failed, how far it walked, and whether the walk is done. The `backfill` checkpoint rows stay
  the walk's own state. No schema change.
- **Watchdog** (`/api/watchdog`), a route on Vercel called by **Vercel Cron** once a day at
  12:00 UTC (`apps/web/vercel.json`), outside GitHub's scheduler. Vercel sends
  `Authorization: Bearer $CRON_SECRET`; any other call gets 401. For each city in the database
  it raises (`packages/db/src/health.ts`):
  - a missed daily run: none finished in the last 20 hours. The run starts at 04:30 UTC, so
    a missed morning is older than that by noon, and a late start still counts.
  - a failed daily run;
  - a missed or failed back-fill night while the walk isn't done;
  - a source the HTTP client stopped after 20 consecutive errors (`TooManyErrors`), until it
    succeeds again.
    It also runs the page checks below.
- **Alerts are GitHub issues** (`apps/web/lib/alerts.ts`), labelled `alert`. Each problem has a
  key (`brasov:daily`, `brasov:backfill`, `brasov:source:<adapter>`, `pages`) written as a marker
  in the issue body. A new problem opens an issue, and GitHub emails the maintainer. A problem
  that is still there gets a comment, not another issue. The watchdog closes the issues whose
  problem is gone. Vercel needs `GITHUB_ALERT_TOKEN`: a fine-grained token for this repository
  only, with Issues read/write. Email through a mail service was not chosen: it would add an
  account and a key, and an issue is also a record that the problem was handled.
- **Failed workflows alert at once.** `ingest-daily` and `backfill` end with an
  `if: failure() || cancelled()` step that opens or comments on the same key's issue, using
  `GITHUB_TOKEN` (`issues: write`).
- **`live-smoke.yml`** runs after each successful production deploy (`deployment_status`) and
  by hand. `apps/web/scripts/smoke.ts` checks the home, method and about pages and, per city,
  the map, archive, feed, GeoJSON API (at least one project) and the first project's page. A
  failure is retried a minute later and then raises the `pages` alert. The same checks run in CI
  on the local build (`e2e/smoke.e2e.ts`) and in the watchdog. The scripts use only `fetch` and
  relative imports, so Node 24 runs them from the checkout with no install.
- **Source health in `/admin/surse`.** For each adapter: last success, failed runs in the last 7
  and 30 days, failed fetches in the last 7 days, the last error, a mark on any source stopped
  after 20 errors, and what the watchdog would raise now.

## Consequences

- An alert reaches the maintainer within a day for a missed run. A failed run or a broken deploy
  is reported within minutes.
- Vercel Hobby allows one cron a day, run at some point within the hour. A daily run that
  GitHub starts after 12:00 UTC raises a "missing" issue, which the next day's watchdog closes.
- If Vercel itself is down, the watchdog doesn't run. The workflows' own failure alerts and
  GitHub's failed-run emails still work. An outside uptime check is out of scope.
