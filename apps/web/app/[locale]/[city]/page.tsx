import { getJurisdiction, listProjects, projectsGeoJSON } from "@mdu/db";
import { PROJECT_KINDS, PROJECT_STATUSES } from "@mdu/shared";
import type { Metadata } from "next";
import { LoaderCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppBar } from "@/components/AppBar";
import { SiteNav } from "@/components/SiteNav";
import { BottomSheet } from "@/components/BottomSheet";
import { FilterChips, FilterForm } from "@/components/FilterBar";
import { ListMapBridge } from "@/components/ListMapBridge";
import { ProjectList } from "@/components/ProjectList";
import { ProjectMap } from "@/components/ProjectMap";
import { getDb } from "@/lib/db";
import { alternates } from "@/lib/locale";
import { parseFilters, toDbFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; city: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, city } = await params;
  setRequestLocale(locale);
  const j = await getJurisdiction(getDb(), city);
  if (!j) return {};
  const t = await getTranslations("City");
  return {
    title: t("title", { city: j.name }),
    alternates: alternates(locale, `/${city}`, { city, title: j.name }),
  };
}

export default async function CityPage({ params, searchParams }: Props) {
  const { locale, city } = await params;
  setRequestLocale(locale);
  const filters = parseFilters(await searchParams);
  const db = getDb();
  const j = await getJurisdiction(db, city);
  if (!j) notFound();
  const [projects, list, all] = await Promise.all([
    projectsGeoJSON(db, city, toDbFilters(filters)),
    listProjects(db, city, toDbFilters(filters)),
    listProjects(db, city), // filter options: only values that occur
  ]);
  const t = await getTranslations("City");
  const kinds = PROJECT_KINDS.filter((k) => all!.some((p) => p.kind === k));
  const statuses = PROJECT_STATUSES.filter((s) => all!.some((p) => p.status === s));
  const years = [
    ...new Set(all!.flatMap((p) => (p.eventDate ? [Number(p.eventDate.slice(0, 4))] : []))),
  ].sort((a, b) => b - a);

  const filtersT = await getTranslations("Filters");

  return (
    <>
      <AppBar city={{ slug: city, name: j.name }} actions={<SiteNav city={city} current="map" />} />
      <main className="relative h-[calc(100dvh-var(--app-bar-height))] overflow-hidden">
        <h1 className="sr-only">{t("title", { city: j.name })}</h1>
        <div className="absolute inset-0">
          <ProjectMap city={city} bbox={j.bbox} projects={projects!} />
        </div>
        <BottomSheet
          title={
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <output aria-live="polite">{filtersT("showing", { count: list!.length })}</output>
              <LoaderCircle
                aria-hidden
                className="busy-spinner size-3.5 shrink-0 text-slate-500 motion-safe:animate-spin"
              />
            </p>
          }
          toolbar={<FilterChips filters={filters} kinds={kinds} statuses={statuses} />}
        >
          <FilterForm filters={filters} years={years} />
          <h2 className="sr-only">{t("listHeading", { count: list!.length })}</h2>
          <div data-busy-fade>
            <ProjectList city={city} projects={list!} />
          </div>
          <ListMapBridge />
        </BottomSheet>
      </main>
    </>
  );
}
