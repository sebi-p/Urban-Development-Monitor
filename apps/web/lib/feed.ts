import { feedEntries, getJurisdiction, listNeighbourhoods } from "@mdu/db";
import { DEFAULT_LOCALE, LOCALES } from "@mdu/shared";
import { getFormatter, getTranslations } from "next-intl/server";
import { atomFeed } from "@/lib/atom";
import { getDb } from "@/lib/db";
import { parseArea, toQuery } from "@/lib/filters";
import { localePath } from "@/lib/locale";
import { projectPath } from "@/lib/project";

/**
 * The Atom feed behind /{city}/feed.xml?cartier=astra and /en/{city}/feed.xml (rewritten to
 * app/api/[city]/feed, next.config.ts): new projects and their events, for the city or one
 * neighbourhood (PLAN §8).
 */
export async function feedResponse(
  request: Request,
  city: string,
  lang: string,
): Promise<Response> {
  const url = new URL(request.url);
  const locale = LOCALES.find((l) => l === lang) ?? DEFAULT_LOCALE;
  const area = url.searchParams.get("cartier") ?? undefined;
  const drawn = parseArea(url.searchParams.get("zona") ?? ""); // M5.6
  const db = getDb();
  const [j, areas] = await Promise.all([getJurisdiction(db, city), listNeighbourhoods(db, city)]);
  const n = area ? areas?.find((a) => a.slug === area) : undefined;
  if (!j || (area && !n)) return new Response("Not found", { status: 404 });
  const entries = (await feedEntries(db, city, n?.slug, drawn))!;
  const t = await getTranslations({ locale, namespace: "Feed" });
  const home = await getTranslations({ locale, namespace: "Home" });
  const eventType = await getTranslations({ locale, namespace: "EventType" });
  const f = await getFormatter({ locale });
  const origin = url.origin;
  const query = toQuery({
    kinds: [],
    statuses: [],
    open: false,
    neighbourhood: n?.slug,
    area: drawn,
  });
  const self = `${origin}${localePath(locale, `/${city}/feed.xml`)}${query ? `?${query}` : ""}`;
  const title = [home("title"), j.name, n?.name].filter(Boolean).join(" · ");
  const body = atomFeed({
    id: self,
    title,
    self,
    link: `${origin}${localePath(locale, `/${city}`)}`,
    updated: entries[0]?.updatedAt ?? new Date(0).toISOString(),
    lang: locale,
    entries: entries.map((e) => {
      const summary = (locale === "en" ? (e.summaryEn ?? e.summary) : e.summary) ?? "";
      const when = e.date
        ? f.dateTime(new Date(`${e.date}T12:00:00`), { dateStyle: "long" })
        : null;
      const what =
        e.kind === "new_project"
          ? t("newProject", { title: e.project.title })
          : t("event", { type: eventType(e.eventType ?? "other"), title: e.project.title });
      return {
        id: `urn:uuid:${e.id}`,
        title: what,
        link: `${origin}${localePath(locale, projectPath(city, e.project.slug))}`,
        updated: e.updatedAt,
        category: e.neighbourhood ?? undefined,
        summary: [e.kind === "event" ? e.title : null, when, summary].filter(Boolean).join(" · "),
      };
    }),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
