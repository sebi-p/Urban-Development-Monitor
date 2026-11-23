import type { AuditResults } from "@mdu/db";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ProsePage, Section } from "@/components/Prose";
import { publishedAccuracy } from "@/lib/audit";
import { alternates } from "@/lib/locale";

// Rendered per request, never at build time (the build has no database); the published audit is
// cached for an hour, and publishing one refreshes it (lib/audit.ts).
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Method" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: alternates(locale, "/metodologie"),
  };
}

const STEPS = ["step1", "step2", "step3", "step4", "step5", "step6", "step7", "step8"] as const;
const bold = (chunks: ReactNode) => <strong className="font-semibold">{chunks}</strong>;

/** The latest published accuracy audit of a city (M5.2), as a table. */
async function Accuracy({ city, results }: { city: string; results: AuditResults | null }) {
  const t = await getTranslations("Method");
  const f = await getFormatter();
  if (!results) return <p>{t("accuracyNone")}</p>;
  const pct = (x: number | null) =>
    x === null ? "—" : f.number(x, { style: "percent", maximumFractionDigits: 0 });
  return (
    <>
      <p>
        {t("accuracyIntro", {
          projects: results.projects,
          date: f.dateTime(new Date(results.publishedAt), { dateStyle: "long" }),
        })}
      </p>
      <div className="overflow-x-auto">
        <table
          data-city={city}
          className="accuracy w-full border-collapse text-sm [&_tbody_td]:border-b [&_tbody_td]:border-slate-200 [&_tbody_th]:border-b [&_tbody_th]:border-slate-200 [&_tbody_th]:font-normal [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_thead_th]:border-b [&_thead_th]:border-slate-300 [&_thead_th]:font-semibold"
        >
          <thead>
            <tr>
              <th scope="col">{t("accuracyField")}</th>
              <th scope="col">{t("accuracyCorrect")}</th>
              <th scope="col">{t("accuracyChecked")}</th>
              <th scope="col">{t("accuracyRange")}</th>
              <th scope="col">{t("accuracyTarget")}</th>
            </tr>
          </thead>
          <tbody>
            {results.fields.map((r) => (
              <tr key={r.field}>
                <th scope="row">{t(`accuracy_${r.field}`)}</th>
                <td className="font-semibold tabular-nums">{pct(r.accuracy)}</td>
                <td className="tabular-nums">
                  {r.correct}/{r.checked}
                </td>
                <td className="tabular-nums">
                  {pct(r.low)}–{pct(r.high)}
                </td>
                <td className="tabular-nums">{r.target === null ? "—" : `≥ ${pct(r.target)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function MethodPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Method");
  const { cities, results } = await publishedAccuracy();
  return (
    <ProsePage heading={t("heading")} intro={t("intro")}>
      <Section heading={t("stepsHeading")}>
        <ol className="list-decimal space-y-2 pl-5">
          {STEPS.map((s) => (
            <li key={s}>{t.rich(s, { b: bold })}</li>
          ))}
        </ol>
      </Section>
      <Section heading={t("aiHeading")}>
        <p>{t("ai")}</p>
      </Section>
      <Section heading={t("areasHeading")}>
        <p>{t("areas")}</p>
      </Section>
      <Section heading={t("accuracyHeading")}>
        {cities.map((c, i) => (
          <div key={c.slug} className="space-y-3">
            {cities.length > 1 && <h3 className="font-semibold">{c.name}</h3>}
            <Accuracy city={c.slug} results={results[i] ?? null} />
          </div>
        ))}
      </Section>
      <Section heading={t("limitsHeading")}>
        <p>{t("limits")}</p>
      </Section>
    </ProsePage>
  );
}
