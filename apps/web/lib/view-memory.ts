import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Where the reader was on the map page (M5.7): the map's view, the sheet's height, the list's
 * scroll and how many cards were shown, per URL, for this tab only. Going back to the map
 * restores it instead of starting over. Storage can be missing (private mode): then nothing is
 * remembered and the page works as before.
 */
export interface View {
  center?: [number, number];
  zoom?: number;
  snap?: "peek" | "half" | "full";
  scroll?: number;
  shown?: number;
}

const key = () => `mdu:view:${window.location.pathname}${window.location.search}`;

export function readView(): View | null {
  try {
    const raw = window.sessionStorage.getItem(key());
    return raw ? (JSON.parse(raw) as View) : null;
  } catch {
    return null;
  }
}

export function saveView(patch: View): void {
  try {
    window.sessionStorage.setItem(key(), JSON.stringify({ ...readView(), ...patch }));
  } catch {
    // storage full or blocked: forget it
  }
}

/** A filter change: the URL changes, and the view so far carries over to the new URL. */
export function moveView(from: string): void {
  try {
    const raw = window.sessionStorage.getItem(`mdu:view:${from}`);
    if (raw) window.sessionStorage.setItem(key(), raw);
  } catch {
    // as above
  }
}

/**
 * Replace the URL's query without a request: Next keeps `useSearchParams` in step with the
 * native history API. The remembered view follows the URL.
 */
export function replaceQuery(query: string): void {
  const from = `${window.location.pathname}${window.location.search}`;
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(null, "", url);
  moveView(from);
}

// The view as it was when the page opened: read once per visit, so the reader's own changes
// (saved as they happen) don't feed back into it.
let opened: { raw: string | null } | null = null;
const snapshot = () => {
  if (!opened) {
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(key());
    } catch {
      // no storage: nothing to restore
    }
    opened = { raw };
  }
  return opened.raw;
};
const subscribeNever = () => () => {};

/** The saved view for this page, or null (always null in the server render and hydration). */
export function useSavedView(): View | null {
  const raw = useSyncExternalStore(subscribeNever, snapshot, () => null);
  useEffect(
    () => () => {
      opened = null; // the next visit reads again
    },
    [],
  );
  return useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as View) : null;
    } catch {
      return null;
    }
  }, [raw]);
}
