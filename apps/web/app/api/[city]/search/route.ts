import { searchProjects } from "@mdu/db";
import { parseArchive, toSearchParams } from "@/lib/archive";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=3600";

/** GET /api/{city}/search?q=&tip=&stare=&an=&initiator=&ordine=&pagina= (PLAN §8): the archive's
 * results, facets and total as JSON. */
export async function GET(request: Request, { params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const a = parseArchive(new URL(request.url).searchParams);
  const result = await searchProjects(getDb(), city, toSearchParams(a));
  if (!result) return Response.json({ error: "unknown city" }, { status: 404 });
  return Response.json(result, { headers: { "Cache-Control": CACHE } });
}
