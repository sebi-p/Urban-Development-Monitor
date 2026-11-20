import { getJurisdiction, listProjects, projectsGeoJSON } from "@mdu/db";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { ProjectList } from "@/components/ProjectList";
import { ProjectMap } from "@/components/ProjectMap";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city } = await params;
  const j = await getJurisdiction(getDb(), city);
  if (!j) return {};
  const t = await getTranslations("City");
  return { title: t("title", { city: j.name }) };
}

export default async function CityPage({ params }: Props) {
  const { city } = await params;
  const db = getDb();
  const j = await getJurisdiction(db, city);
  if (!j) notFound();
  const [projects, list] = await Promise.all([projectsGeoJSON(db, city), listProjects(db, city)]);
  const t = await getTranslations("City");

  return (
    <main className="page">
      <h1>{t("title", { city: j.name })}</h1>
      <ProjectMap bbox={j.bbox} projects={projects!} />
      <h2>{t("listHeading", { count: list!.length })}</h2>
      <ProjectList projects={list!} />
    </main>
  );
}
