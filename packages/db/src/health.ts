/**
 * Run health (M5.4, ADR 0021): what the watchdog alerts on, and the source-health view in /admin.
 * Everything is read from `pipeline_run` and `fetch`; the pipeline writes one `daily` row per
 * morning run and one `backfill_night` row per night.
 */
import { sql } from "drizzle-orm";
import type { Db } from "./client.ts";

/**
 * A run older than this is missed. The daily run starts at 04:30 UTC and the watchdog checks
 * around 12:00 UTC, so a morning without a run is always older than 20 hours by then, and a run
 * GitHub started a few hours late still counts.
 */
export const MISSED_AFTER_HOURS = 20;

/** What the HTTP client raises after 20 failed requests in a row (pipeline core/http.py). */
const STOPPED = "TooManyErrors";

export interface Finding {
  /** Stable per problem: one open issue per key. */
  key: string;
  title: string;
  detail: string;
}

interface LastRun {
  status: string;
  hours: number;
  error: string | null;
  stats: Record<string, unknown>;
}

async function lastRun(db: Db, city: string, stage: string): Promise<LastRun | null> {
  const [row] = await db.execute<{
    status: string;
    hours: number;
    error: string | null;
    stats: Record<string, unknown>;
  }>(sql`
    select r.status::text as status, r.error, r.stats,
           extract(epoch from now() - coalesce(r.finished_at, r.started_at)) / 3600 as hours
    from pipeline_run r join jurisdiction j on j.id = r.jurisdiction_id
    where j.slug = ${city} and r.stage = ${stage}
    order by r.started_at desc limit 1`);
  return row ? { ...row, hours: Number(row.hours) } : null;
}

/**
 * True while the city's back-fill walk isn't finished: some adapter's latest checkpoint isn't
 * done, or the city has a back-fill (`config.backfill`) that never wrote a checkpoint.
 */
async function walkPending(db: Db, city: string): Promise<boolean> {
  const rows = await db.execute<{ done: boolean | null }>(sql`
    select distinct on (r.adapter) (r.stats->>'done')::boolean as done
    from pipeline_run r join jurisdiction j on j.id = r.jurisdiction_id
    where j.slug = ${city} and r.stage = 'backfill'
    order by r.adapter, r.started_at desc`);
  if (rows.length) return rows.some((r) => !r.done);
  const [j] = await db.execute<{ backfill: boolean | null }>(
    sql`select (config->>'backfill')::boolean as backfill from jurisdiction where slug = ${city}`,
  );
  return j?.backfill === true;
}

const ago = (hours: number) =>
  hours < 48 ? `${Math.round(hours)} hours ago` : `${Math.round(hours / 24)} days ago`;

/** The problems with one city's runs right now; empty when all is well. */
export async function runFindings(db: Db, city: string): Promise<Finding[]> {
  const out: Finding[] = [];
  const daily = await lastRun(db, city, "daily");
  if (!daily || daily.hours > MISSED_AFTER_HOURS) {
    out.push({
      key: `${city}:daily`,
      title: `${city}: the daily run is missing`,
      detail: daily
        ? `The last daily run finished ${ago(daily.hours)}. GitHub may have skipped the schedule: start "Ingest daily" by hand.`
        : "No daily run has been recorded yet.",
    });
  } else if (daily.status !== "succeeded") {
    out.push({
      key: `${city}:daily`,
      title: `${city}: the daily run failed`,
      detail: `Failed steps: ${daily.error ?? "unknown"}`,
    });
  }

  const night = await lastRun(db, city, "backfill_night");
  const pending = night ? night.stats.done !== true : await walkPending(db, city);
  if (pending) {
    if (!night || night.hours > MISSED_AFTER_HOURS) {
      out.push({
        key: `${city}:backfill`,
        title: `${city}: the nightly back-fill is missing`,
        detail: night
          ? `The last back-fill night finished ${ago(night.hours)} and the walk isn't done.`
          : "The back-fill walk isn't done and no night has been recorded yet.",
      });
    } else if (night.status !== "succeeded") {
      out.push({
        key: `${city}:backfill`,
        title: `${city}: the nightly back-fill failed`,
        detail: night.error ?? "unknown error",
      });
    }
  }

  // A source the HTTP client stopped after 20 consecutive errors, since its last success.
  for (const s of await sourceHealth(db, city)) {
    if (s.stopped) {
      out.push({
        key: `${city}:source:${s.adapter}`,
        title: `${city}: ${s.adapter} stopped after 20 consecutive errors`,
        detail: s.lastError ?? "",
      });
    }
  }
  return out;
}

