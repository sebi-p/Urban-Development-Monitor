"use client";

import { ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Snap = "peek" | "half" | "full";
const ORDER: Snap[] = ["peek", "half", "full"];

/**
 * Phones: a sheet over the full-screen map, dragged by its handle between three heights (peek,
 * half, full), or toggled with the button. Wide screens: the same content as a floating side
 * panel (CSS only). A link to a list entry (`#p-<slug>`, e.g. from a map popup) opens it full.
 * Without JavaScript the content is still in the page and scrolls.
 */
export function BottomSheet({
  title,
  toolbar,
  children,
}: {
  title: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("Sheet");
  const [snap, setSnap] = useState<Snap>("peek");
  const drag = useRef<{ y: number; snap: Snap } | null>(null);

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#p-")) setSnap("full");
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const step = (dir: 1 | -1, from: Snap = snap) =>
    ORDER[Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(from) + dir))]!;

  return (
    <aside
      data-snap={snap}
      aria-label={t("label")}
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[var(--radius-sheet)] bg-white shadow-[var(--shadow-panel)] transition-[height] duration-300 ease-out motion-reduce:transition-none",
        snap === "peek" && "h-44",
        snap === "half" && "h-[55dvh]",
        snap === "full" && "h-[calc(100dvh-var(--app-bar-height))]",
        // Wide screens: a floating panel on the left, always fully open.
        "lg:absolute lg:inset-y-4 lg:left-4 lg:right-auto lg:h-auto! lg:w-[26rem] lg:rounded-[var(--radius-sheet)] lg:transition-none",
      )}
    >
      <div
        data-handle
        className="flex touch-none flex-col items-center pt-2 pb-1 lg:hidden"
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, snap };
          try {
            e.currentTarget.setPointerCapture(e.pointerId); // keep the drag when the finger leaves
          } catch {
            // an unknown pointer id: the drag still works while over the handle
          }
        }}
        onPointerUp={(e) => {
          const start = drag.current;
          drag.current = null;
          if (!start) return;
          const dy = e.clientY - start.y;
          if (Math.abs(dy) > 30) setSnap(step(dy < 0 ? 1 : -1, start.snap));
        }}
      >
        <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
      </div>
      <div className="flex min-h-11 items-center gap-2 px-4 pt-1 lg:pt-4">
        <div className="min-w-0 flex-1">{title}</div>
        <button
          type="button"
          onClick={() => setSnap(snap === "full" ? "peek" : "full")}
          aria-expanded={snap === "full"}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 lg:hidden"
        >
          <ChevronUp
            aria-hidden
            className={cn("size-4 transition-transform", snap === "full" && "rotate-180")}
          />
          {snap === "full" ? t("showMap") : t("showList")}
        </button>
      </div>
      {toolbar ? <div className="px-4 pt-1 pb-3">{toolbar}</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">{children}</div>
    </aside>
  );
}
