"use client";

import type { BBox, MapEntry } from "@mdu/db";
import type { ProjectKind, ProjectStatus } from "@mdu/shared";
import { LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { FilterChips, FilterForm } from "@/components/FilterBar";
import { ListMapBridge } from "@/components/ListMapBridge";
import { ProjectList } from "@/components/ProjectList";
import { ProjectMap } from "@/components/ProjectMap";
import { setBusy } from "@/lib/busy";
import { bucharestToday, filterEntries, PAGE, pins } from "@/lib/explore";
import { parseFilters, toQuery } from "@/lib/filters";
import { useIndex } from "@/lib/index-store";
import { saveView, useSavedView } from "@/lib/view-memory";

export interface FirstView {
  /** The query the server filtered by. */
  query: string;
  cards: MapEntry[];
  total: number;
  located: number;
}

/**
 * The map page (M4.1, M5.7): the map, the filters and the list, all filtered in the browser from
 * the city's index, so a filter change needs no request. Until the index arrives, the server's
 * first view shows. Going back to the page restores where the reader was (lib/view-memory.ts).
 */
export function CityExplorer({
  city,
  bbox,
  first,
  kinds,
  statuses,
  years,
  neighbourhoods,
}: {
  city: string;
  bbox: BBox | null;
  first: FirstView;
  kinds: ProjectKind[];
  statuses: ProjectStatus[];
  years: number[];
  neighbourhoods: { slug: string; name: string }[];
}) {
  const t = useTranslations("Filters");
  const cityT = useTranslations("City");
  const search = useSearchParams();
  const query = search.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(query)), [query]);
  const index = useIndex(city);
  const results = useMemo(
    () => (index ? filterEntries(index.entries, filters, bucharestToday()) : null),
    [index, filters],
  );
  const pinData = useMemo(() => (results ? pins(results) : null), [results]);
  // Cards shown: as many as before when coming back, a page after a new filter, more on scroll.
  const saved = useSavedView();
  const [openedWith] = useState(query);
  const [chosen, setChosen] = useState<{ query: string; n: number } | null>(null);
  const base =
    query === openedWith ? Math.max(saved?.shown ?? 0, first.cards.length || PAGE) : PAGE;
  const shown = chosen?.query === query ? chosen.n : base;
  const setShown = useCallback(
    (next: (n: number) => number) =>
      setChosen((c) => ({ query, n: next(c?.query === query ? c.n : base) })),
    [query, base],
  );

  // Filters changed before the index arrived: the shown results are the server's, so say so.
  const stale = !results && toQuery(filters) !== first.query;
  useEffect(() => {
    setBusy(stale);
    return () => setBusy(false);
  }, [stale]);

  // Back to the page: the list's scroll, once the cards it needs are there (the map restores its
  // own view, the sheet its height). A link to one card (#p-slug) wins over the saved scroll.
  const restore = useRef<number | null | undefined>(undefined); // undefined: not applied yet
  const total = results?.length ?? first.total;
  const cards = results ? results.slice(0, shown) : first.cards;
  useLayoutEffect(() => {
    const body = document.querySelector<HTMLElement>("[data-sheet-body]");
    if (!body) return;
    if (restore.current === undefined && saved) {
      restore.current =
        saved.scroll && !window.location.hash.startsWith("#p-") ? saved.scroll : null;
    }
    if (restore.current && cards.length >= Math.min(shown, total)) {
      body.scrollTop = restore.current;
      restore.current = null;
    }
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => saveView({ scroll: Math.round(body.scrollTop) }));
    };
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      body.removeEventListener("scroll", onScroll);
    };
  }, [saved, cards.length, total, shown]);
  useEffect(() => saveView({ shown }), [shown]);

  // A new filter starts the list from the top.
  const lastQuery = useRef(query);
  useEffect(() => {
    if (lastQuery.current === query) return;
    lastQuery.current = query;
    const body = document.querySelector<HTMLElement>("[data-sheet-body]");
    if (body) body.scrollTop = 0;
  }, [query]);

  // A link to a card further down (a map popup's "show on list"): show up to it, then scroll.
  useEffect(() => {
    if (!results) return;
    const go = () => {
      const hash = decodeURIComponent(window.location.hash);
      if (!hash.startsWith("#p-")) return;
      const i = results.findIndex((e) => `#p-${e.slug}` === hash);
      if (i < 0) return;
      setShown((s) => Math.max(s, i + 1));
      requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView());
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [results, setShown]);

  // More cards as the reader nears the end of the list.
  const more = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el || !results) return;
    const io = new IntersectionObserver(
      (seen) => {
        if (seen.some((s) => s.isIntersecting)) setShown((s) => s + PAGE);
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [results, shown, setShown]);

  const located = results ? (pinData?.features.length ?? 0) : first.located;
  const left = total - cards.length;
  const moreQuery = new URLSearchParams(query);
  moreQuery.set("afisate", String(cards.length + PAGE));

  return (
    <>
      <div className="absolute inset-0">
        <ProjectMap
          city={city}
          bbox={bbox}
          projects={pinData}
          located={located}
          area={filters.area}
        />
      </div>
      <BottomSheet
        remember
        title={
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <output aria-live="polite">{t("showing", { count: total })}</output>
            <LoaderCircle
              aria-hidden
              className="busy-spinner size-3.5 shrink-0 text-slate-500 motion-safe:animate-spin"
            />
          </p>
        }
        toolbar={<FilterChips filters={filters} kinds={kinds} statuses={statuses} />}
      >
        <FilterForm filters={filters} years={years} neighbourhoods={neighbourhoods} />
        <h2 className="sr-only">{cityT("listHeading", { count: total })}</h2>
        <div data-busy-fade>
          <ProjectList city={city} projects={cards} />
          {left > 0 && (
            <a
              ref={more}
              href={`?${moreQuery.toString().replaceAll("%2C", ",").replaceAll("%3B", ";")}`}
              data-more
              onClick={(e) => {
                if (!results) return; // without the index, the server shows more
                e.preventDefault();
                setShown((s) => s + PAGE);
              }}
              className="mt-3 flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white text-sm font-medium text-slate-800 no-underline hover:bg-slate-50"
            >
              {t("showMore", { count: left })}
            </a>
          )}
        </div>
        <ListMapBridge />
      </BottomSheet>
    </>
  );
}
