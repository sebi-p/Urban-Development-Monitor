import "server-only";
import { searchProjects, type SearchParams } from "@mdu/db";
import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";

/** Archive results, cached for 5 minutes per city and query (the pipeline runs once a day). */
export const cachedSearch = unstable_cache(
  async (city: string, params: SearchParams) => searchProjects(getDb(), city, params),
  ["archive-search-v1"],
  { revalidate: 300 },
);
