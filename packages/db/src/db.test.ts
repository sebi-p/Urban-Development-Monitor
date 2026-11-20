/**
 * Integration tests against a real PostGIS server. Each run creates a fresh database, applies the
 * migrations, seeds it and drops it. Skipped when TEST_DATABASE_URL is unset; CI always sets it.
 */
import * as shared from "@mdu/shared";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.ts";
import { loadEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";
import * as schema from "./schema/index.ts";
import { DEMO_PROJECTS_PER_JURISDICTION, loadJurisdictionFiles, seed } from "./seed.ts";

/** Drizzle wraps driver errors; the Postgres error is the cause. 23505 = unique_violation. */
const UNIQUE_VIOLATION = { cause: { code: "23505" } };

loadEnv();
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)("database (PostGIS)", () => {
  const dbName = `mdu_test_${randomBytes(4).toString("hex")}`;
  let url: string;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let handle: ReturnType<typeof createDb>;

  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(adminUrl!);
    u.pathname = `/${dbName}`;
    url = u.toString();
    await runMigrations(url);
    sql = postgres(url, { max: 2, onnotice: () => {} });
    handle = createDb(url, { max: 2, onnotice: () => {} });
    await seed(handle.db);
  });

  afterAll(async () => {
    await handle?.client.end();
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("re-running the migrations is a no-op", async () => {
    await expect(runMigrations(url)).resolves.toBeUndefined();
  });

  it("enables postgis, pg_trgm and unaccent", async () => {
    const rows = await sql`select extname from pg_extension`;
    expect(rows.map((r) => r.extname)).toEqual(
      expect.arrayContaining(["postgis", "pg_trgm", "unaccent"]),
    );
  });

  it("keeps Postgres enums identical to packages/shared", async () => {
    const pairs: [string, readonly string[]][] = [
      ["project_kind", shared.PROJECT_KINDS],
      ["project_status", shared.PROJECT_STATUSES],
      ["geom_precision", shared.GEOM_PRECISIONS],
      ["event_type", shared.EVENT_TYPES],
      ["identifier_scheme", shared.IDENTIFIER_SCHEMES],
      ["document_role", shared.DOCUMENT_ROLES],
      ["review_state", shared.REVIEW_STATES],
      ["confidence", shared.CONFIDENCE_LEVELS],
      ["agenda_outcome", shared.AGENDA_OUTCOMES],
      ["fetch_status", shared.FETCH_STATUSES],
      ["correction_state", shared.CORRECTION_STATES],
      ["legal_regime", shared.LEGAL_REGIMES],
      ["pipeline_run_status", shared.PIPELINE_RUN_STATUSES],
    ];
    const rows = await sql`
      select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`;
    const inDb = Object.fromEntries(rows.map((r) => [r.typname, r.labels]));
    expect(Object.keys(inDb).sort()).toEqual(pairs.map(([n]) => n).sort());
    for (const [name, values] of pairs) expect(inDb[name], name).toEqual([...values]);
  });

  it("creates the spatial, full-text and trigram indexes", async () => {
    const rows = await sql`select indexname, indexdef from pg_indexes where tablename = 'project'`;
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef as string]));
    expect(defs.project_geom_idx).toMatch(/USING gist \(geom\)/);
    expect(defs.project_search_idx).toMatch(/USING gin \(search\)/);
    expect(defs.project_title_trgm_idx).toMatch(/gin_trgm_ops/);
    expect(defs.project_address_trgm_idx).toMatch(/gin_trgm_ops/);
  });

  it("seeds 10 demo projects inside each jurisdiction's bbox, idempotently", async () => {
    await seed(handle.db);
    const files = loadJurisdictionFiles();
    const rows = await sql`
      select j.slug, count(*)::int as n, count(*) filter (where ST_Within(p.geom, j.bbox))::int as inside
      from project p join jurisdiction j on j.id = p.jurisdiction_id
      where p.slug like 'demo-%' group by j.slug`;
    expect(rows).toHaveLength(files.length);
    for (const r of rows) {
      expect(r.n).toBe(DEMO_PROJECTS_PER_JURISDICTION);
      expect(r.inside).toBe(DEMO_PROJECTS_PER_JURISDICTION);
    }
  });

  it("matches searches without diacritics against text with them", async () => {
    const rows = await sql`
      select title from project
      where search @@ websearch_to_tsquery('romanian', unaccent_immutable('Gradinii'))`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.title).toContain("Grădinii");
  });

  it("rejects a second LLM cache entry with the same input, prompt and model", async () => {
    const [j] = await handle.db.select().from(schema.jurisdiction).limit(1);
    const [doc] = await handle.db
      .insert(schema.rawDocument)
      .values({
        jurisdictionId: j!.id,
        url: "https://example.test/a.pdf",
        fetchedAt: new Date(),
        sha256: "a".repeat(64),
        mime: "application/pdf",
        sizeBytes: 1,
      })
      .returning();
    const run = {
      jurisdictionId: j!.id,
      rawDocumentId: doc!.id,
      task: "extract_fields",
      model: "test-model",
      promptVersion: "v1",
      inputHash: "b".repeat(64),
      output: {},
    };
    await handle.db.insert(schema.extractionRun).values(run);
    await expect(handle.db.insert(schema.extractionRun).values(run)).rejects.toMatchObject(
      UNIQUE_VIOLATION,
    );
  });

  it("rejects a duplicate official identifier within a jurisdiction", async () => {
    const [p] = await handle.db.select().from(schema.project).limit(1);
    await expect(
      handle.db.insert(schema.identifier).values({
        jurisdictionId: p!.jurisdictionId,
        projectId: p!.id,
        scheme: "puz_code",
        value: "DEMO-1",
      }),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });
});
