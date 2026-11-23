/**
 * Archive search (M4.3) against a real PostGIS server: diacritics, word beginnings, the
 * initiator, facet counts that ignore their own selection, sort orders and pages.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.ts";
import { loadEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";
import { prefixQuery, searchProjects } from "./search.ts";
import { loadJurisdictionFiles, upsertJurisdictions } from "./seed.ts";

loadEnv();
const adminUrl = process.env.TEST_DATABASE_URL;

describe("prefixQuery", () => {
  it("keeps only words, each matched from its beginning", () => {
    expect(prefixQuery("Racadau  bloc")).toBe("Racadau:* & bloc:*");
    expect(prefixQuery("a' | !b & (c)")).toBe("a:* & b:* & c:*");
    expect(prefixQuery("  ")).toBeNull();
    expect(prefixQuery(undefined)).toBeNull();
  });
});

describe.skipIf(!adminUrl)("archive search (PostGIS)", () => {
  const dbName = `mdu_search_${randomBytes(4).toString("hex")}`;
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
    await upsertJurisdictions(handle.db);
    city = loadJurisdictionFiles()[0]!.slug;
    const [j] = await sql`select id from jurisdiction where slug = ${city}`;
    const rows = [
      ["racadau", "puz", "approved", "PUZ locuințe colective Răcădău", "SC ALFA SRL", "2024-03-01"],
      ["tractorul", "puz", "in_preparation", "PUZ zona Tractorul", "SC BETA SRL", "2026-05-01"],
      ["lunga", "pud", "approved", "PUD birouri str. Lungă", "SC ALFA SRL", "2025-07-01"],
      ["hidden", "pud", "approved", "PUD Răcădău ascuns", null, "2025-01-01"],
    ] as const;
    const [west] = await sql`
      insert into neighbourhood (jurisdiction_id, slug, name, geom, boundary_source)
      values (${j!.id}, 'vest', 'Vest',
              ST_Multi(ST_MakeEnvelope(25.5, 45.6, 25.6, 45.7, 4326)), 'osm')
      returning id`;
    for (const [slug, kind, status, title, initiator, date] of rows) {
      const [p] = await sql`
        insert into project (jurisdiction_id, slug, kind, status, title, initiator,
          summary_ro, review_state)
        values (${j!.id}, ${slug}, ${kind}, ${status}, ${title}, ${initiator},
          ${`Rezumat ${title}`}, ${slug === "hidden" ? "pending_review" : "auto_published"})
        returning id`;
      if (slug === "racadau" || slug === "lunga") {
        await sql`update project set neighbourhood_id = ${west!.id} where id = ${p!.id}`;
      }
      await sql`
        insert into project_event (jurisdiction_id, project_id, event_date, event_type, title,
          confidence, review_state)
        values (${j!.id}, ${p!.id}, ${date}, 'consultation_opened', 'Publicat', 'high',
          'auto_published')`;
    }
  });

  afterAll(async () => {
    await handle?.client.end();
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  const slugs = async (params: Parameters<typeof searchProjects>[2]) =>
    (await searchProjects(handle.db, city, params))!.hits.map((h) => h.slug);

  it('"Racadau" finds "Răcădău", and so does the start of a word', async () => {
    expect(await slugs({ q: "Racadau" })).toEqual(["racadau"]); // not the unpublished one
    expect(await slugs({ q: "răcăd" })).toEqual(["racadau"]);
    expect(await slugs({ q: "locuinte racadau" })).toEqual(["racadau"]);
    expect(await slugs({ q: "nimic asemanator" })).toEqual([]);
  });

  it("finds the initiator and sorts by relevance or date", async () => {
    expect((await slugs({ q: "alfa" })).sort()).toEqual(["lunga", "racadau"]);
    expect(await slugs({ q: "alfa", sort: "date" })).toEqual(["lunga", "racadau"]);
    expect(await slugs({})).toEqual(["tractorul", "lunga", "racadau"]); // no query: newest first
  });

  it("counts each facet without its own selection, and pages", async () => {
    const r = (await searchProjects(handle.db, city, {
      kinds: ["puz"],
      initiators: ["SC ALFA SRL"],
    }))!;
    expect(r.hits.map((h) => h.slug)).toEqual(["racadau"]);
    expect(r.total).toBe(1);
    // Kind counts ignore the kind filter (both ALFA projects); initiator counts ignore theirs.
    expect(r.facets.kinds).toEqual([
      { value: "puz", count: 1 }, // equal counts keep the enum's order
      { value: "pud", count: 1 },
    ]);
    expect(r.facets.initiators).toEqual([
      { value: "SC ALFA SRL", count: 1 },
      { value: "SC BETA SRL", count: 1 },
    ]);
    expect(r.facets.years).toEqual([{ value: 2024, count: 1 }]);
    const p2 = (await searchProjects(handle.db, city, { pageSize: 2, page: 2 }))!;
    expect([p2.total, p2.hits.map((h) => h.slug)]).toEqual([3, ["racadau"]]);
    const past = (await searchProjects(handle.db, city, { pageSize: 2, page: 9 }))!;
    expect([past.total, past.hits]).toEqual([3, []]);
    expect(await searchProjects(handle.db, "no-such-city", {})).toBeNull();
  });

  it("filters by neighbourhood and counts the areas without that filter", async () => {
    const r = (await searchProjects(handle.db, city, { neighbourhoods: ["vest"] }))!;
    expect(r.hits.map((h) => h.slug).sort()).toEqual(["lunga", "racadau"]);
    expect(r.hits[0]!.neighbourhood).toBe("Vest");
    expect(r.facets.neighbourhoods).toEqual([
      { value: "vest", label: "Vest", approximate: true, count: 2 },
    ]);
    const puz = (await searchProjects(handle.db, city, { kinds: ["puz"] }))!;
    expect(puz.facets.neighbourhoods).toEqual([
      { value: "vest", label: "Vest", approximate: true, count: 1 },
    ]);
  });
});
