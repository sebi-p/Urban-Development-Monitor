import { NextIntlClientProvider } from "next-intl";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "@/app/globals.css";

// Self-hosted by Next at build time; latin-ext carries ș, ț, ă, â, î.
const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

/** The `<html>` shell shared by the public pages (`app/[locale]`) and the admin area. */
export function Document({ locale, children }: { locale: string; children: ReactNode }) {
  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
