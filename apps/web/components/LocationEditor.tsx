"use client";

import type { BBox } from "@mdu/db";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { locateAction } from "@/app/admin/actions";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** A draggable pin; a click on the map moves it there. Saving stores a manual location. */
export function LocationEditor({
  projectId,
  bbox,
  point,
}: {
  projectId: string;
  bbox: BBox | null;
  point: [number, number] | null;
}) {
  const t = useTranslations("Admin");
  const container = useRef<HTMLDivElement>(null);
  const [lngLat, setLngLat] = useState<[number, number] | null>(point);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!container.current) return;
    let map: MapLibreMap | undefined;
    let cancelled = false;
    void import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !container.current) return;
      maplibregl.setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);
      const start: [number, number] =
        point ?? (bbox ? [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] : [0, 0]);
      const m = new maplibregl.Map({
        container: container.current,
        style: STYLE_URL,
        center: start,
        zoom: point ? 16 : 12,
      });
      map = m;
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      const marker: Marker = new maplibregl.Marker({ draggable: true }).setLngLat(start).addTo(m);
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        setLngLat([p.lng, p.lat]);
      });
      m.on("click", (e) => {
        marker.setLngLat(e.lngLat);
        setLngLat([e.lngLat.lng, e.lngLat.lat]);
      });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [bbox, point]);

  const save = () => {
    if (!lngLat) return;
    startTransition(async () => {
      try {
        await locateAction(projectId, lngLat[0], lngLat[1]);
        setMessage(t("saved"));
      } catch (e) {
        setMessage(t("error", { message: e instanceof Error ? e.message : String(e) }));
      }
    });
  };

  return (
    <div className="location-editor">
      <p className="meta">{t("dragHint")}</p>
      <div ref={container} className="editor-map" />
      <p>
        <button type="button" onClick={save} disabled={!lngLat || pending}>
          {t("saveLocation")}
        </button>{" "}
        {lngLat ? `${lngLat[1].toFixed(6)}, ${lngLat[0].toFixed(6)}` : null}{" "}
        <span role="status">{message}</span>
      </p>
    </div>
  );
}
