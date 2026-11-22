import type { ProjectListItem } from "@mdu/db";
import type { ProjectIndicators } from "@mdu/shared";
import { useFormatter, useTranslations } from "next-intl";
import { STATUS_COLOURS } from "@/lib/status";

/** Display order of extracted indicators (PLAN §6). */
const INDICATOR_ORDER = [
  "height_regime",
  "max_height_m",
  "pot_percent",
  "cut",
  "dwellings",
  "parking_spaces",
  "green_space_percent",
  "site_area_m2",
] as const satisfies readonly (keyof ProjectIndicators)[];

function Indicators({ p }: { p: ProjectListItem }) {
  const t = useTranslations("Indicators");
  const format = useFormatter();
  const shown = INDICATOR_ORDER.flatMap((key) => {
    const v = p.indicators[key];
    if (!v) return [];
    const value =
      typeof v.value === "number"
        ? format.number(v.value, { maximumFractionDigits: 2 })
        : String(v.value);
    const label = t(key, { value });
    return [{ key, label, page: v.page, url: v.source_url }];
  });
  if (shown.length === 0 && !p.initiator) return null;
  return (
    <p className="indicators" title={t("auto")}>
      {shown.map((s, i) => (
        <span key={s.key}>
          {i > 0 && " · "}
          {s.url ? (
            <a
              href={`${s.url}#page=${s.page}`}
              rel="noopener noreferrer"
              target="_blank"
              aria-label={t("pageLink", { label: s.label, page: s.page })}
            >
              {s.label}
            </a>
          ) : (
            s.label
          )}
        </span>
      ))}
      {p.initiator && (
        <span className="initiator">
          {shown.length > 0 && " · "}
          {t("initiator", { value: p.initiator })}
        </span>
      )}
    </p>
  );
}

function LocationNote({ p }: { p: ProjectListItem }) {
  const t = useTranslations("City");
  if (p.geomPrecision === "street") return t("approximateLocation");
  if (p.geomPrecision === "address") return t("addressLocation");
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

/** Every project is reachable as a plain list, including those not on the map (PLAN §8). */
export function ProjectList({ projects }: { projects: ProjectListItem[] }) {
  const t = useTranslations("City");
  const status = useTranslations("Status");
  const kind = useTranslations("Kind");
  const docType = useTranslations("DocType");
  const format = useFormatter();

  if (projects.length === 0) return <p>{t("empty")}</p>;

  return (
    <ul className="project-list">
      {projects.map((p) => (
        <li key={p.id}>
          <span className="dot" style={{ background: STATUS_COLOURS[p.status] }} aria-hidden />
          <strong>{p.title}</strong>
          <span className="meta">
            {kind(p.kind)} · {status(p.status)}
            {p.eventDate
              ? ` · ${format.dateTime(new Date(`${p.eventDate}T12:00:00`), { dateStyle: "medium" })}`
              : ""}
          </span>
          <span className="meta">
            {p.address ?? t("noAddress")}
            {" · "}
            {p.hasLocation ? <LocationNote p={p} /> : t("notOnMap")}
          </span>
          <Indicators p={p} />
          {(p.documents.length > 0 || p.sourceUrl) && (
            <details className="docs">
              <summary>{t("documents", { count: p.documents.length })}</summary>
              <ul>
                {p.documents.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} rel="noopener noreferrer" target="_blank">
                      {d.label ?? docType(d.role ?? "other")}
                    </a>
                    {d.label && d.role && d.role !== "other" && (
                      <span className="doc-type"> · {docType(d.role)}</span>
                    )}
                  </li>
                ))}
              </ul>
              {p.sourceUrl && (
                <p className="source">
                  {t("source")}{" "}
                  <a href={p.sourceUrl} rel="noopener noreferrer" target="_blank">
                    {new URL(p.sourceUrl).hostname}
                  </a>
                </p>
              )}
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
