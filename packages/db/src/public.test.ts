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
  sitemapProjects,
} from "./public.ts";
import { mapIndex } from "./map-index.ts";
import { getProject, listProjects, type Area } from "./queries.ts";
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
    const proj = async (slug: string, nid: string, lon: number, state = "auto_published") =>
      (
        await sql`insert into project (jurisdiction_id, slug, kind, status, title, review_state,
            neighbourhood_id, first_seen_at, geom, geom_precision)
          values (${jid}, ${slug}, 'puz', 'approved', ${`PUZ ${slug}`}, ${state}, ${nid},
                  now() - interval '2 days', ST_SetSRID(ST_MakePoint(${lon}, 45.65), 4326),
                  'street')
          returning id`
      )[0]!.id as string;
    const a = await proj("a", west, 25.55);
    const b = await proj("b", east, 25.65);
    await proj("hidden", east, 25.66, "pending_review");
    const gone = await proj("merged", east, 25.67);
    await sql`update project set merged_into_id = ${b} where id = ${gone}`;
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

  it("builds the map index: published, unmerged projects with what the filters need", async () => {
    const index = (await mapIndex(handle.db, city))!;
    expect(index.jurisdiction.slug).toBe(city);
    expect(index.neighbourhoods).toEqual([
      { slug: "est", name: "Est" },
      { slug: "vest", name: "Vest" },
    ]);
    // b has the event (newest first); "hidden" isn't published and "merged" joined b.
    expect(index.entries.map((e) => e.slug)).toEqual(["b", "a"]);
    expect(index.entries[0]).toMatchObject({
      at: [25.65, 45.65],
      date: "2025-05-01",
      years: [2025],
      neighbourhood: "est",
      consultations: [[null, null]],
      figures: {},
    });
    expect(index.entries[1]).toMatchObject({
      date: null,
      years: [],
      consultations: [["2025-03-01", "2025-03-31"]],
    });
    expect(await mapIndex(handle.db, "no-such-city")).toBeNull();
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

  // M5.6: a free-drawn polygon (a triangle around a), and one that crosses itself.
  const triangle: Area = [
    [25.5, 45.6],
    [25.6, 45.6],
    [25.55, 45.7],
  ];
  const bowtie: Area = [
    [25.5, 45.6],
    [25.7, 45.7],
    [25.7, 45.6],
    [25.5, 45.7],
  ];

  it("filters the map list and the feed by a drawn area", async () => {
    const inside = (await listProjects(handle.db, city, { area: triangle }))!;
    expect(inside.map((p) => p.slug)).toEqual(["a"]);
    const feed = (await feedEntries(handle.db, city, undefined, triangle))!;
    expect(feed.map((e) => e.project.slug)).toEqual(["a"]);
    // Repaired, not refused: both lobes of the bow tie count.
    const crossed = (await listProjects(handle.db, city, { area: bowtie }))!;
    expect(crossed.map((p) => p.slug).sort()).toEqual(["a", "b"]);
  });

  it("lists every published project for the sitemap, never hidden or merged ones", async () => {
    const pages = await sitemapProjects(handle.db);
    expect(pages.map((p) => `${p.city}/${p.slug}`).sort()).toEqual([`${city}/a`, `${city}/b`]);
    expect(pages[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("gives a project page its council items, oldest first, with the minutes page", async () => {
    const [j] = await sql`select id from jurisdiction where slug = ${city}`;
    const jid = j!.id as number;
    const [src] = await sql`select id from source limit 1`;
    const file = async (url: string) => {
      const [d] = await sql`
        insert into raw_document (jurisdiction_id, url, fetched_at, sha256, mime, size_bytes)
        values (${jid}, ${url}, now(), ${randomBytes(32).toString("hex")}, 'application/pdf', 1)
        returning id`;
      await sql`insert into "fetch" (jurisdiction_id, source_id, url, status, raw_document_id,
          fetched_at)
        values (${jid}, ${src!.id}, ${url}, 'fetched', ${d!.id}, now())`;
      return d!.id as string;
    };
    const agenda = await file("https://example.org/odz.pdf");
    const minutes = await file("https://example.org/pv.pdf");
    const [s1] = await sql`
      insert into council_session (jurisdiction_id, session_date, source_ref, agenda_document_id,
        minutes_document_id)
      values (${jid}, '2026-09-25', 'S-1', ${agenda}, ${minutes}) returning id`;
    const [s2] = await sql`
      insert into council_session (jurisdiction_id, session_date, source_ref)
      values (${jid}, '2026-10-30', 'S-2') returning id`;
    const [b] = await sql`select id from project where slug = 'b'`;
    await sql`
      insert into agenda_item (jurisdiction_id, session_id, item_number, item_text, project_id,
        outcome, votes_for, votes_abstain, raw_document_id, page)
      values (${jid}, ${s2!.id}, 3, 'PUZ b', ${b!.id}, null, null, null, null, null),
             (${jid}, ${s1!.id}, 24, 'PUZ b', ${b!.id}, 'adopted', 21, 3, ${minutes}, 6)`;
    const found = await getProject(handle.db, city, "b");
    if (!found.found) throw new Error("b not found");
    expect(found.project.council).toEqual([
      {
        sessionDate: "2026-09-25",
        itemNumber: 24,
        outcome: "adopted",
        votes: { for: 21, against: null, abstain: 3, absent: null, unanimous: false },
        minutesUrl: "https://example.org/pv.pdf",
        page: 6,
        agendaUrl: "https://example.org/odz.pdf",
      },
      expect.objectContaining({ sessionDate: "2026-10-30", outcome: null, minutesUrl: null }),
    ]);
    const a = await getProject(handle.db, city, "a");
    expect(a.found && a.project.council).toEqual([]);
    await sql`truncate council_session cascade`;
  });
});
