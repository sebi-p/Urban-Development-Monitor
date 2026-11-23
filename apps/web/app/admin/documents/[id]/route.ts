import { auditDocument } from "@mdu/db";
import { adminLogin } from "@/auth";
import { getDb } from "@/lib/db";
import { r2Get } from "@/lib/r2";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Never HTML or other active content: a page from the city's site served from our origin could
// run its scripts with the reviewer's session.
const SAFE = new Set(["application/pdf", "image/png", "image/jpeg"]);

/** GET /admin/documents/{id}: our mirrored copy of a document, for the audit viewer. The city's
 * site forbids showing its files inside other sites, so the viewer frames this one instead.
 * Signed-in reviewers only; never cached by shared caches. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adminLogin())) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const doc = await auditDocument(getDb(), id);
  const mime = doc?.mime.split(";")[0]!.trim();
  if (!doc || !mime || !SAFE.has(mime)) return new Response("Not found", { status: 404 });
  const object = await r2Get(doc.r2Key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
