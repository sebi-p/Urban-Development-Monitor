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
import {
  getJurisdiction,
  getProject,
  listJurisdictions,
  listProjects,
  NEARBY_METRES,
  projectsGeoJSON,
} from "./queries.ts";
import {
  DEMO_PROJECTS_PER_JURISDICTION,
  loadJurisdictionFiles,
  removeDemoProjects,
  seed,
  upsertJurisdictions,
} from "./seed.ts";

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
  describe("queries", () => {
    it("lists jurisdictions with their bbox", async () => {
      const files = loadJurisdictionFiles();
      const list = await listJurisdictions(handle.db);
      expect(list.map((j) => j.slug).sort()).toEqual(files.map((f) => f.slug).sort());
      const first = files[0]!;
      const j = await getJurisdiction(handle.db, first.slug);
      expect(j?.bbox).toEqual(first.bbox);
      expect(await getJurisdiction(handle.db, "no-such-city")).toBeNull();
    });

    it("returns published projects as GeoJSON points", async () => {
      const slug = loadJurisdictionFiles()[0]!.slug;
      const fc = await projectsGeoJSON(handle.db, slug);
      expect(fc?.type).toBe("FeatureCollection");
      expect(fc?.features).toHaveLength(DEMO_PROJECTS_PER_JURISDICTION);
      const f = fc!.features[0]!;
      expect(f.geometry.type).toBe("Point");
      expect(f.properties).toMatchObject({ slug: expect.stringMatching(/^demo-/) });
      expect(await projectsGeoJSON(handle.db, "no-such-city")).toBeNull();
    });

    it("filters by status, kind and bbox", async () => {
      const file = loadJurisdictionFiles()[0]!;
      const consult = await projectsGeoJSON(handle.db, file.slug, {
        statuses: ["in_public_consultation"],
      });
      expect(consult!.features.length).toBeGreaterThan(0);
      for (const f of consult!.features) expect(f.properties.status).toBe("in_public_consultation");

      const puds = await projectsGeoJSON(handle.db, file.slug, { kinds: ["pud"] });
      for (const f of puds!.features) expect(f.properties.kind).toBe("pud");

      const [minLon, minLat, maxLon, maxLat] = file.bbox;
      const west = await projectsGeoJSON(handle.db, file.slug, {
        bbox: [minLon, minLat, (minLon + maxLon) / 2, maxLat],
      });
      const all = await projectsGeoJSON(handle.db, file.slug);
      expect(west!.features.length).toBeLessThan(all!.features.length);
      for (const f of west!.features) {
        const [lon] = f.geometry.coordinates as [number, number];
        expect(lon).toBeLessThanOrEqual((minLon + maxLon) / 2);
      }
    });

    it("filters the map and the list the same way (M4.1)", async () => {
      const slug = loadJurisdictionFiles()[0]!.slug;
      const year = new Date().getFullYear();
      const cases = [
        { kinds: ["puz" as const] },
        { statuses: ["approved" as const, "rejected" as const] },
        { yearFrom: year - 1, yearTo: year },
        { yearFrom: 1990, yearTo: 1991 },
        { openConsultation: true },
      ];
      for (const filters of cases) {
        const map = (await projectsGeoJSON(handle.db, slug, filters))!.features.map(
          (f) => f.properties.slug,
        );
        const list = (await listProjects(handle.db, slug, filters))!.map((p) => p.slug);
        expect(new Set(map)).toEqual(new Set(list.filter((s) => map.includes(s))));
        expect(map.every((s) => list.includes(s))).toBe(true);
      }
      const open = (await listProjects(handle.db, slug, { openConsultation: true }))!;
      const [row] = await sql`
        select count(distinct c.project_id)::int as n from consultation c
        join project p on p.id = c.project_id and p.slug like 'demo-%'
        where current_date between c.opens_on and c.closes_on`;
      expect(open.length).toBe(row!.n);
      expect((await listProjects(handle.db, slug, { yearFrom: 1990, yearTo: 1991 }))!).toEqual([]);
      const puz = (await listProjects(handle.db, slug, { kinds: ["puz"] }))!;
      expect(puz.length).toBeGreaterThan(0);
      expect(puz.every((p) => p.kind === "puz")).toBe(true);
    });

    it("hides projects that are still pending review", async () => {
      const slug = loadJurisdictionFiles()[0]!.slug;
      await sql`update project set review_state = 'pending_review' where slug = 'demo-1'`;
      const fc = await projectsGeoJSON(handle.db, slug);
      expect(fc!.features.map((f) => f.properties.slug)).not.toContain("demo-1");
      await sql`update project set review_state = 'auto_published' where slug = 'demo-1'`;
    });
  });
  describe("project list and demo data", () => {
    it("lists projects without a location too, with their latest event", async () => {
      const slug = loadJurisdictionFiles()[0]!.slug;
      const [j] = await sql`select id from jurisdiction where slug = ${slug}`;
      const [p] = await sql`
        insert into project (jurisdiction_id, slug, kind, status, title, review_state)
        values (${j!.id}, 'real-no-location', 'pud', 'approved', 'PUD fără locație', 'auto_published')
        returning id`;
      await sql`
        insert into project_event (jurisdiction_id, project_id, event_date, event_type, title,
          details, confidence, review_state)
        values (${j!.id}, ${p!.id}, '2025-05-01', 'consultation_opened', 'Publicat',
          ${sql.json({ source_url: "https://x.test/l", documents: [{ label: "A", url: "https://x.test/a.pdf", size_bytes: 1 }] })},
          'high', 'auto_published')`;
      const list = (await listProjects(handle.db, slug))!;
      const item = list.find((x) => x.slug === "real-no-location")!;
      expect(item.hasLocation).toBe(false);
      expect(item.eventDate).toBe("2025-05-01");
      expect(item.sourceUrl).toBe("https://x.test/l");
      expect(item.documents).toEqual([
        { label: "A", url: "https://x.test/a.pdf", size_bytes: 1, role: null, date: "2025-05-01" },
      ]);
      expect(list.length).toBe(DEMO_PROJECTS_PER_JURISDICTION + 1);
      // A later event without files (a council agenda) becomes the latest event, but the
      // document links still come from the listing event.
      await sql`
        insert into project_event (jurisdiction_id, project_id, event_date, event_type, title,
          details, confidence, review_state)
        values (${j!.id}, ${p!.id}, '2025-06-01', 'council_agenda', 'Pe ordinea de zi',
          ${sql.json({ source_url: "https://x.test/agenda" })}, 'high', 'auto_published')`;
      const later = (await listProjects(handle.db, slug))!.find(
        (x) => x.slug === "real-no-location",
      )!;
      expect(later.eventDate).toBe("2025-06-01");
      expect(later.eventTitle).toBe("Pe ordinea de zi");
      expect(later.documents).toEqual(item.documents);
      expect(later.initiator).toBeNull();
      expect(later.indicators).toEqual({});

      // A fetched, classified file gets its type; a register of comments never shows one.
      const [doc] = await sql`
        insert into raw_document (jurisdiction_id, url, fetched_at, sha256, mime, size_bytes,
          doc_type)
        values (${j!.id}, 'https://x.test/a.pdf', now(), ${"e".repeat(64)}, 'application/pdf', 1,
          'memoriu')
        returning id`;
      const [src] = await sql`
        insert into source (jurisdiction_id, adapter, base_url)
        values (${j!.id}, 'test.docs', 'https://x.test') returning id`;
      await sql`
        insert into "fetch" (jurisdiction_id, source_id, url, status, raw_document_id, fetched_at)
        values (${j!.id}, ${src!.id}, 'https://x.test/a.pdf', 'fetched', ${doc!.id}, now())`;
      const indicators = {
        pot_percent: {
          value: 35,
          source_document_id: doc!.id,
          page: 2,
          confidence: "medium",
          source_url: "https://x.test/a.pdf",
        },
      };
      await sql`
        update project set initiator = 'SC ALFA SRL', indicators = ${sql.json(indicators)}
        where id = ${p!.id}`;
      const typed = (await listProjects(handle.db, slug))!.find(
        (x) => x.slug === "real-no-location",
      )!;
      expect(typed.documents[0]!.role).toBe("memoriu");
      expect(typed.initiator).toBe("SC ALFA SRL");
      expect(typed.indicators.pot_percent?.page).toBe(2);

      // The linker merged a notice into this project: the notice is hidden, its newer event and
      // its files show here, and a file attached from the urbanism page is listed by its type.
      const [b] = await sql`
        insert into project (jurisdiction_id, slug, kind, status, title, review_state,
          merged_into_id, geom)
        values (${j!.id}, 'merged-notice', 'pud', 'in_preparation', 'Anunț', 'auto_published',
          ${p!.id}, ST_SetSRID(ST_MakePoint(25.6, 45.65), 4326))
        returning id`;
      await sql`
        insert into project_event (jurisdiction_id, project_id, event_date, event_type, title,
          details, confidence, review_state)
        values (${j!.id}, ${b!.id}, '2025-07-01', 'notice_published', 'Anunț publicat',
          ${sql.json({ documents: [{ label: "00. Anunt", url: "https://x.test/n.pdf", size_bytes: 2 }] })},
          'high', 'auto_published')`;
      const [hub] = await sql`
        insert into raw_document (jurisdiction_id, url, fetched_at, sha256, mime, size_bytes,
          doc_type)
        values (${j!.id}, 'https://x.test/hub.pdf', now(), ${"f".repeat(64)}, 'application/pdf',
          3, 'rlu')
        returning id`;
      await sql`
        insert into "fetch" (jurisdiction_id, source_id, url, status, raw_document_id, fetched_at)
        values (${j!.id}, ${src!.id}, 'https://x.test/hub.pdf', 'fetched', ${hub!.id}, now())`;
      await sql`
        insert into project_document (jurisdiction_id, project_id, raw_document_id, role)
        values (${j!.id}, ${b!.id}, ${hub!.id}, 'rlu')`;
      const all = (await listProjects(handle.db, slug))!;
      expect(all.map((x) => x.slug)).not.toContain("merged-notice");
      const root = all.find((x) => x.slug === "real-no-location")!;
      expect(root.eventTitle).toBe("Anunț publicat");
      expect(root.documents.map((d) => d.url)).toEqual([
        "https://x.test/n.pdf",
        "https://x.test/a.pdf",
        "https://x.test/hub.pdf",
      ]);
      expect(root.documents[2]).toMatchObject({ label: null, role: "rlu" });
      const merged = (await projectsGeoJSON(handle.db, slug))!;
      expect(merged.features.map((f) => f.properties.slug)).not.toContain("merged-notice");
      // The map only gets located projects.
      const fc = (await projectsGeoJSON(handle.db, slug))!;
      expect(fc.features.map((f) => f.properties.slug)).not.toContain("real-no-location");
      expect(await listProjects(handle.db, "no-such-city")).toBeNull();
    });

    it("gives a project page its timeline, consultation, nearby projects and redirects (M4.2)", async () => {
      const slug = loadJurisdictionFiles()[0]!.slug;
      const demo = await getProject(handle.db, slug, "demo-1");
      if (!demo.found) throw new Error("demo-1 not found");
      const p = demo.project;
      expect(p.events.map((e) => e.type)).toEqual(["consultation_opened", "notice_published"]);
      expect(p.events.map((e) => e.date)).toEqual([...p.events.map((e) => e.date)].sort());
      const [c] = p.consultations;
      expect(c).toMatchObject({ submitEmail: "registratura@example.org" });
      expect(new Date(c!.closesOn!) > new Date()).toBe(true);
      expect(c!.publicMeetingAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(p.nearby[0]).toMatchObject({ slug: "demo-2" });
      expect(p.nearby[0]!.distanceM).toBeLessThan(NEARBY_METRES);
      expect(p.summaryRo).toMatch(/fictiv/);
      expect(p.indicators.summary?.page).toBe(1);
      expect([p.lon, p.lat].every((x) => typeof x === "number")).toBe(true);
      expect(Date.parse(p.lastCheckedAt)).not.toBeNaN();

      // The project the notice was merged into shows the notice's events and files; the
      // notice's own slug redirects there.
      expect(await getProject(handle.db, slug, "merged-notice")).toEqual({
        found: false,
        redirectTo: "real-no-location",
      });
      const root = await getProject(handle.db, slug, "real-no-location");
      if (!root.found) throw new Error("real-no-location not found");
      expect(root.project.events.map((e) => e.date)).toEqual([
        "2025-05-01",
        "2025-06-01",
        "2025-07-01",
      ]);
      expect(root.project.documents).toHaveLength(3);
      expect(root.project.lon).toBeNull();
      expect(root.project.nearby).toEqual([]);

      expect(await getProject(handle.db, slug, "no-such-slug")).toEqual({
        found: false,
        redirectTo: null,
      });
      await sql`update project set review_state = 'pending_review' where slug = 'demo-3'`;
      expect((await getProject(handle.db, slug, "demo-3")).found).toBe(false);
      await sql`update project set review_state = 'auto_published' where slug = 'demo-3'`;
    });

    it("removes only demo projects and keeps jurisdictions", async () => {
      const removed = await removeDemoProjects(handle.db);
      expect(removed).toBe(DEMO_PROJECTS_PER_JURISDICTION * loadJurisdictionFiles().length);
      const [row] = await sql`select count(*)::int as n from project`;
      expect(row!.n).toBe(2); // the two real-looking projects from the previous test
      const ids = await upsertJurisdictions(handle.db);
      expect(ids.size).toBe(loadJurisdictionFiles().length);
    });
  });
});
