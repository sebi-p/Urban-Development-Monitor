import "server-only";
import { mapIndex } from "@mdu/db";
import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";

export const INDEX_TAG = "city-index";

/**
 * The map page's index per city (M5.7), cached for 5 minutes: the pipeline runs once a day, and
 * admin changes to a project invalidate the tag at once.
 */
export const cityIndex = unstable_cache(
  async (city: string) => mapIndex(getDb(), city),
  ["city-index-v1"],
  { revalidate: 300, tags: [INDEX_TAG] },
);
