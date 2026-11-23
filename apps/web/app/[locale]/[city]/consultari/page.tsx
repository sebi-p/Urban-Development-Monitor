import { getJurisdiction, listConsultations, type ConsultationListItem } from "@mdu/db";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CalendarClock, FileText, Mail, Rss } from "lucide-react";
import { AppBar } from "@/components/AppBar";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { StatusBadge } from "@/components/StatusBadge";
import { Link } from "@/i18n/navigation";
import { consultationState, today, type ConsultationState } from "@/lib/consultation";
import { getDb } from "@/lib/db";
import { alternates } from "@/lib/locale";
import { projectPath } from "@/lib/project";

// The list changes once a day (the morning run) and "days left" once a day: 5 minutes is plenty.
export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ locale: string; city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, city } = await params;
  setRequestLocale(locale);
  const j = await getJurisdiction(getDb(), city);
  if (!j) return {};
  const t = await getTranslations("Consultations");
  return {
    title: t("title", { city: j.name }),
    description: t("intro"),
    alternates: alternates(locale, `/${city}/consultari`, { city, title: j.name }),
  };
}

type Row = ConsultationListItem & { state: ConsultationState };

function pageLink(url: string, page: number | null) {
  return page ? `${url}#page=${page}` : url;
}

async function Current({ city, row }: { city: string; row: Row }) {
  const t = await getTranslations("Consultations");
  const p = await getTranslations("Project");
  const kind = await getTranslations("Kind");
  const f = await getFormatter();
  const date = (d: string) => f.dateTime(new Date(`${d}T12:00:00`), { dateStyle: "long" });
  const s = row.state;
  return (
    <li
      data-state={s.state}
      className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={row.project.status} />
        <span className="text-xs text-slate-500">
          {kind(row.project.kind)}
          {row.neighbourhood ? ` · ${row.neighbourhood}` : ""}
        </span>
      </div>
      <h3 className="mt-2 text-base leading-snug font-semibold">
        <Link href={projectPath(city, row.project.slug)} className="text-slate-900">
          {row.project.title}
        </Link>
      </h3>
      <p className="mt-2 text-sm font-medium text-slate-800">
        <CalendarClock aria-hidden className="mr-1.5 inline size-4 align-[-3px] text-accent-700" />
        {s.state === "open" && (
          <>
            {p("consultationOpen", { date: date(s.closesOn) })}{" "}
            <span className="days-left font-semibold text-[var(--color-status-consultation-text)]">
              · {p("daysLeft", { count: s.daysLeft })}
            </span>
          </>
        )}
        {s.state === "upcoming" && p("consultationUpcoming", { date: date(s.opensOn) })}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {row.submitEmail && (
          <li>
            <a href={`mailto:${row.submitEmail}`} className="inline-flex items-center gap-1">
              <Mail aria-hidden className="size-3.5" />
              {row.submitEmail}
            </a>
          </li>
        )}
        <li>
          <Link href={projectPath(city, row.project.slug)}>{t("howToComment")}</Link>
        </li>
        {row.sourceUrl && (
          <li>
            <a href={pageLink(row.sourceUrl, row.page)} className="inline-flex items-center gap-1">
              <FileText aria-hidden className="size-3.5" />
              {t("notice")}
            </a>
          </li>
        )}
      </ul>
    </li>
  );
}

export default async function ConsultationsPage({ params }: Props) {
  const { locale, city } = await params;
  setRequestLocale(locale);
  const db = getDb();
  const j = await getJurisdiction(db, city);
  if (!j) notFound();
  const all = (await listConsultations(db, city))!;
  const t = await getTranslations("Consultations");
  const f = await getFormatter();
  const day = today(j.timezone);
  const rows: Row[] = all.map((c) => ({ ...c, state: consultationState(c, day) }));
  const current = rows
    .filter((r) => r.state.state === "open" || r.state.state === "upcoming")
    .sort((a, b) => (a.closesOn ?? a.opensOn ?? "").localeCompare(b.closesOn ?? b.opensOn ?? ""));
  const past = rows.filter((r) => r.state.state === "closed");
  const date = (d: string | null) =>
    d ? f.dateTime(new Date(`${d}T12:00:00`), { dateStyle: "medium" }) : "?";

  return (
    <>
      <AppBar
        city={{ slug: city, name: j.name }}
        actions={<SiteNav city={city} current="consultations" />}
      />
      <main className="mx-auto max-w-3xl px-4 pt-5 pb-12">
        <h1 className="text-2xl font-bold">{t("heading")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("intro")}</p>

        <section aria-labelledby="open-heading" className="mt-6">
          <h2 id="open-heading" className="text-lg font-semibold">
            {t("openHeading")}
          </h2>
          {current.length ? (
            <ul className="open-list mt-3 space-y-3">
              {current.map((r) => (
                <Current key={`${r.project.slug}-${r.closesOn}-${r.opensOn}`} city={city} row={r} />
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl bg-white p-5 text-sm text-slate-600">
              {t("noneOpen")}{" "}
              <Link
                href={`/${city}/feed.xml`}
                prefetch={false}
                className="inline-flex items-center gap-1"
              >
                <Rss aria-hidden className="size-3.5" />
                {t("follow")}
              </Link>
            </p>
          )}
        </section>

        <section aria-labelledby="past-heading" className="mt-8">
          <h2 id="past-heading" className="text-lg font-semibold">
            {t("pastHeading")}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t("pastIntro")}</p>
          {past.length > 0 && (
            <ul className="past-list mt-3 divide-y divide-slate-200 rounded-[var(--radius-card)] border border-slate-200 bg-white">
              {past.map((r) => (
                <li key={`${r.project.slug}-${r.closesOn}-${r.opensOn}`} className="p-4">
                  <Link
                    href={projectPath(city, r.project.slug)}
                    className="font-medium text-slate-900"
                  >
                    {r.project.title}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("period", { from: date(r.opensOn), to: date(r.closesOn) })}
                    {r.neighbourhood ? ` · ${r.neighbourhood}` : ""}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {r.sourceUrl && <a href={pageLink(r.sourceUrl, r.page)}>{t("notice")}</a>}
                    {r.reports.map((url, i) => (
                      <a key={url} href={url} className="report">
                        {t("report", { n: r.reports.length > 1 ? i + 1 : 0 })}
                      </a>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {!past.length && <p className="mt-3 text-sm text-slate-600">{t("nonePast")}</p>}
        </section>
      </main>
      <SiteFooter city={city} />
    </>
  );
}
