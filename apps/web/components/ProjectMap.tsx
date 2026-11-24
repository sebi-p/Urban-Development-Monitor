"use client";

import type { Area, BBox, ProjectCollection } from "@mdu/db";
import type { ProjectStatus } from "@mdu/shared";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { MapTools } from "@/components/MapTools";
import { localePath } from "@/lib/locale";
import { HIGHLIGHT, listen, SHOW } from "@/lib/map-events";
import { STATUS_COLOURS } from "@/lib/status";

type PinProps = { title: string; status: ProjectStatus; slug: string };

// Public OpenFreeMap instance: no key, no usage limits (PLAN §4). Attribution is in the style.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SOURCE = "projects";
const RING = "#0f766e"; // the accent: the highlighted pin's ring
const SHOW_ZOOM = 16; // past clusterMaxZoom, so the pin stands alone
const AREA = "area"; // the drawn area's outline (M5.6)

function areaData(area?: Area): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: area
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [[...area, area[0]!]] },
          },
        ]
      : [],
  };
}

/** The API's collection is GeoJSON with a looser geometry type than MapLibre's. */
const asGeoJSON = (c: ProjectCollection) => c as unknown as GeoJSON.FeatureCollection;

function areaBounds(area: Area): [number, number, number, number] {
  const lons = area.map((p) => p[0]);
  const lats = area.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/**
 * The map is created once; when the filters change, only the data is swapped (setData), so a
 * phone doesn't reload the style and tiles. Nearby projects are clustered (M4.1).
 */
export function ProjectMap({
  city,
  bbox,
  projects,
  area,
}: {
  city: string;
  bbox: BBox | null;
  projects: ProjectCollection;
  area?: Area;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latest = useRef(projects);
  const latestArea = useRef(area);
  const [ready, setReady] = useState(false);
  const t = useTranslations("City");
  const status = useTranslations("Status");
  const filters = useTranslations("Filters");
  const locale = useLocale();

  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    const stops: (() => void)[] = [];

    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !container.current) return;
      // Served from public/ (scripts/copy-assets.mjs); the version busts caches on upgrade.
      maplibregl.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);
      const drawn = latestArea.current;
      const start = drawn ? areaBounds(drawn) : bbox;
      // A drawn area is framed clear of the tools, and of the side panel on wide screens.
      const wide = window.matchMedia("(min-width: 1024px)").matches;
      const padding = drawn
        ? { top: 72, right: 48, bottom: wide ? 48 : 280, left: wide ? 472 : 24 }
        : 24;
      const m = new maplibregl.Map({
        container: container.current,
        style: STYLE_URL,
        ...(start ? { bounds: start, fitBoundsOptions: { padding } } : { center: [0, 0], zoom: 1 }),
      });
      mapRef.current = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

      m.on("load", () => {
        m.addSource(AREA, { type: "geojson", data: areaData(latestArea.current) });
        m.addLayer({
          id: "area-fill",
          type: "fill",
          source: AREA,
          paint: { "fill-color": RING, "fill-opacity": 0.08 },
        });
        m.addLayer({
          id: "area-line",
          type: "line",
          source: AREA,
          paint: { "line-color": RING, "line-width": 2, "line-dasharray": [2, 1] },
        });
        m.addSource(SOURCE, {
          type: "geojson",
          data: asGeoJSON(latest.current),
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
        // The pin of the card under the pointer or keyboard focus: larger, with a ring.
        const none = ["==", ["get", "slug"], ""] as ExpressionSpecification;
        m.addLayer({
          id: "project-ring",
          type: "circle",
          source: SOURCE,
          filter: none,
          paint: {
            "circle-radius": 17,
            "circle-opacity": 0,
            "circle-stroke-width": 3,
            "circle-stroke-color": RING,
          },
        });
        m.addLayer({
          id: "project-highlight",
          type: "circle",
          source: SOURCE,
          filter: none,
          paint: {
            "circle-radius": 11,
            "circle-color": colour,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });
        container.current?.setAttribute("data-ready", "true"); // for tests and the 3G budget
        setReady(true);
        m.on("idle", () => {
          const el = container.current;
          if (!el) return;
          const clusters = m.queryRenderedFeatures({ layers: ["clusters"] });
          el.dataset.clusters = String(clusters.length);
          el.dataset.zoom = m.getZoom().toFixed(1);
          // The cluster nearest the centre (for tests): the edges are under the tools and panels.
          const { width, height } = m.getCanvas().getBoundingClientRect();
          const off = (f: (typeof clusters)[number]) => {
            if (f.geometry.type !== "Point") return Infinity;
            const q = m.project(f.geometry.coordinates as [number, number]);
            return Math.hypot(q.x - width / 2, q.y - height / 2);
          };
          const first = [...clusters].sort((a, b) => off(a) - off(b))[0]?.geometry;
          // How many highlighted pins are drawn (0 while the pin is inside a cluster).
          el.dataset.highlighted = String(
            m.queryRenderedFeatures({ layers: ["project-highlight"] }).length,
          );
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
              center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
              zoom,
            });
          });
        });
        let popup: import("maplibre-gl").Popup | null = null;
        let pinned: string | null = null; // shown with "Arată pe hartă": stays until its popup closes
        let hovered: string | null = null;
        let marked = "";
        const mark = () => {
          const slug = pinned ?? hovered ?? "";
          if (slug === marked) return; // a filter change re-lays out the pins: skip no-ops
          marked = slug;
          const filter = ["==", ["get", "slug"], slug] as ExpressionSpecification;
          m.setFilter("project-ring", filter);
          m.setFilter("project-highlight", filter);
          if (container.current) container.current.dataset.highlight = slug;
        };
        const openPopup = (coordinates: [number, number], props: PinProps) => {
          // Built with textContent so source text can never inject HTML.
          const el = document.createElement("div");
          const title = el.appendChild(document.createElement("strong"));
          title.textContent = props.title;
          el.appendChild(document.createElement("br"));
          el.appendChild(document.createTextNode(status(props.status)));
          el.appendChild(document.createElement("br"));
          const link = el.appendChild(document.createElement("a"));
          link.href = `#p-${props.slug}`;
          link.textContent = filters("showOnList");
          el.appendChild(document.createElement("br"));
          const page = el.appendChild(document.createElement("a"));
          page.href = localePath(locale, `/${city}/proiecte/${encodeURIComponent(props.slug)}`);
          page.textContent = filters("openProject");
          popup?.remove();
          popup = new maplibregl.Popup({ offset: 12 })
            .setLngLat(coordinates)
            .setDOMContent(el)
            .addTo(m);
          popup.on("close", () => {
            if (pinned === props.slug) {
              pinned = null;
              mark();
            }
          });
        };
        m.on("click", "projects", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          openPopup(f.geometry.coordinates as [number, number], f.properties as PinProps);
        });
        stops.push(
          listen<{ slug: string | null }>(HIGHLIGHT, ({ slug }) => {
            hovered = slug;
            mark();
          }),
          listen<{ slug: string }>(SHOW, ({ slug }) => {
            const f = latest.current.features.find((x) => x.properties.slug === slug);
            if (!f || f.geometry.type !== "Point") return;
            const at = f.geometry.coordinates as [number, number];
            pinned = slug;
            mark();
            m.once("moveend", () => openPopup(at, f.properties));
            m.easeTo({ center: at, zoom: Math.max(m.getZoom(), SHOW_ZOOM) });
          }),
        );
        for (const layer of ["clusters", "projects"]) {
          m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
          m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
        }
      });
    });

    return () => {
      cancelled = true;
      for (const stop of stops) stop();
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [bbox, city, status, filters, locale]);

  // New filters: swap the data only (and keep it for a map that is still loading).
  useEffect(() => {
    latest.current = projects;
    const source = mapRef.current?.getSource(SOURCE) as GeoJSONSource | undefined;
    source?.setData(asGeoJSON(projects));
  }, [projects]);

  // A new drawn area: redraw its outline (the map keeps its view; it was just drawn there).
  useEffect(() => {
    latestArea.current = area;
    const source = mapRef.current?.getSource(AREA) as GeoJSONSource | undefined;
    source?.setData(areaData(area));
    if (container.current) container.current.dataset.area = area ? String(area.length) : "";
  }, [area]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={container}
        className="map h-full w-full"
        role="region"
        aria-label={t("mapLabel")}
        data-count={projects.features.length}
      />
      <MapTools city={city} area={area} map={mapRef} ready={ready} />
    </div>
  );
}
