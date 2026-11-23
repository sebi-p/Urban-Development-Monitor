import "server-only";
import { getJurisdiction, getProject } from "@mdu/db";
import { cache } from "react";
import { getDb } from "@/lib/db";

/** One database round per request for the page, its metadata and its share image. */
export const loadProject = cache(async (city: string, slug: string) => {
  const db = getDb();
  const [jurisdiction, lookup] = await Promise.all([
    getJurisdiction(db, city),
    getProject(db, city, slug),
  ]);
  return { jurisdiction, lookup };
});

export function projectPath(city: string, slug: string): string {
  return `/${city}/proiecte/${slug}`;
}
