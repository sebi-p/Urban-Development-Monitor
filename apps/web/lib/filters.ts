import type { ProjectFilters } from "@mdu/db";
import { PROJECT_KINDS, PROJECT_STATUSES, type ProjectKind, type ProjectStatus } from "@mdu/shared";

/**
 * Filter state in the URL (PLAN §8), so any view can be shared:
 * `?tip=puz,pud&stare=approved,expired&din=2024&pana=2026&consultare=deschisa`.
 * Unknown values are ignored rather than failing, because these URLs travel in chats.
 */
export interface UrlFilters {
  kinds: ProjectKind[];
  statuses: ProjectStatus[];
  from?: number;
  to?: number;
  open: boolean;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function list<T extends string>(raw: string, allowed: readonly T[]): T[] {
  const set = new Set(raw.split(",").map((s) => s.trim()));
  return allowed.filter((a) => set.has(a));
}

function year(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : undefined;
}

export function parseFilters(params: Params): UrlFilters {
  return {
    kinds: list(get(params, "tip"), PROJECT_KINDS),
    statuses: list(get(params, "stare"), PROJECT_STATUSES),
    from: year(get(params, "din")),
    to: year(get(params, "pana")),
    open: get(params, "consultare") === "deschisa",
  };
}

export function toQuery(f: UrlFilters): string {
  const q = new URLSearchParams();
  if (f.kinds.length) q.set("tip", f.kinds.join(","));
  if (f.statuses.length) q.set("stare", f.statuses.join(","));
  if (f.from) q.set("din", String(f.from));
  if (f.to) q.set("pana", String(f.to));
  if (f.open) q.set("consultare", "deschisa");
  return q.toString();
}

export function toDbFilters(f: UrlFilters): ProjectFilters {
  return {
    kinds: f.kinds,
    statuses: f.statuses,
    yearFrom: f.from,
    yearTo: f.to,
    openConsultation: f.open,
  };
}

export function isFiltered(f: UrlFilters): boolean {
  return toQuery(f) !== "";
}
