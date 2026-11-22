"use client";

import type { BBox, ProjectCollection } from "@mdu/db";
import type { ProjectStatus } from "@mdu/shared";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { STATUS_COLOURS } from "@/lib/status";

// Public OpenFreeMap instance: no key, no usage limits (PLAN §4). Attribution is in the style.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SOURCE = "projects";

/**
 * The map is created once; when the filters change, only the data is swapped (setData), so a
 * phone doesn't reload the style and tiles. Nearby projects are clustered (M4.1).
 */
export function ProjectMap({ bbox, projects }: { bbox: BBox | null; projects: ProjectCollection }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latest = useRef(projects);
  const t = useTranslations("City");
  const status = useTranslations("Status");
  const filters = useTranslations("Filters");

  useEffect(() => {
    if (!container.current) return;
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
      mapRef.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      m.on("load", () => {
        m.addSource(SOURCE, {
          type: "geojson",
          data: latest.current,
          cluster: true,
          clusterRadius: 40,
          clusterMaxZoom: 15,
        });
        const colour = [
          "match",
          ["get", "status"],
          ...Object.entries(STATUS_COLOURS).flat(),
          "#7c3aed",
        ] as unknown as ExpressionSpecification;
        m.addLayer({
          id: "clusters",
          type: "circle",
          source: SOURCE,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#1f2937",
            "circle-opacity": 0.85,
            "circle-radius": ["step", ["get", "point_count"], 14, 5, 18, 15, 24],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        m.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: SOURCE,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Noto Sans Regular"],
            "text-size": 12,
          },
          paint: { "text-color": "#ffffff" },
        });
        m.addLayer({
          id: "projects",
          type: "circle",
          source: SOURCE,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": 7,
            "circle-color": colour,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        container.current?.setAttribute("data-ready", "true"); // for tests and the 3G budget
        m.on("idle", () => {
          const el = container.current;
          if (!el) return;
          const clusters = m.queryRenderedFeatures({ layers: ["clusters"] });
          el.dataset.clusters = String(clusters.length);
          el.dataset.zoom = m.getZoom().toFixed(1);
          const first = clusters[0]?.geometry;
          if (first?.type === "Point") {
            const p = m.project(first.coordinates as [number, number]);
            el.dataset.clusterXy = `${Math.round(p.x)},${Math.round(p.y)}`;
          } else {
            delete el.dataset.clusterXy;
          }
        });

        m.on("click", "clusters", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          const source = m.getSource(SOURCE) as GeoJSONSource;
          void source.getClusterExpansionZoom(f.properties.cluster_id as number).then((zoom) => {
            m.easeTo({
              center: (f.geometry as { coordinates: [number, number] }).coordinates,
              zoom,
            });
          });
        });
        m.on("click", "projects", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          const props = f.properties as { title: string; status: ProjectStatus; slug: string };
          // Build the popup with textContent so source text can never inject HTML.
          const el = document.createElement("div");
          const title = el.appendChild(document.createElement("strong"));
          title.textContent = props.title;
          el.appendChild(document.createElement("br"));
          el.appendChild(document.createTextNode(status(props.status)));
          el.appendChild(document.createElement("br"));
          const link = el.appendChild(document.createElement("a"));
          link.href = `#p-${props.slug}`;
          link.textContent = filters("showOnList");
          new maplibregl.Popup({ offset: 10 })
            .setLngLat(f.geometry.coordinates as [number, number])
            .setDOMContent(el)
            .addTo(m);
        });
        for (const layer of ["clusters", "projects"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
      });
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [bbox, status, filters]);

  // New filters: swap the data only (and keep it for a map that is still loading).
  useEffect(() => {
    latest.current = projects;
    const source = mapRef.current?.getSource(SOURCE) as GeoJSONSource | undefined;
    source?.setData(projects);
  }, [projects]);

  return (
    <div
      ref={container}
      className="map h-full w-full"
      role="region"
      aria-label={t("mapLabel")}
      data-count={projects.features.length}
    />
  );
}
