import "server-only";
import { latestAuditResults, listJurisdictions } from "@mdu/db";
import { unstable_cache } from "next/cache";
import { getDb } from "@/lib/db";

export const AUDIT_TAG = "published-audit";

/** Every city with its latest published accuracy audit (M5.2), cached for an hour; publishing an
 * audit invalidates the tag. */
export const publishedAccuracy = unstable_cache(
  async () => {
    const db = getDb();
    const cities = await listJurisdictions(db);
    const results = await Promise.all(cities.map((c) => latestAuditResults(db, c.slug)));
    return { cities, results };
  },
  ["published-accuracy"],
  { revalidate: 3600, tags: [AUDIT_TAG] },
);
