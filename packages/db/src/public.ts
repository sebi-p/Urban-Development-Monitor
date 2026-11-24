/**
 * Read-only queries for the M4.4 pages: neighbourhoods (archive facet, RSS, GeoJSON API), the
 * consultations calendar and the feeds.
 */
import type { EventType, ProjectKind, ProjectStatus } from "@mdu/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { areaGeometry, type Area } from "./queries.ts";
import { jurisdiction } from "./schema/index.ts";

const PUBLISHED = sql`('auto_published', 'approved')`;

async function jurisdictionId(db: Db, city: string): Promise<number | null> {
  const [j] = await db
    .select({ id: jurisdiction.id })
    .from(jurisdiction)
    .where(eq(jurisdiction.slug, city));
  return j?.id ?? null;
}

export interface NeighbourhoodItem {
  slug: string;
  name: string;
  /** "osm" (approximate, drawn around OpenStreetMap's point), "pug_unit" or "manual". */
  boundarySource: string;
  projects: number;
}

export async function listNeighbourhoods(
  db: Db,
  city: string,
): Promise<NeighbourhoodItem[] | null> {
  const jid = await jurisdictionId(db, city);
  if (jid === null) return null;
  const rows = await db.execute<{
    slug: string;
    name: string;
    boundary_source: string;
    projects: number;
  }>(sql`
    select n.slug, n.name, n.boundary_source,
           (select count(*)::int from project p where p.neighbourhood_id = n.id
              and p.merged_into_id is null and p.review_state in ${PUBLISHED}) as projects
    from neighbourhood n where n.jurisdiction_id = ${jid}
    order by n.name collate "C"`);
  return rows
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      boundarySource: r.boundary_source,
      projects: r.projects,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ro"));
}

export interface NeighbourhoodCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
    properties: { slug: string; name: string; boundarySource: string };
  }[];
}

/** Boundaries, simplified to about 10 m and rounded to 5 decimals (about 1 m). */
export async function neighbourhoodsGeoJSON(
  db: Db,
  city: string,
): Promise<NeighbourhoodCollection | null> {
  const jid = await jurisdictionId(db, city);
  if (jid === null) return null;
  const rows = await db.execute<{
    slug: string;
    name: string;
    boundary_source: string;
    geometry: string;
  }>(sql`
    select slug, name, boundary_source,
           ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, 0.0001)), 5) as geometry
    from neighbourhood where jurisdiction_id = ${jid} order by slug`);
  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature",
      geometry: JSON.parse(r.geometry),
      properties: { slug: r.slug, name: r.name, boundarySource: r.boundary_source },
    })),
  };
}

export interface ConsultationListItem {
  project: { slug: string; title: string; kind: ProjectKind; status: ProjectStatus };
  neighbourhood: string | null;
  opensOn: string | null;
  closesOn: string | null;
  submitEmail: string | null;
  submitAddress: string | null;
  publicMeetingAt: string | null;
  publicMeetingPlace: string | null;
  /** The notice the dates were read from, and its page. */
  sourceUrl: string | null;
  page: number | null;
  /** The city's consultation reports (`raport_consultare`) for the project. */
  reports: string[];
}

/** Every consultation with dates, newest closing date first (the page splits open and past). */
export async function listConsultations(
  db: Db,
  city: string,
): Promise<ConsultationListItem[] | null> {
  const jid = await jurisdictionId(db, city);
  if (jid === null) return null;
  const rows = await db.execute<{
    slug: string;
    title: string;
    kind: ProjectKind;
    status: ProjectStatus;
    neighbourhood: string | null;
    opens_on: string | null;
    closes_on: string | null;
    submit_email: string | null;
    submit_address: string | null;
    public_meeting_at: string | null;
    public_meeting_place: string | null;
    source_url: string | null;
    page: number | null;
    reports: string[] | null;
  }>(sql`
    select p.slug, p.title, p.kind, p.status,
           (select n.name from neighbourhood n where n.id = p.neighbourhood_id) as neighbourhood,
           co.opens_on::text, co.closes_on::text, co.submit_email, co.submit_address,
           to_json(co.public_meeting_at) #>> '{}' as public_meeting_at, co.public_meeting_place,
           co.page,
           (select f.url from "fetch" f where f.raw_document_id = co.raw_document_id
            order by f.fetched_at desc nulls last limit 1) as source_url,
           (select array_agg(distinct f.url) from project c
              join project_document pd on pd.project_id = c.id
              join raw_document d on d.id = pd.raw_document_id
              join "fetch" f on f.raw_document_id = d.id
            where (c.id = p.id or c.merged_into_id = p.id)
              and d.doc_type = 'raport_consultare') as reports
    from consultation co
    join project c0 on c0.id = co.project_id
    join project p on p.id = coalesce(c0.merged_into_id, c0.id)
    where co.jurisdiction_id = ${jid}
      and (co.opens_on is not null or co.closes_on is not null)
      and p.review_state in ${PUBLISHED}
    order by co.closes_on desc nulls last, co.opens_on desc nulls last, p.title`);
  return rows.map((r) => ({
    project: { slug: r.slug, title: r.title, kind: r.kind, status: r.status },
    neighbourhood: r.neighbourhood,
    opensOn: r.opens_on,
    closesOn: r.closes_on,
    submitEmail: r.submit_email,
    submitAddress: r.submit_address,
    publicMeetingAt: r.public_meeting_at,
    publicMeetingPlace: r.public_meeting_place,
    sourceUrl: r.source_url,
    page: r.page,
    reports: r.reports ?? [],
  }));
}

