import type { ProjectListItem } from "@mdu/db";
import type { ProjectIndicators } from "@mdu/shared";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Building2, ExternalLink, FileText, LocateFixed, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

/** Display order of extracted indicators (PLAN §6). */
export const INDICATOR_ORDER = [
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
    <div className="indicators mt-3 space-y-2" title={t("auto")}>
      {shown.length > 0 && (
        <p className="flex flex-wrap gap-1.5">
          {shown.map((s) => (
            <Badge key={s.key} className="rounded-md bg-slate-100 font-normal text-slate-700">
              {s.url ? (
                <a
                  href={`${s.url}#page=${s.page}`}
                  rel="noopener noreferrer"
                  target="_blank"
                  aria-label={t("pageLink", { label: s.label, page: s.page })}
                  className="text-slate-800"
                >
                  {s.label}
                </a>
              ) : (
                s.label
              )}
            </Badge>
          ))}
        </p>
      )}
      {p.initiator && (
        <p className="initiator text-sm text-slate-600">{t("initiator", { value: p.initiator })}</p>
      )}
    </div>
  );
}

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

/** Every project is reachable as a plain list, including those not on the map (PLAN §8). */
export function ProjectList({ city, projects }: { city: string; projects: ProjectListItem[] }) {
  const t = useTranslations("City");
  const kind = useTranslations("Kind");
  const docType = useTranslations("DocType");
  const format = useFormatter();

  if (projects.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-600">{t("empty")}</p>
    );
  }

  return (
    <ul className="project-list space-y-3">
      {projects.map((p) => (
        <li
          key={p.id}
          id={`p-${p.slug}`}
          data-slug={p.slug}
          data-located={p.hasLocation ? "true" : undefined}
          className="scroll-mt-4 rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)] target:ring-2 target:ring-accent-600"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={p.status} />
            <span className="meta text-xs text-slate-500">
              {kind(p.kind)}
              {p.eventDate
                ? ` · ${format.dateTime(new Date(`${p.eventDate}T12:00:00`), { dateStyle: "medium" })}`
                : ""}
            </span>
          </div>
          <h3 className="mt-2 text-base leading-snug font-semibold">
            <Link href={`/${city}/proiecte/${p.slug}`} className="text-slate-900">
              {p.title}
            </Link>
          </h3>
          <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <span>
              {p.address ?? t("noAddress")}
              {" · "}
              <span className="text-slate-500">
                {p.hasLocation ? <LocationNote p={p} /> : t("notOnMap")}
              </span>
            </span>
          </p>
          <Indicators p={p} />
          {p.hasLocation && (
            <button
              type="button"
              data-show-on-map={p.slug}
              className="show-on-map mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              <LocateFixed aria-hidden className="size-4 text-accent-700" />
              {t("showOnMap")}
            </button>
          )}
          {(p.documents.length > 0 || p.sourceUrl) && (
            <details className="docs group mt-3 border-t border-slate-100 pt-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-700">
                <FileText aria-hidden className="size-4 text-slate-400" />
                {t("documents", { count: p.documents.length })}
              </summary>
              <ul className="mt-1 space-y-1 text-sm">
                {p.documents.map((d) => (
                  <li key={d.url} className="flex flex-wrap items-baseline gap-x-2">
                    <a href={d.url} rel="noopener noreferrer" target="_blank">
                      {d.label ?? docType(d.role ?? "other")}
                    </a>
                    {d.label && d.role && d.role !== "other" && (
                      <span className="doc-type text-xs text-slate-500">· {docType(d.role)}</span>
                    )}
                  </li>
                ))}
              </ul>
              {p.sourceUrl && (
                <p className="source mt-2 flex items-center gap-1 text-xs text-slate-500">
                  <Building2 aria-hidden className="size-3.5" />
                  {t("source")}{" "}
                  <a
                    href={p.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="inline-flex items-center gap-0.5"
                  >
                    {new URL(p.sourceUrl).hostname}
                    <ExternalLink aria-hidden className="size-3" />
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
