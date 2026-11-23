/**
 * M4.4 queries against a real PostGIS server: neighbourhoods and their GeoJSON, the consultations
 * calendar with the city's reports, and the feeds (all, or one neighbourhood).
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.ts";
import { loadEnv } from "./env.ts";
import { runMigrations } from "./migrate.ts";
import {
  feedEntries,
  listConsultations,
  listNeighbourhoods,
  neighbourhoodsGeoJSON,
} from "./public.ts";
import { loadJurisdictionFiles, upsertJurisdictions } from "./seed.ts";

loadEnv();
const adminUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl)("M4.4 public queries (PostGIS)", () => {
  const dbName = `mdu_public_${randomBytes(4).toString("hex")}`;
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
    const jid = j!.id as number;
    const area = async (slug: string, name: string, x0: number, x1: number) =>
      (
        await sql`insert into neighbourhood (jurisdiction_id, slug, name, geom, boundary_source)
          values (${jid}, ${slug}, ${name},
                  ST_Multi(ST_MakeEnvelope(${x0}, 45.6, ${x1}, 45.7, 4326)), 'osm')
          returning id`
      )[0]!.id as string;
    const west = await area("vest", "Vest", 25.5, 25.6);
    const east = await area("est", "Est", 25.6, 25.7);
    const proj = async (slug: string, nid: string, state = "auto_published") =>
      (
        await sql`insert into project (jurisdiction_id, slug, kind, status, title, review_state,
            neighbourhood_id, first_seen_at)
          values (${jid}, ${slug}, 'puz', 'approved', ${`PUZ ${slug}`}, ${state}, ${nid},
                  now() - interval '2 days')
          returning id`
      )[0]!.id as string;
    const a = await proj("a", west);
    const b = await proj("b", east);
    await proj("hidden", east, "pending_review");
    const [src] = await sql`insert into source (jurisdiction_id, adapter, base_url)
      values (${jid}, 'test.docs', 'https://example.org') returning id`;
    const doc = async (url: string, type: string) => {
      const [d] = await sql`
        insert into raw_document (jurisdiction_id, url, fetched_at, sha256, mime, size_bytes,
          doc_type)
        values (${jid}, ${url}, now(), ${randomBytes(32).toString("hex")}, 'application/pdf', 1,
          ${type})
        returning id`;
      await sql`insert into "fetch" (jurisdiction_id, source_id, url, status, raw_document_id,
          fetched_at)
        values (${jid}, ${src!.id}, ${url}, 'fetched', ${d!.id}, now())`;
      return d!.id as string;
    };
    const notice = await doc("https://example.org/anunt.pdf", "anunt");
    const report = await doc("https://example.org/raport.pdf", "raport_consultare");
    await sql`insert into project_document (jurisdiction_id, project_id, raw_document_id, role)
      values (${jid}, ${a}, ${report}, 'raport_consultare')`;
    await sql`insert into consultation (jurisdiction_id, project_id, opens_on, closes_on,
        submit_email, raw_document_id, page)
      values (${jid}, ${a}, '2025-03-01', '2025-03-31', 'urbanism@example.org', ${notice}, 2),
             (${jid}, ${b}, null, null, null, null, null)`;
    await sql`insert into project_event (jurisdiction_id, project_id, event_date, event_type, title,
        confidence, review_state, created_at)
      values (${jid}, ${b}, '2025-05-01', 'council_vote', 'Vot în consiliu', 'high',
              'auto_published', now())`;
  });

  afterAll(async () => {
    await handle?.client.end();
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it("lists neighbourhoods with their published projects, and their shapes", async () => {
    expect(await listNeighbourhoods(handle.db, city)).toEqual([
      { slug: "est", name: "Est", boundarySource: "osm", projects: 1 },
      { slug: "vest", name: "Vest", boundarySource: "osm", projects: 1 },
    ]);
    const geo = (await neighbourhoodsGeoJSON(handle.db, city))!;
    expect(geo.features.map((f) => f.properties.slug)).toEqual(["est", "vest"]);
    expect(geo.features[0]!.geometry.type).toBe("MultiPolygon");
    expect(await listNeighbourhoods(handle.db, "no-such-city")).toBeNull();
  });

  it("lists consultations with dates, their notice page and the city's report", async () => {
    const list = (await listConsultations(handle.db, city))!;
    expect(list).toHaveLength(1); // the one without dates is left out
    expect(list[0]).toMatchObject({
      project: { slug: "a" },
      neighbourhood: "Vest",
      closesOn: "2025-03-31",
      submitEmail: "urbanism@example.org",
      sourceUrl: "https://example.org/anunt.pdf",
      page: 2,
      reports: ["https://example.org/raport.pdf"],
    });
  });

  it("feeds new projects and events, newest first, for the city or one neighbourhood", async () => {
    const all = (await feedEntries(handle.db, city))!;
    expect(all.map((e) => [e.kind, e.project.slug])).toEqual([
      ["event", "b"],
      ["new_project", "b"], // first seen just after a
      ["new_project", "a"],
    ]);
    expect(all[0]).toMatchObject({ eventType: "council_vote", date: "2025-05-01" });
    const west = (await feedEntries(handle.db, city, "vest"))!;
    expect(west.map((e) => e.project.slug)).toEqual(["a"]);
    expect(await feedEntries(handle.db, city, "nicaieri")).toEqual([]);
  });
});
