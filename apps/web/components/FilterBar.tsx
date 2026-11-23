"use client";

import type { ProjectKind, ProjectStatus } from "@mdu/shared";
import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useEffect, useSyncExternalStore, useTransition, type ChangeEvent } from "react";
import { setBusy } from "@/lib/busy";
import { toQuery, type UrlFilters } from "@/lib/filters";
import { GROUP_ICON, STATUS_GROUP } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * Filters (PLAN §8) as one GET form, `#filters`: chips in the sheet header and the rest in the
 * sheet body, joined with the `form` attribute. Without JavaScript the Apply button submits it;
 * with JavaScript every change replaces the URL at once, so any view can be shared.
 */
const FORM_ID = "filters";

const noop = () => () => {};

function submit(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
  e.currentTarget.form?.requestSubmit();
}

const chip =
  "relative inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors select-none hover:bg-slate-50 has-[:checked]:border-accent-700 has-[:checked]:bg-accent-700 has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-600";

/** Covers the whole chip, so the chip is the hit area; invisible but focusable and checkable. */
const chipInput =
  "absolute inset-0 size-full cursor-pointer appearance-none rounded-full opacity-0";

export function FilterChips({
  filters,
  kinds,
  statuses,
}: {
  filters: UrlFilters;
  kinds: ProjectKind[];
  statuses: ProjectStatus[];
}) {
  const kind = useTranslations("Kind");
  const status = useTranslations("Status");
  const t = useTranslations("Filters");
  return (
    <div
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
      role="group"
      aria-label={t("heading")}
    >
      {kinds.map((k) => (
        <label key={k} className={chip}>
          <input
            type="checkbox"
            form={FORM_ID}
            name="tip"
            value={k}
            defaultChecked={filters.kinds.includes(k)}
            onChange={submit}
            className={chipInput}
          />
          {kind(k)}
        </label>
      ))}
      <span aria-hidden className="my-1 w-px shrink-0 bg-slate-200" />
      {statuses.map((s) => {
        const Icon = GROUP_ICON[STATUS_GROUP[s]];
        return (
          <label key={s} className={chip}>
            <input
              type="checkbox"
              form={FORM_ID}
              name="stare"
              value={s}
              defaultChecked={filters.statuses.includes(s)}
              onChange={submit}
              className={chipInput}
            />
            <Icon aria-hidden className="size-3.5" />
            {status(s)}
          </label>
        );
      })}
    </div>
  );
}

export function FilterForm({ filters, years }: { filters: UrlFilters; years: number[] }) {
  const t = useTranslations("Filters");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    setBusy(pending);
    return () => setBusy(false);
  }, [pending]);
  // Apply is only needed without JavaScript: true in the browser, false in the server render.
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  const more = filters.from !== undefined || filters.to !== undefined || filters.open;

  return (
    <form
      id={FORM_ID}
      method="get"
      aria-label={t("heading")}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget); // includes the chips (form attribute)
        const q = toQuery({
          kinds: data.getAll("tip").map(String) as ProjectKind[],
          statuses: data.getAll("stare").map(String) as ProjectStatus[],
          from: Number(data.get("din")) || undefined,
          to: Number(data.get("pana")) || undefined,
          open: data.get("consultare") === "deschisa",
        });
        startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
      }}
      className="mb-3 text-sm"
      data-busy-fade
    >
      <details open={more} className="group rounded-xl border border-slate-200 bg-slate-50">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 font-medium text-slate-700">
          <SlidersHorizontal aria-hidden className="size-4" />
          {t("more")}
        </summary>
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-3 py-3">
          <label className="flex items-center gap-2">
            {t("from")}
            <select
              name="din"
              defaultValue={filters.from ?? ""}
              onChange={submit}
              className="min-h-9 rounded-lg border border-slate-300 bg-white px-2"
            >
              <option value="">{t("any")}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            {t("to")}
            <select
              name="pana"
              defaultValue={filters.to ?? ""}
              onChange={submit}
              className="min-h-9 rounded-lg border border-slate-300 bg-white px-2"
            >
              <option value="">{t("any")}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="flex basis-full items-center gap-2">
            <input
              type="checkbox"
              name="consultare"
              value="deschisa"
              defaultChecked={filters.open}
              onChange={submit}
              className="size-4 accent-accent-700"
            />
            {t("open")}
          </label>
        </div>
      </details>
      <p className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          className={cn(
            "rounded-full border border-slate-300 bg-white px-3 py-1 text-sm font-medium",
            hydrated && "sr-only",
          )}
        >
          {t("apply")}
        </button>
        <a href={pathname}>{t("reset")}</a>
      </p>
    </form>
  );
}
