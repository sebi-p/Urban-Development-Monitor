"use client";

import { useEffect } from "react";
import { HIGHLIGHT, SHEET, SHOW, send } from "@/lib/map-events";

const CARD = ".project-list > li[data-slug]";

/**
 * Hovering or focusing a card highlights its pin; "Arată pe hartă" shows the pin with its popup
 * and, on phones, lowers the sheet so the map is visible. Delegated from the document, so it
 * works for every card the server rendered. Mouse hover counts only where the pointer really
 * hovers: on a phone a tap sends a synthetic mouseover to whatever card lands under the finger
 * (e.g. when the sheet opens), and re-filtering the map then delays the sheet.
 */
export function ListMapBridge() {
  useEffect(() => {
    const cardOf = (t: EventTarget | null) =>
      t instanceof Element ? (t.closest(CARD) as HTMLElement | null) : null;
    const hovers = window.matchMedia("(hover: hover)");
    const enter = (e: Event) => {
      if (e.type === "mouseover" && !hovers.matches) return;
      const card = cardOf(e.target);
      if (card?.dataset.located) send(HIGHLIGHT, { slug: card.dataset.slug });
    };
    const leave = (e: Event) => {
      if (e.type === "mouseout" && !hovers.matches) return;
      const from = cardOf(e.target);
      const to = cardOf((e as MouseEvent | FocusEvent).relatedTarget);
      if (from && from !== to) send(HIGHLIGHT, { slug: null });
    };
    const click = (e: MouseEvent) => {
      const button = e.target instanceof Element ? e.target.closest("[data-show-on-map]") : null;
      if (!(button instanceof HTMLElement)) return;
      e.preventDefault();
      if (!window.matchMedia("(min-width: 1024px)").matches) send(SHEET, { snap: "peek" });
      send(SHOW, { slug: button.dataset.showOnMap });
    };
    document.addEventListener("mouseover", enter);
    document.addEventListener("focusin", enter);
    document.addEventListener("mouseout", leave);
    document.addEventListener("focusout", leave);
    document.addEventListener("click", click);
    return () => {
      document.removeEventListener("mouseover", enter);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("mouseout", leave);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("click", click);
    };
  }, []);
  return null;
}
