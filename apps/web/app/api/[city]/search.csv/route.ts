import { SEARCH_EXPORT_MAX, searchProjects } from "@mdu/db";
import { getTranslations } from "next-intl/server";
import { parseArchive, toSearchParams } from "@/lib/archive";
import { csvField } from "@/lib/csv";
import { getDb } from "@/lib/db";
import { projectPath } from "@/lib/project";

export const dynamic = "force-dynamic";

const BOM = String.fromCharCode(0xfeff); // so Excel reads the file as UTF-8

/** GET /api/{city}/search.csv?…: every archive result for the same query (M4.3). UTF-8 with a
 * byte-order mark, so Excel shows ă, ș and ț. */
export async function GET(request: Request, { params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const a = parseArchive(new URL(request.url).searchParams);
  const result = await searchProjects(getDb(), city, {
    ...toSearchParams(a),
    page: 1,
    pageSize: SEARCH_EXPORT_MAX,
  });
  if (!result) return Response.json({ error: "unknown city" }, { status: 404 });
  const t = await getTranslations("Archive");
  const kind = await getTranslations("Kind");
  const status = await getTranslations("Status");
  const origin = new URL(request.url).origin;
  const header = [
    "csvTitle",
    "csvKind",
    "csvStatus",
    "csvAddress",
    "csvNeighbourhood",
    "csvInitiator",
    "csvDate",
    "csvSummary",
    "csvUrl",
  ] as const;
  const lines = [
    header.map((h) => csvField(t(h))).join(","),
    ...result.hits.map((h) =>
      [
        h.title,
        kind(h.kind),
        status(h.status),
        h.address,
        h.neighbourhood,
        h.initiator,
        h.eventDate,
        h.summary,
        `${origin}${projectPath(city, h.slug)}`,
      ]
        .map(csvField)
        .join(","),
    ),
  ];
  return new Response(`${BOM}${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="arhiva-${city}.csv"`,
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
