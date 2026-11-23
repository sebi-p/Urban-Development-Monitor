/**
 * M5.2 accuracy audits against a real PostGIS server: a seeded sample with snapshots, verdicts
 * with an audit trail, publishing rules, and the published accuracy with its interval.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminError } from "./admin.ts";
import {
  checksFor,
  getAuditItem,
  latestAuditResults,
  listAudits,
  publishAudit,
  recordCheck,
  startAudit,
  wilson,
} from "./audit.ts";
import { createDb } from "./client.ts";
import { loadEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";
import { loadJurisdictionFiles, seed } from "./seed.ts";

loadEnv();
const adminUrl = process.env.TEST_DATABASE_URL;

describe("wilson", () => {
  it("gives the 95% score interval", () => {
    const [low, high] = wilson(95, 100);
    expect(low).toBeCloseTo(0.888, 3);
    expect(high).toBeCloseTo(0.978, 3);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});

describe.skipIf(!adminUrl)("accuracy audits (PostGIS)", () => {
  const dbName = `mdu_audit_${randomBytes(4).toString("hex")}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let handle: ReturnType<typeof createDb>;
  let city: string;

  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    await runMigrations(u.toString());
    sql = postgres(u.toString(), { max: 2, onnotice: () => {} });
    handle = createDb(u.toString(), { max: 2, onnotice: () => {} });
    await seed(handle.db);
    city = loadJurisdictionFiles()[0]!.slug;
  });

  afterAll(async () => {
    await handle?.client.end();
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("draws the same sample from the same seed, with snapshots", async () => {
    const a = await startAudit(handle.db, { city, size: 4, actor: "rev", seed: 7 });
    const b = await startAudit(handle.db, { city, size: 4, actor: "rev", seed: 7 });
    const order = async (id: string) =>
      (
        await sql`select p.slug from audit_item i join project p on p.id = i.project_id
                  where i.audit_id = ${id} order by i.position`
      ).map((r) => r.slug as string);
    expect(await order(a)).toEqual(await order(b));
    expect(await order(a)).toHaveLength(4);
    const big = await startAudit(handle.db, { city, size: 50, actor: "rev", seed: 1 });
    expect((await listAudits(handle.db, city)).find((x) => x.id === big)!.sampleSize).toBe(10);
    await expect(startAudit(handle.db, { city, size: 0, actor: "rev" })).rejects.toThrow(
      AdminError,
    );
    const log = await sql`select action from audit_log where entity = 'audit'`;
    expect(log).toHaveLength(3);
  });

  it("checks values, refuses what isn't there, and publishes when complete", async () => {
    // demo-1 has figures, a summary and a consultation: put it in the sample for sure.
    const id = await startAudit(handle.db, { city, size: 10, actor: "rev", seed: 3 });
    const all = await sql`select i.id, i.position, p.slug from audit_item i
      join project p on p.id = i.project_id where i.audit_id = ${id} order by i.position`;
    const demo1 = all.find((r) => r.slug === "demo-1")!;
    const view = (await getAuditItem(handle.db, id, demo1.position as number))!;
    const snap = view.item.snapshot;
    expect(snap.slug).toBe("demo-1");
    expect(snap.figures.map((f) => f.key)).toEqual(["dwellings", "height_regime"]);
    expect(snap.figures[0]!.source?.page).toBe(4);
    expect(snap.summary?.text).toContain("Proiect fictiv");
    expect(snap.consultation?.email).toBe("registratura@example.org");
    expect(checksFor(snap).map((c) => `${c.field}:${c.key}`)).toEqual([
      "status:",
      "location:",
      "kind:",
      "title:",
      "figure:dwellings",
      "figure:height_regime",
      "summary:",
      "consultation:",
    ]);

    const check = (itemId: string, field: string, verdict: string, key = "") =>
      recordCheck(handle.db, { itemId, field, key, verdict, actor: "rev" });
    await check(demo1.id as string, "figure", "wrong", "dwellings");
    await check(demo1.id as string, "figure", "correct", "dwellings"); // changed mind: one row
    await expect(check(demo1.id as string, "figure", "correct", "cut")).rejects.toThrow(
      "nothing to check",
    );
    await expect(check(demo1.id as string, "colour", "correct")).rejects.toThrow("unknown field");
    await expect(check(demo1.id as string, "status", "maybe")).rejects.toThrow("unknown verdict");
    const rows = await sql`select verdict from audit_check where item_id = ${demo1.id}`;
    expect(rows.map((r) => r.verdict)).toEqual(["correct"]);
    const trail = await sql`select before, after from audit_log
      where entity = 'audit_item' and entity_id = ${demo1.id} order by id`;
    expect(trail).toHaveLength(2);
    expect(trail[1]!.before).toMatchObject({ verdict: "wrong" });

    await expect(publishAudit(handle.db, { auditId: id, actor: "rev" })).rejects.toThrow(
      "10 projects still need status and location",
    );
    for (const [n, r] of all.entries()) {
      await check(r.id as string, "status", n === 0 ? "wrong" : "correct");
      await check(r.id as string, "location", n < 2 ? "unsure" : "correct");
    }
    expect(await latestAuditResults(handle.db, city)).toBeNull();
    await publishAudit(handle.db, { auditId: id, actor: "rev" });
    await expect(check(demo1.id as string, "kind", "correct")).rejects.toThrow("published");

    const results = (await latestAuditResults(handle.db, city))!;
    expect(results.projects).toBe(10);
    const status = results.fields.find((f) => f.field === "status")!;
    expect([status.checked, status.correct, status.accuracy, status.target]).toEqual([
      10, 9, 0.9, 0.95,
    ]);
    expect(status.low).toBeGreaterThan(0.5);
    const location = results.fields.find((f) => f.field === "location")!;
    expect([location.checked, location.correct, location.unsure]).toEqual([8, 8, 2]);
    expect(results.fields.map((f) => f.field)).toEqual(["status", "location", "figure"]);
  });
});
