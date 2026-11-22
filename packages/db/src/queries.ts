/** Read-only queries for the public site (admin writes are in admin.ts, ADR 0012). */
import type { DocumentRole, ProjectIndicators, ProjectKind, ProjectStatus } from "@mdu/shared";
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
}

/** SQL conditions on `project p` shared by the map and the list, so both show the same set. */
function filterConditions(filters: ProjectFilters): SQL[] {
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
        select distinct on (doc->>'url') doc
        from project_event ev, jsonb_array_elements(ev.details->'documents') doc
        where ev.project_id = any(fam.ids)
          and ev.review_state in ('auto_published', 'approved')
          and jsonb_typeof(ev.details->'documents') = 'array'
        order by doc->>'url', ev.event_date desc
      ) x
    ) d on true
    where p.jurisdiction_id = ${j.id}
      and p.review_state in ('auto_published', 'approved')
      and p.merged_into_id is null
      ${sql.join(filterConditions(filters).map((c) => sql` and ${c}`))}
    order by e.event_date desc nulls last, p.title`);
  // Files the linker attached (e.g. from the urbanism page) that the listing doesn't name.
  const attached = await db.execute<{
    root: string;
    url: string;
    doc_type: DocumentRole;
    size_bytes: number | null;
  }>(sql`
    select coalesce(c.merged_into_id, c.id) as root, f.url, d.doc_type, d.size_bytes
    from project_document pd
    join project c on c.id = pd.project_id
    join raw_document d on d.id = pd.raw_document_id
    join lateral (
      select url from "fetch" where raw_document_id = d.id order by fetched_at desc nulls last limit 1
    ) f on true
    where c.jurisdiction_id = ${j.id} and d.doc_type <> 'registru_opinii'`);
  const extra = new Map<string, ProjectDocumentLink[]>();
  for (const a of attached) {
    const list = extra.get(a.root) ?? [];
    list.push({ label: null, url: a.url, size_bytes: a.size_bytes, role: a.doc_type });
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
