"use client";

import type { BBox, ProjectCollection } from "@mdu/db";
import type { ProjectStatus } from "@mdu/shared";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { STATUS_COLOURS } from "@/lib/status";

// Public OpenFreeMap instance: no key, no usage limits (PLAN §4). Attribution is in the style.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function ProjectMap({ bbox, projects }: { bbox: BBox | null; projects: ProjectCollection }) {
  const container = useRef<HTMLDivElement>(null);
  const t = useTranslations("City");
  const status = useTranslations("Status");

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap | undefined;
    let cancelled = false;

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !container.current) return;
      // Served from public/ (scripts/copy-maplibre-worker.mjs); the version busts caches on upgrade.
      maplibregl.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);
      const m = new maplibregl.Map({
        container: container.current,
        style: STYLE_URL,
        ...(bbox
          ? { bounds: bbox, fitBoundsOptions: { padding: 24 } }
          : { center: [0, 0], zoom: 1 }),
      });
      map = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      m.on("load", () => {
        m.addSource("projects", { type: "geojson", data: projects });
        const colour = [
          "match",
          ["get", "status"],
          ...Object.entries(STATUS_COLOURS).flat(),
          "#7c3aed",
        ] as unknown as ExpressionSpecification;
        m.addLayer({
          id: "projects",
          type: "circle",
          source: "projects",
          paint: {
            "circle-radius": 7,
            "circle-color": colour,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });

        m.on("click", "projects", (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          const props = f.properties as { title: string; status: ProjectStatus };
          // Build the popup with textContent so source text can never inject HTML.
          const el = document.createElement("div");
          const title = el.appendChild(document.createElement("strong"));
          title.textContent = props.title;
          el.appendChild(document.createElement("br"));
          el.appendChild(document.createTextNode(status(props.status)));
          new maplibregl.Popup({ offset: 10 })
            .setLngLat(f.geometry.coordinates as [number, number])
            .setDOMContent(el)
            .addTo(m);
        });
        m.on("mouseenter", "projects", () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", "projects", () => (m.getCanvas().style.cursor = ""));
      });
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [bbox, projects, status]);

  return <div ref={container} className="map" role="region" aria-label={t("mapLabel")} />;
}
