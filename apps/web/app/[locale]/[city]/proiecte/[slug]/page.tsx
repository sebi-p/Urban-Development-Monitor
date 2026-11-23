import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CalendarCheck, ChevronRight, MapPin, Sparkles } from "lucide-react";
import { AppBar } from "@/components/AppBar";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";
import { LocationNote } from "@/components/ProjectList";
import { StatusBadge } from "@/components/StatusBadge";
import { ConsultationBox } from "@/components/project/ConsultationBox";
import { DocumentList } from "@/components/project/DocumentList";
import { KeyFigures } from "@/components/project/KeyFigures";
import { MiniMap } from "@/components/project/MiniMap";
import { Timeline, type TimelineItem } from "@/components/project/Timeline";
import { Card } from "@/components/ui/card";
import { mainConsultation, today } from "@/lib/consultation";
import { Link, permanentRedirect } from "@/i18n/navigation";
import { jsonLdScript, projectJsonLd } from "@/lib/jsonld";
import { alternates, localePath } from "@/lib/locale";
import { loadProject, projectPath } from "@/lib/project";
import { siteUrl } from "@/lib/site";
import { STATUS_COLOURS } from "@/lib/status";

// Rendered on first request, then served from the cache and refreshed at most every 5 minutes.
export const revalidate = 300;
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ locale: string; city: string; slug: string }> };

async function load(locale: string, city: string, slug: string) {
  const { jurisdiction, lookup } = await loadProject(city, slug);
  if (!jurisdiction) notFound();
  if (!lookup.found) {
    if (lookup.redirectTo) {
      permanentRedirect({ href: projectPath(city, lookup.redirectTo), locale });
    }
    notFound();
  }
  return { j: jurisdiction, p: lookup.project };
}

/** The summary in the page's language (English falls back to Romanian). */
function summaryIn(locale: string, p: { summaryRo: string | null; summaryEn: string | null }) {
  return locale === "en" ? (p.summaryEn ?? p.summaryRo) : p.summaryRo;
}

async function describe(locale: string, city: string, slug: string) {
  const { j, p } = await load(locale, city, slug);
  const t = await getTranslations("Project");
  const kind = await getTranslations("Kind");
  return (
    summaryIn(locale, p) ??
    t("metaDescription", { kind: kind(p.kind), city: j.name, title: p.title })
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, city, slug } = await params;
  setRequestLocale(locale);
  const { j, p } = await load(locale, city, slug);
  const description = await describe(locale, city, slug);
  const url = localePath(locale, projectPath(city, slug));
  const t = await getTranslations("Project");
  return {
    title: p.title,
    description,
    alternates: alternates(locale, projectPath(city, slug)),
    openGraph: {
      type: "article",
      url,
      title: p.title,
      description,
      siteName: t("ogSite", { city: j.name }),
      locale: locale === "en" ? "en_GB" : "ro_RO",
      modifiedTime: p.lastCheckedAt,
    },
    twitter: { card: "summary_large_image", title: p.title, description },
  };
}

