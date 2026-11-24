import type { Area, ProjectFilters } from "@mdu/db";
import { PROJECT_KINDS, PROJECT_STATUSES, type ProjectKind, type ProjectStatus } from "@mdu/shared";

/**
 * Filter state in the URL (PLAN §8), so any view can be shared:
 * `?tip=puz,pud&stare=approved,expired&din=2024&pana=2026&consultare=deschisa&cartier=astra`
 * `&zona=25.6,45.6;25.7,45.6;25.65,45.7` (a drawn area's corners as lon,lat; M5.6).
 * Unknown values are ignored rather than failing, because these URLs travel in chats.
 */
export interface UrlFilters {
  kinds: ProjectKind[];
  statuses: ProjectStatus[];
  from?: number;
  to?: number;
  open: boolean;
  /** Neighbourhood slug (M5.6). */
  neighbourhood?: string;
  area?: Area;
}

/** Corners kept in a URL: enough for a hand-drawn outline, short enough to share. */
export const MAX_AREA_POINTS = 40;

/** `lon,lat;lon,lat;…`, at least three corners; anything else is no area. */
export function parseArea(raw: string): Area | undefined {
  if (!raw) return undefined;
  const points = raw.split(";").map((pair) => pair.split(",").map(Number));
  const ok =
    points.length >= 3 &&
    points.length <= MAX_AREA_POINTS &&
    points.every(
      (p) =>
        p.length === 2 &&
        p.every(Number.isFinite) &&
        Math.abs(p[0]!) <= 180 &&
        Math.abs(p[1]!) <= 90,
    );
  return ok ? (points as Area) : undefined;
}

/** Five decimals: about a metre, plenty for a hand-drawn line. */
export function formatArea(area: Area): string {
  const r = (n: number) => String(Math.round(n * 1e5) / 1e5);
  return area.map(([lon, lat]) => `${r(lon)},${r(lat)}`).join(";");
}

const SLUG = /^[a-z0-9-]{1,80}$/;

export type Params = Record<string, string | string[] | undefined> | URLSearchParams;

export function get(params: Params, key: string): string {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Every value of a key: `tip=puz,pud` (a shared link) or `tip=puz&tip=pud` (a form without
 * JavaScript sends one per checked box). */
export function getAll(params: Params, key: string): string[] {
  const v = params instanceof URLSearchParams ? params.getAll(key) : params[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function list<T extends string>(raw: string[], allowed: readonly T[]): T[] {
  const set = new Set(raw.flatMap((r) => r.split(",")).map((s) => s.trim()));
  return allowed.filter((a) => set.has(a));
}

function year(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : undefined;
}

export function parseFilters(params: Params): UrlFilters {
  return {
    kinds: list(getAll(params, "tip"), PROJECT_KINDS),
    statuses: list(getAll(params, "stare"), PROJECT_STATUSES),
    from: year(get(params, "din")),
    to: year(get(params, "pana")),
    open: get(params, "consultare") === "deschisa",
    neighbourhood: SLUG.test(get(params, "cartier")) ? get(params, "cartier") : undefined,
    area: parseArea(get(params, "zona")),
  };
}

export function toQuery(f: UrlFilters): string {
  const q = new URLSearchParams();
  if (f.kinds.length) q.set("tip", f.kinds.join(","));
  if (f.statuses.length) q.set("stare", f.statuses.join(","));
  if (f.from) q.set("din", String(f.from));
  if (f.to) q.set("pana", String(f.to));
  if (f.open) q.set("consultare", "deschisa");
  if (f.neighbourhood) q.set("cartier", f.neighbourhood);
  if (f.area) q.set("zona", formatArea(f.area));
  // Commas and semicolons are safe in a query string: keep shared links readable.
  return q.toString().replaceAll("%2C", ",").replaceAll("%3B", ";");
}

export function toDbFilters(f: UrlFilters): ProjectFilters {
  return {
    kinds: f.kinds,
    statuses: f.statuses,
    yearFrom: f.from,
    yearTo: f.to,
    openConsultation: f.open,
    neighbourhoods: f.neighbourhood ? [f.neighbourhood] : undefined,
    area: f.area,
  };
}

export function isFiltered(f: UrlFilters): boolean {
  return toQuery(f) !== "";
}
