import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** M5.6: everything public may be indexed; the admin area and the watchdog may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/watchdog"] }],
    sitemap: new URL("/sitemap.xml", siteUrl()).toString(),
  };
}
