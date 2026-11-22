"use client";

import type { ProjectKind, ProjectStatus } from "@mdu/shared";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toQuery, type UrlFilters } from "@/lib/filters";

/**
 * A plain GET form: it works without JavaScript (the Apply button), and with JavaScript every
 * change updates the URL at once, so the view can be shared (PLAN §8).
 */
export function FilterBar({
  filters,
  kinds,
  statuses,
  years,
  count,
}: {
  filters: UrlFilters;
  kinds: ProjectKind[];
  statuses: ProjectStatus[];
  years: number[];
  count: number;
}) {
  const t = useTranslations("Filters");
  const kind = useTranslations("Kind");
  const status = useTranslations("Status");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const apply = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const next: UrlFilters = {
      kinds: data.getAll("tip").map(String) as ProjectKind[],
      statuses: data.getAll("stare").map(String) as ProjectStatus[],
      from: Number(data.get("din")) || undefined,
      to: Number(data.get("pana")) || undefined,
      open: data.get("consultare") === "deschisa",
    };
    const q = toQuery(next);
    startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };

  return (
    <form
      className="filters"
      method="get"
      aria-label={t("heading")}
      aria-busy={pending}
      onChange={(e) => apply(e.currentTarget)}
      onSubmit={(e) => {
        e.preventDefault();
        apply(e.currentTarget);
      }}
    >
      <fieldset>
        <legend>{t("kind")}</legend>
        {kinds.map((k) => (
          <label key={k}>
            <input
              type="checkbox"
              name="tip"
              value={k}
              defaultChecked={filters.kinds.includes(k)}
            />{" "}
            {kind(k)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t("status")}</legend>
        {statuses.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              name="stare"
              value={s}
              defaultChecked={filters.statuses.includes(s)}
            />{" "}
            {status(s)}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{t("years")}</legend>
        <label>
          {t("from")}{" "}
          <select name="din" defaultValue={filters.from ?? ""}>
            <option value="">{t("any")}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          {t("to")}{" "}
          <select name="pana" defaultValue={filters.to ?? ""}>
            <option value="">{t("any")}</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <label className="open">
        <input type="checkbox" name="consultare" value="deschisa" defaultChecked={filters.open} />{" "}
        {t("open")}
      </label>
      <p className="filter-actions">
        <output aria-live="polite">{t("showing", { count })}</output>{" "}
        <button type="submit">{t("apply")}</button> <a href={pathname}>{t("reset")}</a>
      </p>
    </form>
  );
}
