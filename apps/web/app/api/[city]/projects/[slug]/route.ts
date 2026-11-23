import { getProject } from "@mdu/db";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=3600";

/** GET /api/{city}/projects/{slug}: what the project page shows, as JSON (PLAN §8). A merged
 * project's slug answers 301 with the project it joined. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ city: string; slug: string }> },
) {
  const { city, slug } = await params;
  const lookup = await getProject(getDb(), city, slug);
  if (!lookup.found) {
    if (lookup.redirectTo) {
      const to = new URL(`/api/${city}/projects/${lookup.redirectTo}`, request.url);
      return Response.redirect(to, 301);
    }
    return Response.json({ error: "unknown project" }, { status: 404 });
  }
  return Response.json(lookup.project, { headers: { "Cache-Control": CACHE } });
}
