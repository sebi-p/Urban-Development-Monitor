/** GitHub logins allowed into /admin, from ADMIN_GITHUB_LOGINS ("alice,bob"). Case-insensitive;
 * an empty or missing list lets nobody in. */
export function adminLogins(
  env: string | undefined = process.env.ADMIN_GITHUB_LOGINS,
): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdmin(login: string | null | undefined, env?: string): boolean {
  return Boolean(login) && adminLogins(env).has(login!.toLowerCase());
}
