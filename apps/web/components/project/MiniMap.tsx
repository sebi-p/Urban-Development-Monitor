"use client";

import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * A small, still map of the project's location. MapLibre (the largest script on the site) is
 * loaded only when the map scrolls into view, so a phone that opens the page from a shared link
 * gets the text first.
 */
export function MiniMap({
  lon,
  lat,
  colour,
  label,
}: {
  lon: number;
  lat: number;
  colour: string;
  label: string;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: MapLibreMap | null = null;
    let cancelled = false;
    const start = () => {
      void import("maplibre-gl").then((maplibregl) => {
        if (cancelled || !container.current) return;
        maplibregl.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);
        map = new maplibregl.Map({
          container: container.current,
          style: STYLE_URL,
          center: [lon, lat],
          zoom: 15.5,
          interactive: false,
          attributionControl: { compact: true },
        });
        map.on("load", () => {
          map?.addSource("here", {
            type: "geojson",
            data: { type: "Point", coordinates: [lon, lat] },
          });
          map?.addLayer({
            id: "here",
            type: "circle",
            source: "here",
            paint: {
              "circle-radius": 9,
              "circle-color": colour,
              "circle-stroke-width": 3,
              "circle-stroke-color": "#ffffff",
            },
          });
          // A still map never gets the interaction that folds the attribution away; start it
          // folded to its (i) button, which still opens the credits.
          container.current
            ?.querySelector(".maplibregl-ctrl-attrib")
            ?.classList.remove("maplibregl-compact-show");
          container.current?.setAttribute("data-ready", "true");
        });
      });
    };
    const seen = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          seen.disconnect();
          start();
        }
      },
      { rootMargin: "200px" },
    );
    seen.observe(el);
    return () => {
      cancelled = true;
      seen.disconnect();
      map?.remove();
    };
  }, [lon, lat, colour]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      className="mini-map h-56 w-full overflow-hidden rounded-[var(--radius-card)] border border-slate-200 bg-slate-100"
    />
  );
}
