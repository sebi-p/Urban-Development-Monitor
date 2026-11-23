import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { siteUrl } from "@/lib/site";
import "./globals.css";

// Self-hosted by Next at build time; latin-ext carries ș, ț, ă, â, î.
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Home");
  return {
    metadataBase: siteUrl(),
    title: { default: t("title"), template: `%s · ${t("title")}` },
    description: t("tagline"),
  };
}

export const viewport: Viewport = { themeColor: "#0f766e", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
