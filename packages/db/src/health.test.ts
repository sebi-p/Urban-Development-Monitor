/**
 * Run health (M5.4) against a real PostGIS server: a missed run, a failed run and a source
 * stopped after 20 errors each give one finding; a healthy city gives none.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client.ts";
import { loadEnv } from "./env.ts";
import { runFindings, sourceHealth } from "./health.ts";
import { runMigrations } from "./migrate.ts";
import { loadJurisdictionFiles, upsertJurisdictions } from "./seed.ts";

loadEnv();
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)("run health (PostGIS)", () => {
  const dbName = `mdu_health_${randomBytes(4).toString("hex")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let handle: ReturnType<typeof createDb>;
  let city: string;
  let jid: number;

  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    await runMigrations(u.toString());
    sql = postgres(u.toString(), { max: 2, onnotice: () => {} });
    handle = createDb(u.toString(), { max: 2, onnotice: () => {} });
    await upsertJurisdictions(handle.db);
    city = loadJurisdictionFiles()[0]!.slug;
    const [j] = await sql`select id from jurisdiction where slug = ${city}`;
    jid = j!.id;
  });

  afterAll(async () => {
    await handle?.client.end();
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await sql`truncate pipeline_run, "fetch", source cascade`;
  });

  /** A pipeline_run row that finished `hours` ago. */
  const run = (
    stage: string,
    hours: number,
    status = "succeeded",
    extra: { adapter?: string; error?: string; stats?: object } = {},
  ) => sql`
    insert into pipeline_run (jurisdiction_id, adapter, stage, status, started_at, finished_at,
      error, stats)
    values (${jid}, ${extra.adapter ?? null}, ${stage}, ${status},
      now() - make_interval(secs => ${hours * 3600 + 60}), now() - make_interval(secs => ${hours * 3600}),
      ${extra.error ?? null}, ${sql.json((extra.stats ?? {}) as postgres.JSONValue)})`;

  const keys = async () => (await runFindings(handle.db, city)).map((f) => f.title);

  it("a healthy city has no findings; a finished walk needs no nights", async () => {
    await run("daily", 7);
    await run("backfill", 100, "succeeded", { adapter: "x.notices", stats: { done: true } });
    await run("backfill_night", 200, "succeeded", { stats: { done: true } });
    expect(await keys()).toEqual([]);
  });

  it("a missed or failed daily run and a missed night each raise one finding", async () => {
    await run("backfill", 30, "succeeded", { adapter: "x.notices", stats: { done: false } });
    expect(await keys()).toEqual([
      `${city}: the daily run is missing`,
      `${city}: the nightly back-fill is missing`,
    ]);
    await run("daily", 29);
    await run("backfill_night", 30, "succeeded", { stats: { done: false } });
    expect(await keys()).toEqual([
      `${city}: the daily run is missing`,
      `${city}: the nightly back-fill is missing`,
    ]);
    await run("daily", 5, "failed", { error: "x.hub discover: RuntimeError: redesigned" });
    await run("backfill_night", 8, "failed", { error: "outside the window" });
    const found = await runFindings(handle.db, city);
    expect(found.map((f) => [f.key, f.title])).toEqual([
      [`${city}:daily`, `${city}: the daily run failed`],
      [`${city}:backfill`, `${city}: the nightly back-fill failed`],
    ]);
    expect(found[0]!.detail).toContain("RuntimeError: redesigned");
  });

  it("a source stopped after 20 errors is flagged until it succeeds again", async () => {
    await run("daily", 5);
    await run("ingest", 30, "succeeded", { adapter: "x.debates" });
    await run("ingest", 5, "failed", {
      adapter: "x.debates",
      error: "TooManyErrors: 20 consecutive failures; stopping",
    });
    await run("ingest", 5, "failed", { adapter: "x.agendas", error: "RuntimeError: other" });
    expect(await keys()).toEqual([`${city}: x.debates stopped after 20 consecutive errors`]);
    const [s] = await sql`
      insert into source (jurisdiction_id, adapter, base_url)
      values (${jid}, 'x.debates', 'https://x.test') returning id`;
    for (const status of ["fetched", "fetched", "failed", "pending"]) {
      await sql`insert into "fetch" (jurisdiction_id, source_id, url, status, fetched_at)
                values (${jid}, ${s!.id}, ${`https://x.test/${randomBytes(3).toString("hex")}`},
                  ${status}, ${status === "pending" ? null : sql`now()`})`;
    }
    const health = await sourceHealth(handle.db, city);
    expect(
      health.map((h) => [h.adapter, h.failed7d, h.fetches7d, h.fetchErrors7d, h.stopped]),
    ).toEqual([
      ["x.agendas", 1, 0, 0, false],
      ["x.debates", 1, 3, 1, true],
    ]);
    await run("ingest", 1, "succeeded", { adapter: "x.debates" });
    expect(await keys()).toEqual([]);
  });
});
