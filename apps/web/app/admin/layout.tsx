import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { adminLogin, auth } from "@/auth";
import { signInAction, signOutAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("Admin");
  if (!process.env.AUTH_SECRET || !process.env.AUTH_GITHUB_ID) {
    return (
      <main className="page admin">
        <h1>{t("title")}</h1>
        <p>{t("notConfigured")}</p>
      </main>
    );
  }
  const session = await auth();
  const login = await adminLogin();
  return (
    <main className="page admin">
      <header className="admin-header">
        <h1>
          <Link href="/admin">{t("title")}</Link>
        </h1>
        {login ? (
          <form action={signOutAction}>
            <span>{t("signedInAs", { login })}</span> <button type="submit">{t("signOut")}</button>
          </form>
        ) : null}
      </header>
      {login ? (
        children
      ) : session ? (
        <p>{t("notAllowed")}</p>
      ) : (
        <form action={signInAction}>
          <p>{t("intro")}</p>
          <button type="submit">{t("signIn")}</button>
        </form>
      )}
    </main>
  );
}
