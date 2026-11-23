/** Read-only queries for the public site (admin writes are in admin.ts, ADR 0012). */
import type {
  DocumentRole,
  EventType,
  ProjectIndicators,
  ProjectKind,
  ProjectStatus,
} from "@mdu/shared";
import { asc, eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client.ts";
import { jurisdiction } from "./schema/index.ts";

export type BBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface JurisdictionSummary {
  slug: string;
  name: string;
  county: string;
  timezone: string;
  bbox: BBox | null;
}

const bboxColumn = sql<BBox | null>`
  case when ${jurisdiction.bbox} is null then null else json_build_array(
    ST_XMin(${jurisdiction.bbox}), ST_YMin(${jurisdiction.bbox}),
    ST_XMax(${jurisdiction.bbox}), ST_YMax(${jurisdiction.bbox})) end`;

const summaryColumns = {
  slug: jurisdiction.slug,
  name: jurisdiction.name,
  county: jurisdiction.county,
  timezone: jurisdiction.timezone,
  bbox: bboxColumn,
};

export async function listJurisdictions(db: Db): Promise<JurisdictionSummary[]> {
  return db.select(summaryColumns).from(jurisdiction).orderBy(asc(jurisdiction.name));
}

export async function getJurisdiction(db: Db, slug: string): Promise<JurisdictionSummary | null> {
  const [row] = await db
    .select(summaryColumns)
    .from(jurisdiction)
    .where(eq(jurisdiction.slug, slug));
  return row ?? null;
}

export interface ProjectFilters {
  bbox?: BBox;
  kinds?: ProjectKind[];
  statuses?: ProjectStatus[];
  /** Projects with an event (theirs or a merged project's) in these years, inclusive. */
  yearFrom?: number;
  yearTo?: number;
  /** Only projects whose public consultation is open today (Bucharest date). */
  openConsultation?: boolean;
  /** Neighbourhood slugs (M4.4): projects located in any of them. */
  neighbourhoods?: string[];
}

/** SQL conditions on `project p` shared by the map and the list, so both show the same set. */
export function filterConditions(filters: ProjectFilters): SQL[] {
  const out: SQL[] = [];
  const family = sql`(select c.id from project c where c.id = p.id or c.merged_into_id = p.id)`;
  if (filters.bbox) {
    const [minLon, minLat, maxLon, maxLat] = filters.bbox;
    out.push(sql`p.geom && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`);
  }
  if (filters.kinds?.length) out.push(sql`p.kind::text in ${filters.kinds}`);
  if (filters.statuses?.length) out.push(sql`p.status::text in ${filters.statuses}`);
  if (filters.yearFrom !== undefined || filters.yearTo !== undefined) {
    const from = filters.yearFrom ?? 1900;
    const to = filters.yearTo ?? 2999;
    out.push(sql`exists (select 1 from project_event ev where ev.project_id in ${family}
      and ev.review_state in ('auto_published', 'approved')
      and extract(year from ev.event_date) between ${from} and ${to})`);
  }
  if (filters.neighbourhoods?.length) {
    out.push(sql`p.neighbourhood_id in (select n.id from neighbourhood n
      where n.jurisdiction_id = p.jurisdiction_id and n.slug in ${filters.neighbourhoods})`);
  }
  if (filters.openConsultation) {
    out.push(sql`exists (select 1 from consultation co where co.project_id in ${family}
      and (now() at time zone 'Europe/Bucharest')::date between co.opens_on and co.closes_on)`);
  }
  return out;
}

export interface ProjectFeature {
  type: "Feature";
  id: string;
  geometry: { type: string; coordinates: unknown };
  properties: {
    slug: string;
    title: string;
    kind: ProjectKind;
    status: ProjectStatus;
    address: string | null;
    geomPrecision: string | null;
  };
}

export interface ProjectCollection {
  type: "FeatureCollection";
  features: ProjectFeature[];
}

/** Published projects with a geometry, as GeoJSON. Null when the jurisdiction doesn't exist. */
export async function projectsGeoJSON(
  db: Db,
  slug: string,
  filters: ProjectFilters = {},
): Promise<ProjectCollection | null> {
  const [j] = await db
    .select({ id: jurisdiction.id })
    .from(jurisdiction)
    .where(eq(jurisdiction.slug, slug));
  if (!j) return null;

  const rows = await db.execute<{
    id: string;
    slug: string;
    title: string;
    kind: ProjectKind;
    status: ProjectStatus;
    address: string | null;
    geomPrecision: string | null;
    geometry: string;
  }>(sql`
    select p.id, p.slug, p.title, p.kind, p.status, p.address_text as address,
           p.geom_precision as "geomPrecision", ST_AsGeoJSON(p.geom, 6) as geometry
    from project p
    where p.jurisdiction_id = ${j.id} and p.geom is not null
      -- Only reviewed or high-confidence records are public (PLAN §7 stage 8).
      and p.review_state in ('auto_published', 'approved')
      and p.merged_into_id is null -- merged projects show on the project they joined
      ${sql.join(filterConditions(filters).map((c) => sql` and ${c}`))}
    order by p.title`);

  return {
    type: "FeatureCollection",
    features: rows.map(({ id, geometry, ...properties }) => ({
      type: "Feature",
      id,
      geometry: JSON.parse(geometry) as ProjectFeature["geometry"],
      properties,
    })),
  };
}

export interface ProjectDocumentLink {
  /** The city's link text; null for files known only by their type (shown as the type). */
  label: string | null;
  url: string;
  size_bytes: number | null;
  /** Classified document type, when the file has been fetched and classified. */
  role?: DocumentRole | null;
  /** When the city published it (the listing's date) or, for attached files, when it was
   * fetched. ISO date. */
  date?: string | null;
}

export interface ProjectListItem {
  id: string;
  slug: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  address: string | null;
  geomPrecision: string | null;
  hasLocation: boolean;
  eventDate: string | null; // ISO date of the latest event
  eventTitle: string | null;
  sourceUrl: string | null;
  documents: ProjectDocumentLink[];
  /** Companies and public bodies only, or "persoană fizică". */
  initiator: string | null;
  indicators: ProjectIndicators;
}

/**
 * Every published project of a jurisdiction, with its latest event, newest first. Unlike the
 * GeoJSON, this includes projects without a location, so the list shows everything (PLAN §8).
 * A project the linker merged into another is not listed; its events and documents show on the
 * project it joined (M3.3).
 */
export async function listProjects(
  db: Db,
  slug: string,
  filters: ProjectFilters = {},
  /** Only this project (the project page reuses the list's documents and latest event). */
  onlyId?: string,
): Promise<ProjectListItem[] | null> {
  const [j] = await db
    .select({ id: jurisdiction.id })
    .from(jurisdiction)
    .where(eq(jurisdiction.slug, slug));
  if (!j) return null;
  const rows = await db.execute<{
    id: string;
    slug: string;
    title: string;
    kind: ProjectKind;
    status: ProjectStatus;
    address: string | null;
    geom_precision: string | null;
    has_location: boolean;
    event_date: string | null;
    event_title: string | null;
    details: { source_url?: string } | null;
    documents: ProjectDocumentLink[] | null;
    initiator: string | null;
    indicators: ProjectIndicators | null;
  }>(sql`
    select p.id, p.slug, p.title, p.kind, p.status, p.address_text as address,
           p.initiator, p.indicators,
           p.geom_precision, p.geom is not null as has_location,
           e.event_date::text as event_date, e.title as event_title, e.details,
           d.documents
    from project p
    cross join lateral (
      select array_agg(c.id) as ids from project c where c.id = p.id or c.merged_into_id = p.id
    ) fam
    left join lateral (
      select event_date, title, details from project_event
      where project_id = any(fam.ids) and review_state in ('auto_published', 'approved')
      order by event_date desc, created_at desc limit 1
    ) e on true
    -- Agenda and status-change events carry no files: documents come from the events that list
    -- them (the source listings), once per URL.
    left join lateral (
      select jsonb_agg(x.doc) as documents from (
        select distinct on (doc->>'url') doc || jsonb_build_object('date', ev.event_date) as doc
        from project_event ev, jsonb_array_elements(ev.details->'documents') doc
        where ev.project_id = any(fam.ids)
          and ev.review_state in ('auto_published', 'approved')
          and jsonb_typeof(ev.details->'documents') = 'array'
        order by doc->>'url', ev.event_date
      ) x
    ) d on true
    where p.jurisdiction_id = ${j.id}
      and p.review_state in ('auto_published', 'approved')
      and p.merged_into_id is null
      ${onlyId ? sql`and p.id = ${onlyId}` : sql``}
      ${sql.join(filterConditions(filters).map((c) => sql` and ${c}`))}
    order by e.event_date desc nulls last, p.title`);
  // Files the linker attached (e.g. from the urbanism page) that the listing doesn't name.
  const attached = await db.execute<{
    root: string;
    url: string;
    doc_type: DocumentRole;
    size_bytes: number | null;
    date: string | null;
  }>(sql`
    select coalesce(c.merged_into_id, c.id) as root, f.url, d.doc_type, d.size_bytes,
           f.fetched_at::date::text as date
    from project_document pd
    join project c on c.id = pd.project_id
    join raw_document d on d.id = pd.raw_document_id
    join lateral (
      select url, fetched_at from "fetch" where raw_document_id = d.id
      order by fetched_at desc nulls last limit 1
    ) f on true
    where c.jurisdiction_id = ${j.id} and d.doc_type <> 'registru_opinii'
      ${onlyId ? sql`and coalesce(c.merged_into_id, c.id) = ${onlyId}` : sql``}`);
  const extra = new Map<string, ProjectDocumentLink[]>();
  for (const a of attached) {
    const list = extra.get(a.root) ?? [];
    list.push({
      label: null,
      url: a.url,
      size_bytes: a.size_bytes,
      role: a.doc_type,
      date: a.date,
    });
    extra.set(a.root, list);
  }
  // Document types from the classifier, by URL (a file is fetched once, its type stored once).
  const urls = [...new Set(rows.flatMap((r) => (r.documents ?? []).map((d) => d.url)))];
  const roles = new Map<string, DocumentRole>();
  if (urls.length > 0) {
    const typed = await db.execute<{ url: string; doc_type: DocumentRole }>(sql`
      select distinct on (f.url) f.url, d.doc_type
      from "fetch" f join raw_document d on d.id = f.raw_document_id
      where f.url in ${urls} and d.doc_type is not null
        and d.doc_type <> 'registru_opinii'
      order by f.url, f.fetched_at desc nulls last`);
    for (const t of typed) roles.set(t.url, t.doc_type);
  }
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    status: r.status,
    address: r.address,
    geomPrecision: r.geom_precision,
    hasLocation: r.has_location,
    eventDate: r.event_date,
    eventTitle: r.event_title,
    sourceUrl: r.details?.source_url ?? null,
    documents: withAttached(
      (r.documents ?? []).map((d) => ({ ...d, role: roles.get(d.url) ?? d.role ?? null })),
      extra.get(r.id) ?? [],
    ),
    initiator: r.initiator,
    indicators: r.indicators ?? {},
  }));
}

