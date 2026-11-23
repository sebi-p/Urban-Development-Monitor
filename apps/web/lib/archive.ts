import type { SearchParams } from "@mdu/db";
import {
  get,
  getAll,
  parseFilters,
  toDbFilters,
  type Params,
  type UrlFilters,
} from "@/lib/filters";

/**
 * Archive state in the URL (`/{city}/arhiva`): the map's filters plus
 * `?q=racadau&initiator=SC+ALFA+SRL&cartier=astra&an=2024&ordine=data&pagina=2`. The initiator
 * and neighbourhood repeat (names contain commas); `an` picks one year.
 */
export interface ArchiveQuery extends UrlFilters {
  q: string;
  initiators: string[];
  neighbourhoods: string[]; // slugs
  year?: number;
  sort: "relevance" | "date";
  page: number;
}

const MAX_Q = 200;

export function parseArchive(params: Params): ArchiveQuery {
  const filters = parseFilters(params);
  const an = Number(get(params, "an"));
  const year = Number.isInteger(an) && an >= 1990 && an <= 2100 ? an : undefined;
  const page = Number(get(params, "pagina"));
  return {
    ...filters,
    ...(year ? { from: year, to: year } : {}),
    q: get(params, "q").trim().slice(0, MAX_Q),
    initiators: getAll(params, "initiator").filter(Boolean).slice(0, 20),
    neighbourhoods: getAll(params, "cartier")
      .filter((c) => /^[a-z0-9-]{1,80}$/.test(c))
      .slice(0, 30),
    year,
    sort: get(params, "ordine") === "data" ? "date" : "relevance",
    page: Number.isInteger(page) && page > 1 && page < 1000 ? page : 1,
  };
}

/** The query string for a state, with some fields changed (facet and page links). */
export function archiveHref(a: ArchiveQuery, change: Partial<ArchiveQuery> = {}): string {
  const s = { ...a, ...change };
  const q = new URLSearchParams();
  if (s.q) q.set("q", s.q);
  for (const k of s.kinds) q.append("tip", k);
  for (const st of s.statuses) q.append("stare", st);
  if (s.year) q.set("an", String(s.year));
  else {
    if (s.from) q.set("din", String(s.from));
    if (s.to) q.set("pana", String(s.to));
  }
  if (s.open) q.set("consultare", "deschisa");
  for (const i of s.initiators) q.append("initiator", i);
  for (const c of s.neighbourhoods) q.append("cartier", c);
  if (s.sort === "date") q.set("ordine", "data");
  if (s.page > 1) q.set("pagina", String(s.page));
  return q.toString();
}

export function toSearchParams(a: ArchiveQuery): SearchParams {
  return {
    ...toDbFilters(a),
    q: a.q || undefined,
    initiators: a.initiators,
    neighbourhoods: a.neighbourhoods,
    sort: a.q ? a.sort : "date",
    page: a.page,
  };
}
