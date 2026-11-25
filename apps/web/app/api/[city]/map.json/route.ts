import { cityIndex } from "@/lib/city-index";

export const dynamic = "force-dynamic";

/** GET /api/{city}/map.json: the map page's index (M5.7, ADR 0023), which the browser filters. */
export async function GET(_: Request, { params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const index = await cityIndex(city);
  if (!index) return Response.json({ error: "unknown city" }, { status: 404 });
  return Response.json(index, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" },
  });
}
