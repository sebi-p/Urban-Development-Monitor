"use client";

import type { Area } from "@mdu/db";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { Crosshair, PenLine, Rss, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { formatArea, MAX_AREA_POINTS, parseFilters, toQuery } from "@/lib/filters";
import { localePath } from "@/lib/locale";
import { replaceQuery } from "@/lib/view-memory";

const NEAR_ZOOM = 15;

type Draw = { stop(): void };

/**
 * Map tools (M5.6, PLAN §8): draw an area (a polygon, with terra-draw, loaded on first use) that
 * filters the map and the list through `?zona=`, and "near me", which only moves the map: the
 * position stays in the browser, never in the URL or a request.
 */
export function MapTools({
  city,
  area,
  map,
}: {
  city: string;
  area?: Area;
  map: RefObject<MapLibreMap | null>;
}) {
  const t = useTranslations("Filters");
  const locale = useLocale();
  const search = useSearchParams();
  const [drawing, setDrawing] = useState(false);
  const [message, setMessage] = useState("");
  const draw = useRef<Draw | null>(null);
  const me = useRef<Marker | null>(null);

  useEffect(
    () => () => {
      draw.current?.stop();
      me.current?.remove();
    },
    [],
  );

  const go = (next: Area | undefined) => {
    const f = { ...parseFilters(new URLSearchParams(search.toString())), area: next };
    const q = toQuery(f);
    replaceQuery(q);
  };

  const attempt = useRef(0); // a cancel before terra-draw has loaded wins

  const stopDrawing = () => {
    attempt.current++;
    draw.current?.stop();
    draw.current = null;
    if (map.current) delete map.current.getContainer().dataset.drawing;
    setDrawing(false);
  };

  const startDrawing = async () => {
    const m = map.current;
    if (!m) return;
    const mine = ++attempt.current;
    setDrawing(true);
    setMessage("");
    // Buttons work from the first paint; drawing waits for the map's style.
    if (!m.isStyleLoaded()) await m.once("load");
    const [{ TerraDraw, TerraDrawPolygonMode }, { TerraDrawMapLibreGLAdapter }] = await Promise.all(
      [import("terra-draw"), import("terra-draw-maplibre-gl-adapter")],
    );
    if (mine !== attempt.current) return;
    const td = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map: m }),
      modes: [
        new TerraDrawPolygonMode({
          keyEvents: { cancel: "Escape", finish: "Enter" },
          styles: {
            fillColor: "#0f766e",
            fillOpacity: 0.15,
            outlineColor: "#0f766e",
            outlineWidth: 2,
            closingPointColor: "#ffffff",
            closingPointOutlineColor: "#0f766e",
          },
        }),
      ],
    });
    td.start();
    td.setMode("polygon");
    td.on("finish", (id) => {
      const f = td.getSnapshotFeature(id);
      if (f?.geometry.type !== "Polygon") return;
      const ring = (f.geometry.coordinates[0] as [number, number][]).slice(0, -1);
      stopDrawing();
      if (ring.length > MAX_AREA_POINTS) {
        setMessage(t("areaTooDetailed", { max: MAX_AREA_POINTS }));
        return;
      }
      go(ring);
    });
    draw.current = td;
    m.getContainer().dataset.drawing = "true"; // for tests
  };

  const nearMe = () => {
    if (!("geolocation" in navigator)) {
      setMessage(t("nearMeUnsupported"));
      return;
    }
    setMessage(t("nearMeLooking"));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const m = map.current;
        if (!m) return;
        const at: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        const { Marker } = await import("maplibre-gl");
        me.current?.remove();
        const dot = document.createElement("div");
        dot.className = "you-are-here";
        dot.setAttribute("role", "img");
        dot.setAttribute("aria-label", t("yourPosition"));
        me.current = new Marker({ element: dot }).setLngLat(at).addTo(m);
        m.flyTo({ center: at, zoom: Math.max(m.getZoom(), NEAR_ZOOM) });
        setMessage("");
      },
      () => setMessage(t("nearMeError")),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  const feed = area
    ? `${localePath(locale, `/${city}/feed.xml`)}?zona=${formatArea(area)}`
    : undefined;

  return (
    <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-5rem)] flex-col items-start gap-2 lg:left-[28.5rem] lg:max-w-[calc(100%-33rem)]">
      <div className="pointer-events-auto flex flex-wrap gap-2">
        {drawing ? (
          <Button type="button" size="sm" variant="secondary" onClick={stopDrawing}>
            <X aria-hidden className="size-4" />
            {t("cancelDraw")}
          </Button>
        ) : area ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => go(undefined)}>
            <X aria-hidden className="size-4" />
            {t("clearArea")}
          </Button>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => void startDrawing()}>
            <PenLine aria-hidden className="size-4" />
            {t("drawArea")}
          </Button>
        )}
        <Button type="button" size="sm" variant="secondary" onClick={nearMe}>
          <Crosshair aria-hidden className="size-4" />
          {t("nearMe")}
        </Button>
        {feed && !drawing ? (
          <a
            href={feed}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 no-underline shadow-[var(--shadow-card)] hover:bg-slate-100"
          >
            <Rss aria-hidden className="size-4" />
            {t("areaFeed")}
          </a>
        ) : null}
      </div>
      <p
        aria-live="polite"
        className="pointer-events-auto rounded-lg bg-white/95 px-2 text-xs text-slate-700 shadow-[var(--shadow-card)] empty:hidden"
      >
        {drawing ? t("drawHint") : message}
      </p>
    </div>
  );
}
