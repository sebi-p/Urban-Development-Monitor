import type { MapEntry } from "@mdu/db";
import { INDICATOR_ORDER } from "@mdu/shared";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LocateFixed, MapPin } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";

function Figures({ p }: { p: MapEntry }) {
  const t = useTranslations("Indicators");
  const format = useFormatter();
  const shown = INDICATOR_ORDER.flatMap((key) => {
    const v = p.figures[key];
    if (v === undefined) return [];
    const value =
      typeof v === "number" ? format.number(v, { maximumFractionDigits: 2 }) : String(v);
    return [{ key, label: t(key, { value }) }];
  });
  if (shown.length === 0 && !p.initiator) return null;
  return (
    <div className="indicators mt-3 space-y-2" title={t("auto")}>
      {shown.length > 0 && (
        <p className="flex flex-wrap gap-1.5">
          {shown.map((s) => (
            <Badge key={s.key} className="rounded-md bg-slate-100 font-normal text-slate-700">
              {s.label}
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

const PRECISION = {
  street: "approximateLocation",
  address: "addressLocation",
  manual: "manualLocation",
  parcel: "exactLocation",
} as const;

/**
 * Every project as a compact card, including those not on the map (PLAN §8). The documents,
 * and each figure's source page, are on the project page (M5.7: the list stays light).
 */
export function ProjectList({ city, projects }: { city: string; projects: MapEntry[] }) {
  const t = useTranslations("City");
  const kind = useTranslations("Kind");
  const format = useFormatter();

  if (projects.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-600">{t("empty")}</p>
    );
  }

  return (
    <ul className="project-list space-y-3">
      {projects.map((p) => {
        const precision = PRECISION[p.geomPrecision as keyof typeof PRECISION];
        return (
          <li
            key={p.slug}
            id={`p-${p.slug}`}
            data-slug={p.slug}
            data-located={p.at ? "true" : undefined}
            className="scroll-mt-4 rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)] target:ring-2 target:ring-accent-600"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={p.status} />
              <span className="meta text-xs text-slate-500">
                {kind(p.kind)}
                {p.date
                  ? ` · ${format.dateTime(new Date(`${p.date}T12:00:00`), { dateStyle: "medium" })}`
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
                  {p.at ? (precision ? t(precision) : null) : t("notOnMap")}
                </span>
              </span>
            </p>
            <Figures p={p} />
            {p.at && (
              <button
                type="button"
                data-show-on-map={p.slug}
                className="show-on-map mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                <LocateFixed aria-hidden className="size-4 text-accent-700" />
                {t("showOnMap")}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
