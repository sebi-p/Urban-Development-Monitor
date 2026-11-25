import type { ProjectListItem } from "@mdu/db";
import { useTranslations } from "next-intl";

/** How exact the location is; an exact one links to the plan sheet it was read from. */
export function LocationNote({ p }: { p: ProjectListItem }) {
  const t = useTranslations("City");
  if (p.geomPrecision === "street") return t("approximateLocation");
  if (p.geomPrecision === "address") return t("addressLocation");
  if (p.geomPrecision === "manual") return t("manualLocation");
  if (p.geomPrecision !== "parcel") return null;
  const loc = p.indicators.location;
  if (loc?.source_url && loc.page) {
    return (
      <a
        href={`${loc.source_url}#page=${loc.page}`}
        rel="noopener noreferrer"
        target="_blank"
        title={t("locationPage", { page: loc.page })}
      >
        {t("exactLocation")}
      </a>
    );
  }
  return t("exactLocation");
}