/** Listing documents in the city's order ("01. …", "02. …"), then attached files not listed. */
function withAttached(
  listed: ProjectDocumentLink[],
  attached: ProjectDocumentLink[],
): ProjectDocumentLink[] {
  const sorted = [...listed].sort((a, b) =>
    (a.label ?? "").localeCompare(b.label ?? "", "ro", { numeric: true }),
  );
  const seen = new Set(sorted.map((d) => d.url));
  return [...sorted, ...attached.filter((d) => !seen.has(d.url) && seen.add(d.url))];
}

export interface ProjectEventItem {
  date: string; // ISO date
  type: EventType;
  title: string;
  /** The page the event was read from (a listing or agenda), when known. */
  sourceUrl: string | null;
}

export interface ConsultationItem {
  opensOn: string | null;
  closesOn: string | null;
  submitEmail: string | null;
  submitAddress: string | null;
  submitInstructions: string | null;
  publicMeetingAt: string | null; // ISO timestamp
  publicMeetingPlace: string | null;
  /** The notice the values were read from, and its page. */
  sourceUrl: string | null;
  page: number | null;
}

export interface NearbyProject {
  slug: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  distanceM: number;
}

export interface ProjectDetail extends ProjectListItem {
  designer: string | null;
  summaryRo: string | null;
  summaryEn: string | null;
  lon: number | null;
  lat: number | null;
  firstSeenAt: string;
  /** When the documents behind the page were last fetched from the city (or the project last
   * changed, if later). */
  lastCheckedAt: string;
  events: ProjectEventItem[];
  consultations: ConsultationItem[];
  nearby: NearbyProject[];
}

