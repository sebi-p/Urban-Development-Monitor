/**
 * The list and the map talk through window events, so the server-rendered cards need no client
 * code of their own (components/ListMapBridge.tsx sends, ProjectMap and BottomSheet listen).
 */
export const HIGHLIGHT = "mdu:highlight"; // detail: { slug: string | null }
export const SHOW = "mdu:show"; // detail: { slug: string }
export const SHEET = "mdu:sheet"; // detail: { snap: "peek" | "half" | "full" }

export function send<T>(name: string, detail: T): void {
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export function listen<T>(name: string, fn: (detail: T) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<T>).detail);
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}
