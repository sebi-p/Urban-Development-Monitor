import { projectsGeoJSON, type BBox } from "@mdu/db";
import { PROJECT_KINDS, PROJECT_STATUSES, type ProjectKind, type ProjectStatus } from "@mdu/shared";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=3600";

function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] | "invalid" {
  if (!raw) return [];
  const values = raw.split(",").filter(Boolean);
  return values.every((v) => (allowed as readonly string[]).includes(v))
    ? (values as T[])
    : "invalid";
}

function parseBBox(raw: string | null): BBox | undefined | "invalid" {
  if (!raw) return undefined;
  const n = raw.split(",").map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) return "invalid";
  const [minLon, minLat, maxLon, maxLat] = n as BBox;
  if (minLon >= maxLon || minLat >= maxLat || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90)
    return "invalid";
  return [minLon, minLat, maxLon, maxLat];
}

function parseYear(raw: string | null): number | undefined | "invalid" {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : "invalid";
}

/** GET /api/{city}/projects.geojson?bbox=&kind=&status=&from=&to=&open=1 (PLAN §8). */
export async function GET(request: Request, { params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const q = new URL(request.url).searchParams;
  const bbox = parseBBox(q.get("bbox"));
  const kinds = parseList<ProjectKind>(q.get("kind"), PROJECT_KINDS);
  const statuses = parseList<ProjectStatus>(q.get("status"), PROJECT_STATUSES);
  const yearFrom = parseYear(q.get("from"));
  const yearTo = parseYear(q.get("to"));
  if (
    bbox === "invalid" ||
    kinds === "invalid" ||
    statuses === "invalid" ||
    yearFrom === "invalid" ||
    yearTo === "invalid"
  ) {
    return Response.json({ error: "invalid bbox, kind, status, from or to" }, { status: 400 });
  }

  const fc = await projectsGeoJSON(getDb(), city, {
    bbox,
    kinds,
    statuses,
    yearFrom,
    yearTo,
    openConsultation: q.get("open") === "1",
  });
  if (!fc) return Response.json({ error: "unknown city" }, { status: 404 });

  return Response.json(fc, {
    headers: { "Cache-Control": CACHE, "Content-Type": "application/geo+json; charset=utf-8" },
  });
}