export type ProjectLookup =
  { found: true; project: ProjectDetail } | { found: false; redirectTo: string | null };

/** Within this distance, other projects are listed as nearby (PLAN §8). */
export const NEARBY_METRES = 500;

/**
 * One published project with everything its page shows. A slug of a project that was merged
 * into another answers `redirectTo` with the project it joined (M3.3), so old links keep working.
 */
export async function getProject(db: Db, city: string, slug: string): Promise<ProjectLookup> {
  const [p] = await db.execute<{
    id: string;
    merged_slug: string | null;
    published: boolean;
    designer: string | null;
    summary_ro: string | null;
    summary_en: string | null;
    lon: number | null;
    lat: number | null;
    first_seen_at: string;
    updated_at: string;
  }>(sql`
    select p.id, m.slug as merged_slug,
           p.review_state in ('auto_published', 'approved') as published,
           p.designer, p.summary_ro, p.summary_en,
           ST_X(ST_PointOnSurface(p.geom)) as lon, ST_Y(ST_PointOnSurface(p.geom)) as lat,
           p.first_seen_at::text, p.updated_at::text
    from project p
    join jurisdiction j on j.id = p.jurisdiction_id and j.slug = ${city}
    left join project m on m.id = p.merged_into_id
    where p.slug = ${slug}`);
  if (!p || !p.published) return { found: false, redirectTo: null };
  if (p.merged_slug) return { found: false, redirectTo: p.merged_slug };
  const item = (await listProjects(db, city, {}, p.id))?.[0];
  if (!item) return { found: false, redirectTo: null };

  const family = sql`(select c.id from project c where c.id = ${p.id} or c.merged_into_id = ${p.id})`;
  const [events, consultations, nearby, checked] = await Promise.all([
    db.execute<{ date: string; type: EventType; title: string; source_url: string | null }>(sql`
      select event_date::text as date, event_type as type, title,
             details->>'source_url' as source_url
      from project_event
      where project_id in ${family} and review_state in ('auto_published', 'approved')
      order by event_date, created_at`),
    db.execute<{
      opens_on: string | null;
      closes_on: string | null;
      submit_email: string | null;
      submit_address: string | null;
      submit_instructions: string | null;
      public_meeting_at: string | null;
      public_meeting_place: string | null;
      source_url: string | null;
      page: number | null;
    }>(sql`
      select co.opens_on::text, co.closes_on::text, co.submit_email, co.submit_address,
             co.submit_instructions, to_json(co.public_meeting_at) #>> '{}' as public_meeting_at,
             co.public_meeting_place, co.page,
             (select f.url from "fetch" f where f.raw_document_id = co.raw_document_id
              order by f.fetched_at desc nulls last limit 1) as source_url
      from consultation co
      where co.project_id in ${family}
      order by co.closes_on desc nulls last, co.opens_on desc nulls last`),
    db.execute<{
      slug: string;
      title: string;
      kind: ProjectKind;
      status: ProjectStatus;
      distance_m: number;
    }>(sql`
      select o.slug, o.title, o.kind, o.status,
             round(ST_Distance(o.geom::geography, p.geom::geography))::int as distance_m
      from project p join project o on o.jurisdiction_id = p.jurisdiction_id and o.id <> p.id
      where p.id = ${p.id} and p.geom is not null and o.geom is not null
        and o.merged_into_id is null and o.review_state in ('auto_published', 'approved')
        and ST_DWithin(o.geom::geography, p.geom::geography, ${NEARBY_METRES})
      order by distance_m, o.title limit 6`),
    db.execute<{ at: string | null }>(sql`
      select max(f.fetched_at)::text as at
      from project_document pd join "fetch" f on f.raw_document_id = pd.raw_document_id
      where pd.project_id in ${family}`),
  ]);
  const fetched = checked[0]?.at;
  return {
    found: true,
    project: {
      ...item,
      designer: p.designer,
      summaryRo: p.summary_ro,
      summaryEn: p.summary_en,
      lon: p.lon,
      lat: p.lat,
      firstSeenAt: p.first_seen_at,
      lastCheckedAt: fetched && new Date(fetched) > new Date(p.updated_at) ? fetched : p.updated_at,
      events: events.map((e) => ({
        date: e.date,
        type: e.type,
        title: e.title,
        sourceUrl: e.source_url,
      })),
      consultations: consultations.map((c) => ({
        opensOn: c.opens_on,
        closesOn: c.closes_on,
        submitEmail: c.submit_email,
        submitAddress: c.submit_address,
        submitInstructions: c.submit_instructions,
        publicMeetingAt: c.public_meeting_at,
        publicMeetingPlace: c.public_meeting_place,
        sourceUrl: c.source_url,
        page: c.page,
      })),
      nearby: nearby.map((n) => ({
        slug: n.slug,
        title: n.title,
        kind: n.kind,
        status: n.status,
        distanceM: n.distance_m,
      })),
    },
  };
}