export interface FeedEntry {
  /** Stable across runs: the event's id, or the project's for "new project". */
  id: string;
  kind: "new_project" | "event";
  eventType: EventType | null;
  title: string; // the event's title, or the project's
  date: string | null; // the event's date (ISO), when the city gave one
  updatedAt: string; // when the site learned of it (ISO timestamp)
  project: { slug: string; title: string; kind: ProjectKind; status: ProjectStatus };
  summary: string | null;
  summaryEn: string | null;
  neighbourhood: string | null;
}

export const FEED_SIZE = 50;

/** What changed lately: new projects and their events, newest first, optionally per area. */
export async function feedEntries(
  db: Db,
  city: string,
  neighbourhood?: string,
  drawn?: Area,
): Promise<FeedEntry[] | null> {
  const jid = await jurisdictionId(db, city);
  if (jid === null) return null;
  const inNeighbourhood = neighbourhood
    ? sql`and p.neighbourhood_id = (select n.id from neighbourhood n
          where n.jurisdiction_id = ${jid} and n.slug = ${neighbourhood})`
    : sql``;
  const inDrawn = drawn ? sql`and ST_Intersects(p.geom, ${areaGeometry(drawn)})` : sql``;
  const area = sql`${inNeighbourhood} ${inDrawn}`;
  const rows = await db.execute<{
    id: string;
    kind: "new_project" | "event";
    event_type: EventType | null;
    title: string;
    date: string | null;
    updated_at: string;
    slug: string;
    project_title: string;
    project_kind: ProjectKind;
    status: ProjectStatus;
    summary: string | null;
    summary_en: string | null;
    neighbourhood: string | null;
  }>(sql`
    with visible as (
      select p.* from project p
      where p.jurisdiction_id = ${jid} and p.merged_into_id is null
        and p.review_state in ${PUBLISHED} ${area}),
    entries as (
      select p.id::text as id, 'new_project' as kind, null::text as event_type, p.title,
             null::text as date, p.first_seen_at as updated_at, p.id as project_id
      from visible p
      union all
      select ev.id::text, 'event', ev.event_type::text, ev.title, ev.event_date::text,
             ev.created_at, p.id
      from project_event ev
      join project c on c.id = ev.project_id
      join visible p on p.id = coalesce(c.merged_into_id, c.id)
      where ev.review_state in ${PUBLISHED})
    select e.id, e.kind, e.event_type, e.title, e.date,
           to_json(e.updated_at) #>> '{}' as updated_at,
           p.slug, p.title as project_title, p.kind as project_kind, p.status,
           p.summary_ro as summary, p.summary_en,
           (select n.name from neighbourhood n where n.id = p.neighbourhood_id) as neighbourhood
    from entries e join visible p on p.id = e.project_id
    order by e.updated_at desc, e.date desc nulls last, e.id
    limit ${FEED_SIZE}`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    eventType: r.event_type,
    title: r.title,
    date: r.date,
    updatedAt: r.updated_at,
    project: { slug: r.slug, title: r.project_title, kind: r.project_kind, status: r.status },
    summary: r.summary,
    summaryEn: r.summary_en,
    neighbourhood: r.neighbourhood,
  }));
}

export interface SitemapProject {
  city: string;
  slug: string;
  updatedAt: string;
}

/** Every published project page (M5.6 sitemap), newest change first. */
export async function sitemapProjects(db: Db): Promise<SitemapProject[]> {
  const rows = await db.execute<{ city: string; slug: string; updated_at: string | Date }>(sql`
    select j.slug as city, p.slug, p.updated_at
    from project p join jurisdiction j on j.id = p.jurisdiction_id
    where p.merged_into_id is null and p.review_state in ${PUBLISHED}
    order by p.updated_at desc`);
  return rows.map((r) => ({
    city: r.city,
    slug: r.slug,
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}
