/**
 * The map page's index (M5.7, ADR 0023): one compact entry per published project, with what the
 * cards show and what the filters need. The browser loads it once and filters it locally; the
 * server filters the same index for the first view and for browsers without JavaScript.
 */
import {
  INDICATOR_ORDER,
  type CardFigure,
  type ProjectIndicators,
  type ProjectKind,
  type ProjectStatus,
} from "@mdu/shared";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import type { JurisdictionSummary } from "./queries.ts";
import { getJurisdiction } from "./queries.ts";
import { jurisdiction } from "./schema/index.ts";

export interface MapEntry {
  slug: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  address: string | null;
  geomPrecision: string | null;
  /** The location as [lon, lat] (a point on the shape for a non-point geometry), or null. */
  at: [number, number] | null;
  /** The latest published event (ISO date). */
  date: string | null;
  /** Years with a published event, for the year filter. */
  years: number[];
  neighbourhood: string | null;
  /** Consultation windows [opens, closes] (ISO dates), for "open now". */
  consultations: [string | null, string | null][];
  /** Companies and public bodies only, or "persoană fizică". */
  initiator: string | null;
  /** The card's figures, values only (the project page links them to their source page). */
  figures: Partial<Record<CardFigure, string | number>>;
}

export interface MapIndex {
  jurisdiction: JurisdictionSummary;
  entries: MapEntry[];
  /** Every neighbourhood of the city, by name. */
  neighbourhoods: { slug: string; name: string }[];
}

/** Null when the jurisdiction doesn't exist. Newest first, like the list (listProjects). */
export async function mapIndex(db: Db, city: string): Promise<MapIndex | null> {
  const j = await getJurisdiction(db, city);
  if (!j) return null;
  const [{ id }] = (await db
    .select({ id: jurisdiction.id })
    .from(jurisdiction)
    .where(eq(jurisdiction.slug, city))) as [{ id: number }];
  const [rows, hoods] = await Promise.all([
    db.execute<{
      slug: string;
      title: string;
      kind: ProjectKind;
      status: ProjectStatus;
      address: string | null;
      geom_precision: string | null;
      at: [number, number] | null;
      date: string | null;
      years: number[] | null;
      neighbourhood: string | null;
      consultations: [string | null, string | null][] | null;
      initiator: string | null;
      indicators: ProjectIndicators | null;
    }>(sql`
      select p.slug, p.title, p.kind, p.status, p.address_text as address, p.geom_precision,
             case when p.geom is null then null else json_build_array(
               round(ST_X(ST_PointOnSurface(p.geom))::numeric, 6),
               round(ST_Y(ST_PointOnSurface(p.geom))::numeric, 6)) end as at,
             e.date, e.years, n.slug as neighbourhood, co.consultations,
             p.initiator, p.indicators
      from project p
      cross join lateral (
        select array_agg(c.id) as ids from project c where c.id = p.id or c.merged_into_id = p.id
      ) fam
      left join lateral (
        select max(event_date)::text as date,
               array_agg(distinct extract(year from event_date)::int)
                 filter (where event_date is not null) as years
        from project_event
        where project_id = any(fam.ids) and review_state in ('auto_published', 'approved')
      ) e on true
      left join lateral (
        select json_agg(json_build_array(opens_on::text, closes_on::text)) as consultations
        from consultation where project_id = any(fam.ids)
      ) co on true
      left join neighbourhood n on n.id = p.neighbourhood_id
      where p.jurisdiction_id = ${id}
        and p.review_state in ('auto_published', 'approved')
        and p.merged_into_id is null
      order by e.date desc nulls last, p.title`),
    db.execute<{ slug: string; name: string }>(
      sql`select slug, name from neighbourhood where jurisdiction_id = ${id}`,
    ),
  ]);
  return {
    jurisdiction: j,
    entries: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      kind: r.kind,
      status: r.status,
      address: r.address,
      geomPrecision: r.geom_precision,
      at: r.at ? [Number(r.at[0]), Number(r.at[1])] : null,
      date: r.date,
      years: (r.years ?? []).sort((a, b) => b - a),
      neighbourhood: r.neighbourhood,
      consultations: r.consultations ?? [],
      initiator: r.initiator,
      figures: Object.fromEntries(
        INDICATOR_ORDER.flatMap((k) => {
          const v = r.indicators?.[k]?.value;
          return v === undefined || v === null || v === "" ? [] : [[k, v]];
        }),
      ),
    })),
    neighbourhoods: [...hoods]
      .map((h) => ({ slug: h.slug, name: h.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ro")),
  };
}
