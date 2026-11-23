import type { ProjectStatus } from "@mdu/shared";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppBar } from "@/components/AppBar";
import { ProjectList } from "@/components/ProjectList";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GROUP_COLOUR, GROUP_ICON, GROUP_TEXT, STATUS_GROUP, type StatusGroup } from "@/lib/status";

export const metadata: Metadata = { title: "Stil", robots: { index: false, follow: false } };

// Full class names: Tailwind only generates classes it finds written out in the source.
const ACCENT = [
  ["50", "bg-accent-50"], ["100", "bg-accent-100"], ["200", "bg-accent-200"],
  ["600", "bg-accent-600"], ["700", "bg-accent-700"], ["800", "bg-accent-800"],
  ["900", "bg-accent-900"],
] as const; // prettier-ignore
const NEUTRAL = [
  ["50", "bg-slate-50"], ["100", "bg-slate-100"], ["200", "bg-slate-200"],
  ["300", "bg-slate-300"], ["500", "bg-slate-500"], ["600", "bg-slate-600"],
  ["700", "bg-slate-700"], ["900", "bg-slate-900"],
] as const; // prettier-ignore
const ONE_PER_GROUP = Object.entries(STATUS_GROUP).filter(
  ([, g], i, all) => all.findIndex(([, h]) => h === g) === i,
) as [ProjectStatus, StatusGroup][];

/** Live style guide (M4.0): every token and component as the app renders it. */
export default async function StylePage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("Style");
  const h2 = "mt-10 mb-3 text-lg font-semibold";
  return (
    <>
      <AppBar />
      <main className="mx-auto max-w-4xl p-4 pb-16">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-slate-600">{t("intro")}</p>

        <h2 className={h2}>{t("colours")}</h2>
        <p className="mb-2 text-sm text-slate-600">{t("accent")}</p>
        <div className="flex flex-wrap gap-2">
          {ACCENT.map(([s, bg]) => (
            <div key={s} className="text-center text-xs">
              <div className={`size-14 rounded-xl border border-slate-200 ${bg}`} />
              accent-{s}
            </div>
          ))}
        </div>
        <p className="mt-4 mb-2 text-sm text-slate-600">{t("neutral")}</p>
        <div className="flex flex-wrap gap-2">
          {NEUTRAL.map(([s, bg]) => (
            <div key={s} className="text-center text-xs">
              <div className={`size-14 rounded-xl border border-slate-200 ${bg}`} />
              slate-{s}
            </div>
          ))}
        </div>
        <p className="mt-4 mb-2 text-sm text-slate-600">{t("status")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ONE_PER_GROUP.map(([status, group]) => {
            const Icon = GROUP_ICON[group];
            return (
              <div
                key={group}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2"
              >
                <span
                  className="grid size-9 place-items-center rounded-full text-white"
                  style={{ background: GROUP_COLOUR[group] }}
                >
                  <Icon aria-hidden className="size-4.5" />
                </span>
                <StatusBadge status={status} />
                <code className="ml-auto text-xs text-slate-500">
                  {GROUP_COLOUR[group]} / {GROUP_TEXT[group]}
                </code>
              </div>
            );
          })}
        </div>

        <h2 className={h2}>{t("type")}</h2>
        <div className="space-y-2 rounded-[var(--radius-card)] bg-white p-4 shadow-[var(--shadow-card)]">
          <p className="text-3xl font-semibold">Aa · 30 / semibold</p>
          <p className="text-xl font-semibold">Aa · 20 / semibold</p>
          <p className="text-base font-semibold">Aa · 16 / semibold</p>
          <p className="text-base">{t("sample")} · 16</p>
          <p className="text-sm text-slate-600">{t("sample")} · 14</p>
          <p className="text-xs text-slate-500">{t("sample")} · 12</p>
        </div>

        <h2 className={h2}>{t("components")}</h2>
        <h3 className="mb-2 text-sm font-semibold">{t("buttons")}</h3>
        <div className="flex flex-wrap gap-2">
          <Button>{t("primary")}</Button>
          <Button variant="secondary">{t("secondary")}</Button>
          <Button variant="ghost">{t("ghost")}</Button>
          <Button variant="danger">{t("danger")}</Button>
          <Button size="sm" variant="secondary">
            sm
          </Button>
        </div>
        <h3 className="mt-6 mb-2 text-sm font-semibold">{t("chips")}</h3>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex min-h-9 items-center rounded-full border border-accent-700 bg-accent-700 px-3 text-sm font-medium text-white">
            {t("chipOn")}
          </span>
          <span className="inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700">
            {t("chipOff")}
          </span>
        </div>
        <h3 className="mt-6 mb-2 text-sm font-semibold">{t("badges")}</h3>
        <div className="flex flex-wrap gap-2">
          <Badge>PUZ</Badge>
          <Badge className="rounded-md bg-slate-100 font-normal">POT 35%</Badge>
          <StatusBadge status="in_public_consultation" />
        </div>
        <h3 className="mt-6 mb-2 text-sm font-semibold">{t("card")}</h3>
        <ProjectList
          city="stil"
          projects={[
            {
              id: "sample",
              slug: "exemplu",
              title: "PUZ Ansamblu de locuințe colective, Strada Lungă",
              kind: "puz",
              status: "in_public_consultation",
              address: "Strada Lungă nr. 5",
              geomPrecision: "parcel",
              hasLocation: true,
              eventDate: "2026-11-03",
              eventTitle: null,
              sourceUrl: null,
              documents: [{ label: "05. Memoriu", url: "#", size_bytes: null, role: "memoriu" }],
              initiator: "SC EXEMPLU SRL",
              indicators: {
                height_regime: {
                  value: "P+4E+R",
                  source_document_id: "x",
                  page: 2,
                  confidence: "medium",
                },
                pot_percent: { value: 35, source_document_id: "x", page: 2, confidence: "medium" },
              },
            },
          ]}
        />
      </main>
    </>
  );
}
