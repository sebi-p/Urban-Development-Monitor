import type { MapIndex } from "@mdu/db";
import { useEffect, useSyncExternalStore } from "react";

/**
 * The map index in the browser (M5.7): fetched once per city and kept for the session, so going
 * back to the map, or changing a filter, needs no request.
 */
const loaded = new Map<string, MapIndex>();
const pending = new Map<string, Promise<void>>();
const subscribers = new Set<() => void>();

export function loadIndex(city: string): Promise<void> {
  if (loaded.has(city)) return Promise.resolve();
  let p = pending.get(city);
  if (!p) {
    p = fetch(`/api/${encodeURIComponent(city)}/map.json`)
      .then((r) =>
        r.ok ? (r.json() as Promise<MapIndex>) : Promise.reject(new Error(r.statusText)),
      )
      .then((index) => {
        loaded.set(city, index);
        for (const s of subscribers) s();
      })
      .catch(() => {
        pending.delete(city); // try again on the next mount; the server's view stays meanwhile
      });
    pending.set(city, p);
  }
  return p;
}

const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

/** The city's index, or null while it loads (and during hydration, to match the server). */
export function useIndex(city: string): MapIndex | null {
  useEffect(() => void loadIndex(city), [city]);
  return useSyncExternalStore(
    subscribe,
    () => loaded.get(city) ?? null,
    () => null,
  );
}
