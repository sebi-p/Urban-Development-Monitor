import type { ProjectEventItem } from "@mdu/db";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export interface TimelineItem extends ProjectEventItem {
  /** A date still to come (the comments deadline), drawn hollow. */
  upcoming?: boolean;
  /** Shown instead of the event type's name. */
  label?: string;
}

/** Events oldest first, each with its date, what happened and the page it was read from. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  const t = useTranslations("Project");
  const type = useTranslations("EventType");
  const format = useFormatter();
  return (
    <ol className="timeline relative ml-2 border-l-2 border-slate-200">
      {items.map((e, i) => (
        <li key={`${e.date}-${i}`} className="relative pb-5 pl-5 last:pb-0">
          <span
            aria-hidden
            className={cn(
              "absolute top-1.5 -left-[7px] size-3 rounded-full ring-4 ring-slate-50",
              e.upcoming ? "border-2 border-status-consultation bg-white" : "bg-accent-700",
            )}
          />
          <p className="text-xs font-medium text-slate-500">
            <time dateTime={e.date}>
              {format.dateTime(new Date(`${e.date}T12:00:00`), { dateStyle: "long" })}
            </time>
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">{e.label ?? type(e.type)}</p>
          {e.title && e.title !== (e.label ?? type(e.type)) && (
            <p className="text-sm text-slate-600">
              {e.title}
              {e.sourceUrl && (
                <>
                  {" · "}
                  <a href={e.sourceUrl} rel="noopener noreferrer" target="_blank">
                    {t("eventSource")}
                  </a>
                </>
              )}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