export interface SourceHealth {
  adapter: string;
  lastSuccess: string | null;
  lastFailure: string | null;
  lastError: string | null;
  failed7d: number;
  failed30d: number;
  /** Fetches in the last 7 days, and how many failed. */
  fetches7d: number;
  fetchErrors7d: number;
  /** The latest failure came after the latest success and was the 20-errors stop. */
  stopped: boolean;
}

/** One row per adapter: last success, failures, fetch error rate (the /admin source view). */
export async function sourceHealth(db: Db, city: string): Promise<SourceHealth[]> {
  const rows = await db.execute<{
    adapter: string;
    last_success: string | null;
    last_failure: string | null;
    last_error: string | null;
    failed_7d: number;
    failed_30d: number;
    fetches_7d: number;
    fetch_errors_7d: number;
  }>(sql`
    with j as (select id from jurisdiction where slug = ${city}),
    runs as (
      select r.adapter,
             max(coalesce(r.finished_at, r.started_at)) filter (where r.status = 'succeeded')
               as last_success,
             max(r.started_at) filter (where r.status = 'failed') as last_failure,
             (array_agg(r.error order by r.started_at desc)
               filter (where r.status = 'failed'))[1] as last_error,
             count(*) filter (where r.status = 'failed'
               and r.started_at > now() - interval '7 days')::int as failed_7d,
             count(*) filter (where r.status = 'failed'
               and r.started_at > now() - interval '30 days')::int as failed_30d
      from pipeline_run r
      where r.jurisdiction_id = (select id from j) and r.adapter is not null
      group by r.adapter
    ),
    fetches as (
      select s.adapter,
             count(*) filter (where f.status in ('fetched', 'unchanged', 'failed'))::int
               as fetches_7d,
             count(*) filter (where f.status = 'failed')::int as fetch_errors_7d
      from "fetch" f join source s on s.id = f.source_id
      where f.jurisdiction_id = (select id from j) and f.fetched_at > now() - interval '7 days'
      group by s.adapter
    )
    select coalesce(runs.adapter, fetches.adapter) as adapter,
           runs.last_success, runs.last_failure, runs.last_error,
           coalesce(runs.failed_7d, 0) as failed_7d, coalesce(runs.failed_30d, 0) as failed_30d,
           coalesce(fetches.fetches_7d, 0) as fetches_7d,
           coalesce(fetches.fetch_errors_7d, 0) as fetch_errors_7d
    from runs full join fetches on fetches.adapter = runs.adapter
    order by 1`);
  const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
  return rows.map((r) => {
    const lastSuccess = iso(r.last_success);
    const lastFailure = iso(r.last_failure);
    return {
      adapter: r.adapter,
      lastSuccess,
      lastFailure,
      lastError: r.last_error,
      failed7d: r.failed_7d,
      failed30d: r.failed_30d,
      fetches7d: r.fetches_7d,
      fetchErrors7d: r.fetch_errors_7d,
      stopped:
        !!lastFailure &&
        (!lastSuccess || lastFailure > lastSuccess) &&
        !!r.last_error?.startsWith(STOPPED),
    };
  });
}

/** Every city the database knows (the watchdog checks each). */
export async function citySlugs(db: Db): Promise<string[]> {
  const rows = await db.execute<{ slug: string }>(sql`select slug from jurisdiction order by slug`);
  return rows.map((r) => r.slug);
}
