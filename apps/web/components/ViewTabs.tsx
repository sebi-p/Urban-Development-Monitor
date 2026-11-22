"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** Map / List tabs on narrow screens; on wide screens both are shown side by side (CSS). A link
 * to a list entry (`#p-<slug>`, e.g. from a map popup) switches to the list. */
export function ViewTabs({ map, list }: { map: React.ReactNode; list: React.ReactNode }) {
  const t = useTranslations("Filters");
  const [view, setView] = useState<"map" | "list">("map");

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#p-")) setView("list");
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="views" data-view={view}>
      <div className="tabs" role="tablist" aria-label={t("tabs")}>
        {(["map", "list"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`tab-${v}`}
            aria-controls={`panel-${v}`}
            aria-selected={view === v}
            onClick={() => setView(v)}
          >
            {t(v === "map" ? "mapTab" : "listTab")}
          </button>
        ))}
      </div>
      <section id="panel-map" role="tabpanel" aria-labelledby="tab-map" className="panel-map">
        {map}
      </section>
      <section id="panel-list" role="tabpanel" aria-labelledby="tab-list" className="panel-list">
        {list}
      </section>
    </div>
  );
}
