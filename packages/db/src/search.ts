/**
 * Archive search (PLAN §8 `/{city}/arhiva`, M4.3): full text over title, address, initiator and
 * summary (`project.search`, diacritics folded, Romanian stemming), with facet counts, two sort
 * orders and pages. Read-only, like the rest of the public queries.
 */
import type { ProjectKind, ProjectStatus } from "@mdu/shared";
import { eq, sql, type SQL } from "drizzle-orm";
import type { Db } from "./client.ts";
import { filterConditions, type ProjectFilters } from "./queries.ts";
import { jurisdiction } from "./schema/index.ts";

export interface SearchParams extends ProjectFilters {
  q?: string;
  initiators?: string[];
  sort?: "relevance" | "date";
  page?: number; // 1-based
  pageSize?: number;
}

export interface SearchHit {
  slug: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  address: string | null;
  initiator: string | null;
  summary: string | null;
  eventDate: string | null; // latest event, ISO date
}

export interface FacetValue<T extends string | number> {
  value: T;
  count: number;
}

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  hits: SearchHit[];
  facets: {
    kinds: FacetValue<ProjectKind>[];
    statuses: FacetValue<ProjectStatus>[];
    years: FacetValue<number>[];
    initiators: FacetValue<string>[];
  };
}

export const SEARCH_PAGE_SIZE = 20;
/** The CSV export's ceiling, far above the archive's size; it keeps one request bounded. */
export const SEARCH_EXPORT_MAX = 5000;
const MAX_TERMS = 8;

/**
 * The words of a query as a prefix tsquery ("racadau bloc" -> "racadau:* & bloc:*"): every word
 * must match, each from its beginning. Only letters and digits pass, so the text can never be
 * tsquery syntax. Null when nothing is left to search for.
 */
export function prefixQuery(q: string | undefined): string | null {
  const words = (q ?? "").match(/[\p{L}\p{N}]+/gu)?.slice(0, MAX_TERMS) ?? [];
  return words.length ? words.map((w) => `${w}:*`).join(" & ") : null;
}

type Facet = "kinds" | "statuses" | "years" | "initiators";

export async function searchProjects(
  db: Db,
  city: string,
  params: SearchParams = {},
): Promise<SearchResult | null> {
  const [j] = await db
    .select({ id: jurisdiction.id })
    .from(jurisdiction)
    .where(eq(jurisdiction.slug, city));
  if (!j) return null;
  const pageSize = Math.min(params.pageSize ?? SEARCH_PAGE_SIZE, SEARCH_EXPORT_MAX);
  const page = Math.max(1, params.page ?? 1);
  const tsText = prefixQuery(params.q);
  // Stop words alone ("de", "la") give an empty tsquery, which matches nothing: same as Postgres.
  const tsq = tsText ? sql`to_tsquery('romanian', unaccent_immutable(${tsText}))` : null;

  /** Conditions on `project p`, leaving out one facet's own selection (disjunctive counts). */
  const where = (except?: Facet): SQL => {
    const f: ProjectFilters = { ...params };
    if (except === "kinds") f.kinds = [];
    if (except === "statuses") f.statuses = [];
    if (except === "years") f.yearFrom = f.yearTo = undefined;
    const parts = [
      sql`p.jurisdiction_id = ${j.id}`,
      sql`p.review_state in ('auto_published', 'approved')`,
      sql`p.merged_into_id is null`,
      ...filterConditions(f),
    ];
    if (tsq) parts.push(sql`p.search @@ ${tsq}`);
    if (except !== "initiators" && params.initiators?.length) {
      parts.push(sql`p.initiator in ${params.initiators}`);
    }
    return sql.join(parts, sql` and `);
  };

  const latest = sql`(select max(ev.event_date) from project_event ev
    where ev.project_id in (select c.id from project c where c.id = p.id or c.merged_into_id = p.id)
      and ev.review_state in ('auto_published', 'approved'))`;
  const order =
    params.sort === "date" || !tsq
      ? sql`event_date desc nulls last, p.title`
      : sql`ts_rank_cd(p.search, ${tsq}) desc, event_date desc nulls last, p.title`;

  const [hits, kinds, statuses, years, initiators] = await Promise.all([
    db.execute<{
      slug: string;
      title: string;
      kind: ProjectKind;
      status: ProjectStatus;
      address: string | null;
      initiator: string | null;
      summary: string | null;
      event_date: string | null;
      total: number;
    }>(sql`
      select p.slug, p.title, p.kind, p.status, p.address_text as address, p.initiator,
             p.summary_ro as summary, ${latest}::text as event_date,
             count(*) over ()::int as total
      from project p
      where ${where()}
      order by ${order}
      limit ${pageSize} offset ${(page - 1) * pageSize}`),
    db.execute<{ value: ProjectKind; count: number }>(sql`
      select p.kind as value, count(*)::int as count from project p
      where ${where("kinds")} group by 1 order by 2 desc, 1`),
    db.execute<{ value: ProjectStatus; count: number }>(sql`
      select p.status as value, count(*)::int as count from project p
      where ${where("statuses")} group by 1 order by 2 desc, 1`),
    db.execute<{ value: number; count: number }>(sql`
      select y.value, count(distinct p.id)::int as count
      from project p
      cross join lateral (
        select distinct extract(year from ev.event_date)::int as value from project_event ev
        where ev.project_id in (select c.id from project c where c.id = p.id or c.merged_into_id = p.id)
          and ev.review_state in ('auto_published', 'approved')
      ) y
      where ${where("years")} group by 1 order by 1 desc`),
    db.execute<{ value: string; count: number }>(sql`
      select p.initiator as value, count(*)::int as count from project p
      where ${where("initiators")} and p.initiator is not null
      group by 1 order by 2 desc, 1 limit 12`),
  ]);
  // A page past the end still reports the total (from a count without the offset).
  let total = hits[0]?.total ?? 0;
  if (!hits.length && page > 1) {
    const [c] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from project p where ${where()}`,
    );
    total = c?.n ?? 0;
  }
  return {
    total,
    page,
    pageSize,
    hits: hits.map((h) => ({
      slug: h.slug,
      title: h.title,
      kind: h.kind,
      status: h.status,
      address: h.address,
      initiator: h.initiator,
      summary: h.summary,
      eventDate: h.event_date,
    })),
    facets: {
      kinds: [...kinds],
      statuses: [...statuses],
      years: [...years],
      initiators: [...initiators],
    },
  };
}
