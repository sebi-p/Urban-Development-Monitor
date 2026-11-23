import type { FacetValue, SearchHit } from "@mdu/db";
import { getJurisdiction } from "@mdu/db";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Map as MapIcon, Search, SlidersHorizontal } from "lucide-react";
import { AppBar } from "@/components/AppBar";
import { AutoSubmit } from "@/components/AutoSubmit";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { archiveHref, parseArchive, toSearchParams, type ArchiveQuery } from "@/lib/archive";
import { getDb } from "@/lib/db";
import { highlight, searchTerms, snippet } from "@/lib/highlight";
import { projectPath } from "@/lib/project";
import { cachedSearch } from "@/lib/search";

// Every query is its own page; cachedSearch keeps each answer for 5 minutes.
export const dynamic = "force-dynamic";

const FORM = "archive";

type Props = {
  params: Promise<{ city: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city } = await params;
  const j = await getJurisdiction(getDb(), city);
  if (!j) return {};
  const t = await getTranslations("Archive");
  return { title: t("title", { city: j.name }), alternates: { canonical: `/${city}/arhiva` } };
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-inherit">
            {p.text}
          </mark>
        ) : (
          p.text
        ),
      )}
    </>
  );
}

async function Hit({ city, hit, terms }: { city: string; hit: SearchHit; terms: string[] }) {
  const kind = await getTranslations("Kind");
  const f = await getFormatter();
  const text = hit.summary ?? hit.address ?? "";
  return (
    <li className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={hit.status} />
        <span className="text-xs text-slate-500">
          {kind(hit.kind)}
          {hit.eventDate
            ? ` · ${f.dateTime(new Date(`${hit.eventDate}T12:00:00`), { dateStyle: "medium" })}`
            : ""}
        </span>
      </div>
      <h2 className="mt-2 text-base leading-snug font-semibold">
        <Link href={projectPath(city, hit.slug)} className="text-slate-900">
          <Marked text={hit.title} terms={terms} />
        </Link>
      </h2>
      {text && (
        <p className="snippet mt-1 text-sm text-slate-600">
          <Marked text={snippet(text, terms)} terms={terms} />
        </p>
      )}
      {hit.initiator && (
        <p className="mt-1 text-xs text-slate-500">
          <Marked text={hit.initiator} terms={terms} />
        </p>
      )}
    </li>
  );
}

