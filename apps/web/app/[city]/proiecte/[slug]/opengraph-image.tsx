import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getTranslations } from "next-intl/server";
import { ImageResponse } from "next/og";
import { loadProject } from "@/lib/project";
import { GROUP_COLOUR, GROUP_TEXT, STATUS_GROUP } from "@/lib/status";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;
export const alt = "Monitor Dezvoltare Urbană";

// Inter from @fontsource (woff; ImageResponse doesn't read woff2): latin plus latin-ext for
// ș, ț, ă, â, î, copied at build time (scripts/copy-assets.mjs) and traced into the
// deployment (outputFileTracingIncludes in next.config.ts).
const FONTS = join(process.cwd(), "assets/og-fonts");

/** The fonts, or none (next/og's built-in font) if they can't be read: a preview in a plainer
 * font beats no preview. */
async function fonts() {
  try {
    return await interFonts();
  } catch (error) {
    console.error("opengraph-image: Inter not found, using the built-in font", error);
    return undefined;
  }
}

async function interFonts() {
  const load = (subset: string, weight: 400 | 700) =>
    readFile(join(FONTS, `inter-${subset}-${weight}-normal.woff`)).then((data) => ({
      // A family per subset, so a bold "ă" comes from the bold latin-ext file.
      name: subset === "latin" ? "Inter" : "Inter Ext",
      data,
      weight,
      style: "normal" as const,
    }));
  return Promise.all([
    load("latin", 400),
    load("latin-ext", 400),
    load("latin", 700),
    load("latin-ext", 700),
  ]);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

export default async function Image({
  params,
}: {
  params: Promise<{ city: string; slug: string }>;
}) {
  const { city, slug } = await params;
  const { jurisdiction, lookup } = await loadProject(city, slug);
  const t = await getTranslations("Project");
  const status = await getTranslations("Status");
  const kind = await getTranslations("Kind");
  const p = lookup.found ? lookup.project : null;
  const group = p ? STATUS_GROUP[p.status] : "closed";
  const loaded = await fonts();
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "56px 64px",
        background: "#f8fafc",
        fontFamily: "Inter",
        color: "#0f172a",
        borderTop: "16px solid #0f766e",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: "#475569" }}>
        {t("ogSite", { city: jurisdiction?.name ?? city })}
      </div>
      {p && (
        <div style={{ display: "flex", marginTop: 36 }}>
          <div
            style={{
              display: "flex",
              fontSize: 26,
              fontWeight: 700,
              color: GROUP_TEXT[group],
              background: `${GROUP_COLOUR[group]}1f`,
              borderRadius: 999,
              padding: "6px 22px",
            }}
          >
            {status(p.status)}
          </div>
        </div>
      )}
      <div
        style={{
          display: "flex",
          marginTop: 22,
          fontSize: 52,
          fontWeight: 700,
          lineHeight: 1.12,
          letterSpacing: "-0.02em",
        }}
      >
        {clip(p?.title ?? slug, 110)}
      </div>
      {p?.summaryRo && (
        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 28,
            lineHeight: 1.4,
            color: "#334155",
          }}
        >
          {clip(p.summaryRo, 210)}
        </div>
      )}
      <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "#64748b" }}>
        {p ? clip([kind(p.kind), p.address].filter(Boolean).join(" · "), 90) : ""}
      </div>
    </div>,
    loaded ? { ...size, fonts: loaded } : size,
  );
}
