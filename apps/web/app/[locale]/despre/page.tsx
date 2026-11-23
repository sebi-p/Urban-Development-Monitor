import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { ProsePage, Section } from "@/components/Prose";
import { alternates } from "@/lib/locale";
import { CONTACT_EMAIL } from "@/lib/site";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  return { title: t("title"), description: t("intro"), alternates: alternates(locale, "/despre") };
}

const out = (href: string) => (chunks: ReactNode) => <a href={href}>{chunks}</a>;

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("About");
  return (
    <ProsePage heading={t("heading")} intro={t("intro")}>
      <Section heading={t("whoHeading")}>
        <p>{t("who")}</p>
      </Section>
      <Section heading={t("sourcesHeading")}>
        <p>{t("sources")}</p>
      </Section>
      <Section heading={t("privacyHeading")}>
        <p>{t("privacy")}</p>
      </Section>
      <Section heading={t("errorsHeading")}>
        <p>
          {t.rich("errors", {
            email: () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>,
          })}
        </p>
      </Section>
      <Section heading={t("licenceHeading")}>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            {t.rich("licenceData", { cc: out("https://creativecommons.org/licenses/by/4.0/") })}
          </li>
          <li>
            {t.rich("licenceCode", { agpl: out("https://www.gnu.org/licenses/agpl-3.0.html") })}
          </li>
          <li>
            {t.rich("licenceOsm", {
              osm: out("https://www.openstreetmap.org/copyright"),
              odbl: out("https://opendatacommons.org/licenses/odbl/"),
            })}
          </li>
          <li>{t("licenceDocs")}</li>
        </ul>
      </Section>
    </ProsePage>
  );
}
