import { feedResponse } from "@/lib/feed";

export const dynamic = "force-dynamic";

/** GET /en/{city}/feed.xml?cartier=… (rewritten here; lib/feed.ts). */
export async function GET(request: Request, { params }: { params: Promise<{ city: string }> }) {
  return feedResponse(request, (await params).city, "en");
}
