import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ProsePage, Section } from "@/components/Prose";
import { alternates } from "@/lib/locale";

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

export default async function MethodPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Method");
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
      <Section heading={t("limitsHeading")}>
        <p>{t("limits")}</p>
      </Section>
    </ProsePage>
  );
}
