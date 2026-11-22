import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { isAdmin } from "@/lib/allow-list";

/**
 * GitHub login for /admin (ADR 0012). Sessions are signed JWT cookies (no session tables).
 * Credentials come from AUTH_GITHUB_ID, AUTH_GITHUB_SECRET and AUTH_SECRET; the allow-list from
 * ADMIN_GITHUB_LOGINS. Sign-in is refused for anyone not on the list.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  trustHost: true,
  callbacks: {
    signIn({ profile }) {
      return isAdmin(typeof profile?.login === "string" ? profile.login : null);
    },
    jwt({ token, profile }) {
      if (typeof profile?.login === "string") token.login = profile.login;
      return token;
    },
    session({ session, token }) {
      return { ...session, login: typeof token.login === "string" ? token.login : null };
    },
  },
});

/** The signed-in reviewer's GitHub login, or null when not signed in or not on the list. */
export async function adminLogin(): Promise<string | null> {
  const session = (await auth()) as { login?: string | null } | null;
  const login = session?.login ?? null;
  return isAdmin(login) ? login : null;
}
