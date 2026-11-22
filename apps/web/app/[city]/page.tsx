import { getJurisdiction, listProjects, projectsGeoJSON } from "@mdu/db";
import { PROJECT_KINDS, PROJECT_STATUSES } from "@mdu/shared";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppBar } from "@/components/AppBar";
import { BottomSheet } from "@/components/BottomSheet";
import { FilterChips, FilterForm } from "@/components/FilterBar";
import { ProjectList } from "@/components/ProjectList";
import { ProjectMap } from "@/components/ProjectMap";
import { getDb } from "@/lib/db";
import { parseFilters, toDbFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ city: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city } = await params;
  const j = await getJurisdiction(getDb(), city);
  if (!j) return {};
  const t = await getTranslations("City");
  return { title: t("title", { city: j.name }) };
}

export default async function CityPage({ params, searchParams }: Props) {
  const { city } = await params;
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
      <AppBar city={{ slug: city, name: j.name }} />
      <main className="relative h-[calc(100dvh-var(--app-bar-height))] overflow-hidden">
        <h1 className="sr-only">{t("title", { city: j.name })}</h1>
        <div className="absolute inset-0">
          <ProjectMap bbox={j.bbox} projects={projects!} />
        </div>
        <BottomSheet
          title={
            <p className="text-sm font-semibold text-slate-900">
              <output aria-live="polite">{filtersT("showing", { count: list!.length })}</output>
            </p>
          }
          toolbar={<FilterChips filters={filters} kinds={kinds} statuses={statuses} />}
        >
          <FilterForm filters={filters} years={years} />
          <h2 className="sr-only">{t("listHeading", { count: list!.length })}</h2>
          <ProjectList projects={list!} />
        </BottomSheet>
      </main>
    </>
  );
}
