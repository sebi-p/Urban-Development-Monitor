/**
 * Production page checks (M5.4, ADR 0021), shared by the watchdog route and `scripts/smoke.ts`
 * (live-smoke.yml). Plain fetch and relative imports only, so Node runs it without a build.
 */

export interface PageCheck {
  path: string;
  status: number | null;
  /** Empty when the page is fine. */
  problem: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface Expect {
  path: string;
  /** Text the body must contain. */
  contains?: string[];
  /** The most bytes the body may have (M5.7: the map page stays light). */
  maxBytes?: number;
}

/** The map page renders 30 cards whatever the city's size: about 160 KB before compression. */
export const MAP_PAGE_MAX_BYTES = 400_000;

const TIMEOUT_MS = 20_000;

async function check(base: string, e: Expect, f: Fetch, headers: HeadersInit): Promise<PageCheck> {
  try {
    const res = await f(new URL(e.path, base).toString(), {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    // A protected deployment answers with Vercel's login page (200) on another host.
    const host = res.url ? new URL(res.url).host : new URL(base).host;
    if (host !== new URL(base).host)
      return { path: e.path, status: res.status, problem: `redirected to ${host}` };
    if (res.status !== 200)
      return { path: e.path, status: res.status, problem: `HTTP ${res.status}` };
    const missing = (e.contains ?? []).find((c) => !body.includes(c));
    const bytes = new TextEncoder().encode(body).length;
    return {
      path: e.path,
      status: res.status,
      problem: missing
        ? `the page doesn't contain ${JSON.stringify(missing)}`
        : e.maxBytes && bytes > e.maxBytes
          ? `the page has ${bytes} bytes, over its budget of ${e.maxBytes}`
          : "",
    };
  } catch (err) {
    return {
      path: e.path,
      status: null,
      problem: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The home, method and about pages, and for each city its map (under its size budget), the map's
 * index, archive, feed, GeoJSON API and one project page (the first one the API lists). The API
 * must list at least one project.
 */
export async function smokeCheck(
  base: string,
  cities: string[],
  opts: { fetch?: Fetch; headers?: HeadersInit } = {},
): Promise<PageCheck[]> {
  const f = opts.fetch ?? fetch;
  const headers = opts.headers ?? {};
  const pages: Expect[] = [
    { path: "/", contains: ["<main"] },
    { path: "/metodologie", contains: ["<h1"] },
    { path: "/despre", contains: ["<h1"] },
  ];
  for (const city of cities) {
    pages.push(
      { path: `/${city}`, contains: ["<main"], maxBytes: MAP_PAGE_MAX_BYTES },
      { path: `/api/${city}/map.json`, contains: ['"entries"'] },
      { path: `/${city}/arhiva`, contains: ["<h1"] },
      { path: `/${city}/feed.xml`, contains: ["<feed"] },
    );
  }
  const out = await Promise.all(pages.map((p) => check(base, p, f, headers)));
  for (const city of cities) {
    const path = `/api/${city}/projects.geojson`;
    const api = await check(base, { path, contains: ['"FeatureCollection"'] }, f, headers);
    out.push(api);
    if (api.problem) continue;
    const res = await f(new URL(path, base).toString(), {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const geo = (await res.json()) as { features?: { properties?: { slug?: string } }[] };
    const slug = geo.features?.[0]?.properties?.slug;
    if (!slug) {
      api.problem = "the API lists no projects";
      continue;
    }
    out.push(
      await check(base, { path: `/${city}/proiecte/${slug}`, contains: ["<h1"] }, f, headers),
    );
  }
  return out;
}

/** The failed checks as one alert text, or "" when every page is fine. */
export function smokeReport(base: string, checks: PageCheck[]): string {
  const bad = checks.filter((c) => c.problem);
  if (!bad.length) return "";
  return [
    `${bad.length} of ${checks.length} production checks failed on ${base}:`,
    "",
    ...bad.map((c) => `- \`${c.path}\`: ${c.problem}`),
  ].join("\n");
}
