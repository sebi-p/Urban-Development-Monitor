import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { adminLogin, auth } from "@/auth";
import { AppBar } from "@/components/AppBar";
import { signInAction, signOutAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Admin");
  if (!process.env.AUTH_SECRET || !process.env.AUTH_GITHUB_ID) {
    return (
      <>
        <AppBar />
        <main className="mx-auto max-w-5xl p-4">
          <h1 className="mb-2 text-2xl font-semibold">{t("title")}</h1>
          <p className="text-slate-600">{t("notConfigured")}</p>
        </main>
      </>
    );
  }
  const session = await auth();
  const login = await adminLogin();
  return (
    <>
      <AppBar
        actions={
          login ? (
            <form action={signOutAction} className="flex items-center gap-2 text-sm text-slate-600">
              <span className="hidden sm:inline">{t("signedInAs", { login })}</span>
              <button
                type="submit"
                className="inline-flex min-h-9 items-center rounded-full border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-100"
              >
                {t("signOut")}
              </button>
            </form>
          ) : null
        }
      />
      <main className="mx-auto max-w-5xl p-4">
        <h1 className="mb-4 text-2xl font-semibold">
          <Link href="/admin" className="text-slate-900">
            {t("title")}
          </Link>
        </h1>
        {login ? (
          children
        ) : session ? (
          <p className="text-slate-600">{t("notAllowed")}</p>
        ) : (
          <form
            action={signInAction}
            className="max-w-md rounded-[var(--radius-card)] border border-slate-200 bg-white p-6 shadow-[var(--shadow-card)]"
          >
            <p className="mb-4 text-slate-600">{t("intro")}</p>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-full bg-accent-700 px-4 text-sm font-medium text-white hover:bg-accent-800"
            >
              {t("signIn")}
            </button>
          </form>
        )}
      </main>
    </>
  );
}