function Facet<T extends string | number>({
  legend,
  name,
  values,
  selected,
  label,
  type = "checkbox",
  all,
}: {
  legend: string;
  name: string;
  values: FacetValue<T>[];
  selected: T[];
  label: (v: T) => string;
  type?: "checkbox" | "radio";
  all?: string;
}) {
  if (!values.length && !selected.length) return null;
  const shown = [
    ...values,
    ...selected
      .filter((s) => !values.some((v) => v.value === s))
      .map((value) => ({ value, count: 0 })),
  ];
  return (
    <fieldset className="facet min-w-0">
      <legend className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {legend}
      </legend>
      <ul className="space-y-0.5">
        {all && (
          <li>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name={name}
                value=""
                defaultChecked={selected.length === 0}
                form={FORM}
                className="size-4 accent-accent-700"
              />
              {all}
            </label>
          </li>
        )}
        {shown.map((v) => (
          <li key={String(v.value)}>
            <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
              <input
                type={type}
                name={name}
                value={String(v.value)}
                defaultChecked={selected.includes(v.value)}
                form={FORM}
                className="size-4 accent-accent-700"
              />
              <span className="min-w-0 flex-1 truncate">{label(v.value)}</span>
              <span className="text-xs text-slate-500 tabular-nums">{v.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export default async function ArchivePage({ params, searchParams }: Props) {
  const { city } = await params;
  const j = await getJurisdiction(getDb(), city);
  if (!j) notFound();
  const a: ArchiveQuery = parseArchive(await searchParams);
  const result = (await cachedSearch(city, toSearchParams(a)))!;
  const t = await getTranslations("Archive");
  const kind = await getTranslations("Kind");
  const status = await getTranslations("Status");
  const terms = searchTerms(a.q);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const query = archiveHref(a, { page: 1 });
  const filtered = a.kinds.length + a.statuses.length + a.initiators.length > 0 || a.year || a.open;

  return (
    <>
      <AppBar
        city={{ slug: city, name: j.name }}
        actions={
          <Link
            href={`/${city}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:no-underline"
          >
            <MapIcon aria-hidden className="size-4" />
            {t("mapLink")}
          </Link>
        }
      />
      <main className="mx-auto max-w-5xl px-4 pt-5 pb-12">
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("intro")}</p>

        <form id={FORM} method="get" role="search" className="mt-4 flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("searchLabel")}</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              name="q"
              defaultValue={a.q}
              placeholder={t("searchPlaceholder")}
              maxLength={200}
              className="h-11 w-full rounded-xl border border-slate-300 bg-white pr-3 pl-9 text-base"
            />
          </label>
          <Button type="submit">{t("search")}</Button>
        </form>
        <AutoSubmit form={FORM} />

        <div className="mt-6 grid gap-6 lg:grid-cols-[15rem_1fr]">
          <details
            open
            className="facets group self-start rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 lg:sticky lg:top-[calc(var(--app-bar-height)+1rem)]"
          >
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 font-semibold lg:pointer-events-none">
              <SlidersHorizontal aria-hidden className="size-4" />
              {t("filters")}
            </summary>
            <div className="mt-3 space-y-5">
              <Facet
                legend={t("kind")}
                name="tip"
                values={result.facets.kinds}
                selected={a.kinds}
                label={(v) => kind(v)}
              />
              <Facet
                legend={t("status")}
                name="stare"
                values={result.facets.statuses}
                selected={a.statuses}
                label={(v) => status(v)}
              />
              <Facet
                legend={t("year")}
                name="an"
                type="radio"
                all={t("allYears")}
                values={result.facets.years}
                selected={a.year ? [a.year] : []}
                label={(v) => String(v)}
              />
              <Facet
                legend={t("initiator")}
                name="initiator"
                values={result.facets.initiators}
                selected={a.initiators}
                label={(v) => v}
              />
              <input
                type="hidden"
                name="ordine"
                value={a.sort === "date" ? "data" : ""}
                form={FORM}
                disabled={a.sort !== "date"}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" form={FORM} variant="secondary" size="sm" data-no-js>
                  {t("apply")}
                </Button>
                {filtered && (
                  <Link
                    href={`/${city}/arhiva${a.q ? `?q=${encodeURIComponent(a.q)}` : ""}`}
                    className="text-sm"
                  >
                    {t("reset")}
                  </Link>
                )}
              </div>
            </div>
          </details>

          <section aria-labelledby="results-heading" className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 id="results-heading" className="text-sm font-semibold text-slate-900">
                <output aria-live="polite">
                  {t("results", { count: result.total })}
                  {a.q ? ` ${t("resultsFor", { q: a.q })}` : ""}
                </output>
              </h2>
              {a.q && (
                <nav aria-label={t("sort")} className="flex items-center gap-1 text-sm">
                  {(["relevance", "date"] as const).map((s) => (
                    <Link
                      key={s}
                      href={`?${archiveHref(a, { sort: s, page: 1 })}`}
                      aria-current={a.sort === s ? "true" : undefined}
                      className="rounded-full px-2.5 py-1 text-slate-600 hover:no-underline aria-[current]:bg-accent-700 aria-[current]:text-white"
                    >
                      {s === "relevance" ? t("sortRelevance") : t("sortDate")}
                    </Link>
                  ))}
                </nav>
              )}
              <a
                href={`/api/${city}/search.csv${query ? `?${query}` : ""}`}
                title={t("exportHint")}
                className="export ml-auto inline-flex min-h-9 items-center gap-1.5 text-sm"
                download
              >
                <Download aria-hidden className="size-4" />
                {t("export")}
              </a>
            </div>

            {result.hits.length === 0 ? (
              <p className="mt-4 rounded-xl bg-white p-6 text-center text-sm text-slate-600">
                {t("noResults")}
              </p>
            ) : (
              <ol className="results mt-3 space-y-3">
                {result.hits.map((h) => (
                  <Hit key={h.slug} city={city} hit={h} terms={terms} />
                ))}
              </ol>
            )}

            {pages > 1 && (
              <nav
                aria-label={t("pageOf", { page: a.page, pages })}
                className="mt-6 flex items-center justify-between text-sm"
              >
                {a.page > 1 ? (
                  <Link rel="prev" href={`?${archiveHref(a, { page: a.page - 1 })}`}>
                    {t("previous")}
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-slate-500">{t("pageOf", { page: a.page, pages })}</span>
                {a.page < pages ? (
                  <Link rel="next" href={`?${archiveHref(a, { page: a.page + 1 })}`}>
                    {t("next")}
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
