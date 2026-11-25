import type { MapEntry, ProjectCollection } from "@mdu/db";
import { PROJECT_KINDS, PROJECT_STATUSES } from "@mdu/shared";
import type { UrlFilters } from "@/lib/filters";

/**
 * The map page's filters over the index (M5.7, ADR 0023). The same code runs on the server (the
 * first view, and browsers without JavaScript) and in the browser (every change, no request),
 * so both always show the same set. It mirrors `filterConditions` in packages/db.
 */

/** Cards rendered at first; more load as the reader scrolls. */
export const PAGE = 30;
/** The most cards a `?afisate=` link asks the server for. */
export const MAX_SHOWN = 2_000;

/** Today in Bucharest as YYYY-MM-DD (consultations open "now" by the city's calendar). */
export function bucharestToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest" }).format(now);
}

/** Even-odd rule: a self-crossing outline counts the parts it encloses, like ST_MakeValid. */
export function insidePolygon([x, y]: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function matches(e: MapEntry, f: UrlFilters, today: string): boolean {
  if (f.kinds.length && !f.kinds.includes(e.kind)) return false;
  if (f.statuses.length && !f.statuses.includes(e.status)) return false;
  if (f.from !== undefined || f.to !== undefined) {
    const from = f.from ?? 1900;
    const to = f.to ?? 2999;
    if (!e.years.some((y) => y >= from && y <= to)) return false;
  }
  if (f.neighbourhood && e.neighbourhood !== f.neighbourhood) return false;
  if (f.area && f.area.length >= 3 && !(e.at && insidePolygon(e.at, f.area))) return false;
  if (f.open && !e.consultations.some(([o, c]) => !!o && !!c && o <= today && today <= c))
    return false;
  return true;
}

export function filterEntries(entries: MapEntry[], f: UrlFilters, today: string): MapEntry[] {
  return entries.filter((e) => matches(e, f, today));
}

/** The filter options: only values that occur (newest year first). */
export function filterOptions(entries: MapEntry[]) {
  const kinds = PROJECT_KINDS.filter((k) => entries.some((e) => e.kind === k));
  const statuses = PROJECT_STATUSES.filter((s) => entries.some((e) => e.status === s));
  const years = [...new Set(entries.flatMap((e) => e.years))].sort((a, b) => b - a);
  return { kinds, statuses, years };
}

/** The located entries as the map's pins. */
export function pins(entries: MapEntry[]): ProjectCollection {
  return {
    type: "FeatureCollection",
    features: entries.flatMap((e) =>
      e.at
        ? [
            {
              type: "Feature" as const,
              id: e.slug,
              geometry: { type: "Point", coordinates: e.at },
              properties: {
                slug: e.slug,
                title: e.title,
                kind: e.kind,
                status: e.status,
                address: e.address,
                geomPrecision: e.geomPrecision,
              },
            },
          ]
        : [],
    ),
  };
}

/** `?afisate=60`: how many cards a link without JavaScript asks for (a page at a time). */
export function shownFrom(raw: string): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > PAGE ? Math.min(n, MAX_SHOWN) : PAGE;
}