export default async function ProjectPage({ params }: Props) {
  const { locale, city, slug } = await params;
  setRequestLocale(locale);
  const { j, p } = await load(locale, city, slug);
  const summary = summaryIn(locale, p);
  const t = await getTranslations("Project");
  const kind = await getTranslations("Kind");
  const docType = await getTranslations("DocType");
  const cityT = await getTranslations("City");
  const f = await getFormatter();
  const day = today(j.timezone);
  const main = mainConsultation(p.consultations, day);
  const active = main && (main.status.state === "open" || main.status.state === "upcoming");

  const timeline: TimelineItem[] = [...p.events];
  if (active && main.consultation.closesOn) {
    timeline.push({
      date: main.consultation.closesOn,
      type: "consultation_closed",
      title: "",
      sourceUrl: null,
      upcoming: true,
      label: t("deadline"),
    });
  }
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  const summarySource = p.indicators.summary;
  const summaryDoc = summarySource?.source_url
    ? p.documents.find((d) => d.url === summarySource.source_url)
    : undefined;
  const docLabel = (d: (typeof p.documents)[number]) => d.label ?? docType(d.role ?? "other");
  const base = siteUrl();
  const jsonLd = projectJsonLd(p, {
    url: new URL(localePath(locale, projectPath(city, slug)), base).toString(),
    cityUrl: new URL(localePath(locale, `/${city}`), base).toString(),
    cityName: j.name,
    description: await describe(locale, city, slug),
    kindLabel: kind(p.kind),
    docLabel,
    breadcrumb: t("breadcrumb"),
  });

  return (
    <>
      <AppBar
        city={{ slug: city, name: j.name }}
        actions={<SiteNav city={city} current="other" />}
      />
      <main className="mx-auto max-w-3xl space-y-6 px-4 pt-4 pb-12">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
        />
        <nav aria-label={t("breadcrumb")} className="text-sm">
          <ol className="flex flex-wrap items-center gap-1 text-slate-500">
            <li>
              <Link href={`/${city}`}>{j.name}</Link>
            </li>
            <ChevronRight aria-hidden className="size-3.5" />
            <li>
              <Link href={`/${city}`}>{t("breadcrumb")}</Link>
            </li>
          </ol>
        </nav>

        <header>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} />
            <span className="text-xs text-slate-500">{kind(p.kind)}</span>
          </div>
          <h1 className="mt-2 text-2xl leading-tight font-bold sm:text-3xl">{p.title}</h1>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-600">
            <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-400" />
            <span>
              {p.address ?? cityT("noAddress")}
              {" · "}
              <span className="text-slate-500">
                {p.hasLocation ? <LocationNote p={p} /> : cityT("notOnMap")}
              </span>
            </span>
          </p>
        </header>

        {active && (
          <ConsultationBox
            consultation={main.consultation}
            status={main.status}
            projectTitle={p.title}
          />
        )}

        <Card className="summary">
          <h2 className="text-base font-semibold">{t("summaryHeading")}</h2>
          {summary ? (
            <>
              <p className="mt-2 text-base leading-relaxed text-slate-800">{summary}</p>
              <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Sparkles aria-hidden className="size-3.5 shrink-0" />
                  {t("summaryAuto")}
                </span>
                {summarySource?.source_url && (
                  <a
                    className="source-chip inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700"
                    href={
                      summarySource.page
                        ? `${summarySource.source_url}#page=${summarySource.page}`
                        : summarySource.source_url
                    }
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t("summarySource", {
                      doc: summaryDoc ? docLabel(summaryDoc) : docType("other"),
                      page: summarySource.page ?? 1,
                    })}
                  </a>
                )}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-600">{t("noSummary")}</p>
          )}
        </Card>

        <KeyFigures indicators={p.indicators} />

        <section aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className="mb-3 text-base font-semibold">
            {t("timelineHeading")}
          </h2>
          <Timeline items={timeline} />
        </section>

        {main && !active && (
          <ConsultationBox
            consultation={main.consultation}
            status={main.status}
            projectTitle={p.title}
          />
        )}

        <section aria-labelledby="documents-heading">
          <h2 id="documents-heading" className="mb-3 text-base font-semibold">
            {t("documentsHeading")}
          </h2>
          <DocumentList documents={p.documents} />
        </section>

        <section aria-labelledby="location-heading" className="space-y-3">
          <h2 id="location-heading" className="text-base font-semibold">
            {t("locationHeading")}
          </h2>
          {p.lon !== null && p.lat !== null ? (
            <MiniMap
              lon={p.lon}
              lat={p.lat}
              colour={STATUS_COLOURS[p.status]}
              label={t("mapLabel")}
            />
          ) : (
            <p className="text-sm text-slate-600">{t("notOnMap")}</p>
          )}
          {p.lon !== null && (
            <div>
              <h3 className="text-sm font-semibold">{t("nearbyHeading", { metres: 500 })}</h3>
              {p.nearby.length === 0 ? (
                <p className="mt-1 text-sm text-slate-600">{t("nearbyNone")}</p>
              ) : (
                <ul className="nearby mt-2 space-y-2">
                  {p.nearby.map((n) => (
                    <li key={n.slug}>
                      <Link
                        href={projectPath(city, n.slug)}
                        className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 hover:no-underline"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{n.title}</span>
                          <span className="mt-0.5 flex items-center gap-2">
                            <StatusBadge status={n.status} />
                            <span className="text-xs text-slate-500">{kind(n.kind)}</span>
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {t("metres", { n: n.distanceM })}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="details-heading">
          <h2 id="details-heading" className="mb-2 text-base font-semibold">
            {t("detailsHeading")}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-500">{t("kind")}</dt>
            <dd>{kind(p.kind)}</dd>
            {p.initiator && (
              <>
                <dt className="text-slate-500">{t("initiator")}</dt>
                <dd>{p.initiator}</dd>
              </>
            )}
            {p.designer && (
              <>
                <dt className="text-slate-500">{t("designer")}</dt>
                <dd>{p.designer}</dd>
              </>
            )}
          </dl>
        </section>

        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 pt-4 text-xs text-slate-500">
          <span className="last-checked inline-flex items-center gap-1">
            <CalendarCheck aria-hidden className="size-3.5" />
            {t("lastChecked", {
              date: f.dateTime(new Date(p.lastCheckedAt), { dateStyle: "long" }),
            })}
          </span>
          <span>
            {t("firstSeen", { date: f.dateTime(new Date(p.firstSeenAt), { dateStyle: "long" }) })}
          </span>
          <Link href={`/${city}`} className="ml-auto">
            {t("backToMap")}
          </Link>
        </footer>
      </main>
      <SiteFooter city={city} />
    </>
  );
}
