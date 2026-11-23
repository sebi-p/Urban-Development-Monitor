import type { ProjectIndicators } from "@mdu/shared";
import { useFormatter, useTranslations } from "next-intl";
import { INDICATOR_ORDER } from "@/components/ProjectList";

/** Extracted indicators, each linked to the page of the PDF it was read from (PLAN §8). */
export function KeyFigures({ indicators }: { indicators: ProjectIndicators }) {
  const t = useTranslations("Indicators");
  const p = useTranslations("Project");
  const format = useFormatter();
  const shown = INDICATOR_ORDER.flatMap((key) => {
    const v = indicators[key];
    if (!v) return [];
    const value =
      typeof v.value === "number"
        ? format.number(v.value, { maximumFractionDigits: 2 })
        : String(v.value);
    return [{ key, label: t(key, { value }), page: v.page, url: v.source_url }];
  });
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="figures-heading">
      <h2 id="figures-heading" className="text-base font-semibold">
        {p("figuresHeading")}
      </h2>
      <ul className="figures mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((s) => (
          <li
            key={s.key}
            className="flex items-baseline justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
          >
            <span className="text-sm font-semibold text-slate-900">{s.label}</span>
            {s.url ? (
              <a
                href={`${s.url}#page=${s.page}`}
                rel="noopener noreferrer"
                target="_blank"
                className="shrink-0 text-xs"
              >
                {p("pageShort", { page: s.page })}
                {/* The visible text starts the link's name (WCAG 2.5.3); the rest is for screen readers. */}
                <span className="sr-only">: {t("pageLink", { label: s.label })}</span>
              </a>
            ) : (
              <span className="shrink-0 text-xs text-slate-500">
                {p("pageShort", { page: s.page })}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">{t("auto")}</p>
    </section>
  );
}
