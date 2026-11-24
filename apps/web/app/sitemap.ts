import { citySlugs, sitemapProjects } from "@mdu/db";
import { LOCALES } from "@mdu/shared";
import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { localePath } from "@/lib/locale";
import { siteUrl } from "@/lib/site";

// Read from the database on request: the build has no database (ADR 0003).
export const dynamic = "force-dynamic";

/**
 * M5.6: every public page and every published project, each in Romanian with its English
 * alternate (hreflang), so search engines index the project pages.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = getDb();
  const [cities, projects] = await Promise.all([citySlugs(db), sitemapProjects(db)]);
  const base = siteUrl();
  const entry = (path: string, lastModified?: string): MetadataRoute.Sitemap[number] => ({
    url: new URL(path, base).toString(),
    ...(lastModified ? { lastModified } : {}),
    alternates: {
      languages: Object.fromEntries(
        LOCALES.map((l) => [l, new URL(localePath(l, path), base).toString()]),
      ),
    },
  });
  return [
    entry("/"),
    entry("/despre"),
    entry("/metodologie"),
    ...cities.flatMap((c) => [entry(`/${c}`), entry(`/${c}/arhiva`), entry(`/${c}/consultari`)]),
    ...projects.map((p) => entry(`/${p.city}/proiecte/${p.slug}`, p.updatedAt)),
  ];
}
