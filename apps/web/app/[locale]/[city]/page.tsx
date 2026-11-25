import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AppBar } from "@/components/AppBar";
import { CityExplorer } from "@/components/CityExplorer";
import { SiteNav } from "@/components/SiteNav";
import { cityIndex } from "@/lib/city-index";
import { bucharestToday, filterEntries, filterOptions, shownFrom } from "@/lib/explore";
import { get, parseFilters, toQuery } from "@/lib/filters";
import { alternates } from "@/lib/locale";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; city: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, city } = await params;
  setRequestLocale(locale);
  const index = await cityIndex(city);
  if (!index) return {};
  const t = await getTranslations("City");
  const name = index.jurisdiction.name;
  return {
    title: t("title", { city: name }),
    alternates: alternates(locale, `/${city}`, { city, title: name }),
  };
}

/**
 * The map page (M4.1). The city's index is cached (lib/city-index.ts), so the page needs no
 * database round trip; the server filters it for the first view and for browsers without
 * JavaScript, and the browser filters it from then on (M5.7, ADR 0023).
 */
export default async function CityPage({ params, searchParams }: Props) {
  const { locale, city } = await params;
  setRequestLocale(locale);
  const raw = await searchParams;
  const filters = parseFilters(raw);
  const index = await cityIndex(city);
  if (!index) notFound();
  const j = index.jurisdiction;
  const results = filterEntries(index.entries, filters, bucharestToday());
  const { kinds, statuses, years } = filterOptions(index.entries);
  // Neighbourhoods with projects, and the chosen one even if it has none (a shared link).
  const used = new Set(index.entries.map((e) => e.neighbourhood));
  const neighbourhoods = index.neighbourhoods.filter(
    (n) => used.has(n.slug) || n.slug === filters.neighbourhood,
  );
  const t = await getTranslations("City");

  return (
    <>
      <AppBar city={{ slug: city, name: j.name }} actions={<SiteNav city={city} current="map" />} />
      <main className="relative h-[calc(100dvh-var(--app-bar-height))] overflow-hidden">
        <h1 className="sr-only">{t("title", { city: j.name })}</h1>
        <CityExplorer
          city={city}
          bbox={j.bbox}
          first={{
            query: toQuery(filters),
            cards: results.slice(0, shownFrom(get(raw, "afisate"))),
            total: results.length,
            located: results.filter((e) => e.at).length,
          }}
          kinds={kinds}
          statuses={statuses}
          years={years}
          neighbourhoods={neighbourhoods}
        />
      </main>
    </>
  );
}
