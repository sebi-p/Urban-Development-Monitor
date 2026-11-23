import type { ConsultationItem } from "@mdu/db";
import { CalendarClock, Mail, MapPin, MessagesSquare, Users } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ConsultationState } from "@/lib/consultation";
import { cn } from "@/lib/utils";

function isoDay(d: string) {
  return new Date(`${d}T12:00:00`);
}

/**
 * How residents can take part (PLAN §8): the deadline and days left, where to send comments,
 * what to write, and the public meeting. Every value comes from the official notice, linked.
 */
export function ConsultationBox({
  consultation: c,
  status,
  projectTitle,
}: {
  consultation: ConsultationItem;
  status: ConsultationState;
  projectTitle: string;
}) {
  const t = useTranslations("Project");
  const format = useFormatter();
  const day = (d: string) => format.dateTime(isoDay(d), { dateStyle: "long" });
  const active = status.state === "open" || status.state === "upcoming";
  return (
    <section
      aria-labelledby="consultation-heading"
      className={cn(
        "consultation rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]",
        active
          ? "border-status-consultation/40 bg-status-consultation/5"
          : "border-slate-200 bg-white",
      )}
      data-state={status.state}
    >
      <h2 id="consultation-heading" className="flex items-center gap-2 text-base font-semibold">
        <MessagesSquare aria-hidden className="size-5 text-status-consultation" />
        {t("consultationHeading")}
      </h2>
      <p className="mt-2 text-lg font-semibold text-slate-900">
        {status.state === "open" && t("consultationOpen", { date: day(status.closesOn) })}
        {status.state === "upcoming" && t("consultationUpcoming", { date: day(status.opensOn) })}
        {status.state === "closed" && t("consultationClosed", { date: day(status.closesOn) })}
        {status.state === "unknown" && t("consultationNoDates")}
      </p>
      {status.state === "open" && (
        <p className="days-left mt-0.5 text-sm font-medium text-status-consultation-text">
          {t("daysLeft", { count: status.daysLeft })}
        </p>
      )}
      {c.opensOn && c.closesOn && (
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
          <CalendarClock aria-hidden className="size-4 text-slate-400" />
          {t("period", { from: day(c.opensOn), to: day(c.closesOn) })}
        </p>
      )}

      {active && (c.submitEmail || c.submitAddress) && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">{t("sendHeading")}</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {c.submitEmail && (
              <li className="flex items-center gap-2">
                <Mail aria-hidden className="size-4 shrink-0 text-slate-400" />
                <span className="sr-only">{t("email")}: </span>
                <a
                  href={`mailto:${c.submitEmail}?subject=${encodeURIComponent(projectTitle)}`}
                  className="font-medium break-all"
                >
                  {c.submitEmail}
                </a>
              </li>
            )}
            {c.submitAddress && (
              <li className="flex items-start gap-2">
                <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <span>
                  <span className="sr-only">{t("address")}: </span>
                  {c.submitAddress}
                </span>
              </li>
            )}
          </ul>
          {c.submitInstructions && (
            <p className="mt-2 text-sm text-slate-600">„{c.submitInstructions}”</p>
          )}
          <h3 className="mt-4 text-sm font-semibold text-slate-900">{t("writeHeading")}</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>{t("writeProject", { title: projectTitle })}</li>
            <li>{t("writeYou")}</li>
            <li>{t("writeComments")}</li>
          </ul>
        </div>
      )}

      {c.publicMeetingAt && (
        <p className="mt-4 flex items-start gap-2 text-sm">
          <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <span>
            <span className="font-semibold">{t("meeting")}: </span>
            {format.dateTime(new Date(c.publicMeetingAt), {
              dateStyle: "long",
              timeStyle: "short",
            })}
            {c.publicMeetingPlace ? `, ${c.publicMeetingPlace}` : ""}
          </span>
        </p>
      )}

      {c.sourceUrl && (
        <p className="mt-4 text-xs text-slate-500">
          <a
            href={c.page ? `${c.sourceUrl}#page=${c.page}` : c.sourceUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {c.page ? t("fromNoticePage", { page: c.page }) : t("fromNotice")}
          </a>
        </p>
      )}
    </section>
  );
}
