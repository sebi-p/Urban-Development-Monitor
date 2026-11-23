import { neighbourhoodsGeoJSON } from "@mdu/db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/{city}/neighbourhoods.geojson (PLAN §8): the neighbourhood areas. `boundarySource`
 * "osm" marks an approximate area drawn around OpenStreetMap's point (ODbL). */
export async function GET(_: Request, { params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const data = await neighbourhoodsGeoJSON(getDb(), city);
  if (!data) return Response.json({ error: "unknown city" }, { status: 404 });
  return Response.json(data, {
    headers: {
      "Content-Type": "application/geo+json",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
