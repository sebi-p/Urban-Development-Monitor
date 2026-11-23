import type { ReactNode } from "react";
import { AppBar } from "@/components/AppBar";
import { SiteFooter } from "@/components/SiteFooter";

/** A text page (about, method): app bar, a readable column, the footer. */
export function ProsePage({
  heading,
  intro,
  children,
}: {
  heading: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <>
      <AppBar />
      <main className="prose-page mx-auto max-w-2xl px-4 pt-6 pb-12 text-base leading-relaxed text-slate-800">
        <h1 className="text-2xl font-bold sm:text-3xl">{heading}</h1>
        <p className="mt-3 text-lg text-slate-700">{intro}</p>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
