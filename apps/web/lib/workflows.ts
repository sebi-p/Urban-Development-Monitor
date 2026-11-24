/**
 * Starts a GitHub Actions workflow (`workflow_dispatch`), for the Vercel Cron routes that replace
 * GitHub's late schedules (M5.4, ADR 0021). Needs a token with Actions: read and write.
 */

/** The runs Vercel Cron starts, by route name. */
export const RUNS = { daily: "ingest-daily.yml", backfill: "backfill.yml" } as const;
export type RunName = keyof typeof RUNS;

export async function dispatchWorkflow(
  t: {
    repo: string;
    token: string;
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  },
  file: string,
  ref = "main",
): Promise<void> {
  const res = await (t.fetch ?? fetch)(
    `https://api.github.com/repos/${t.repo}/actions/workflows/${file}/dispatches`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${t.token}`,
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref }),
    },
  );
  // GitHub answers 204 (or 200 with the run's details on newer API versions).
  if (!res.ok) throw new Error(`GitHub dispatch ${file}: HTTP ${res.status}`);
}

/** The repository the token is for: set explicitly, or Vercel's Git variables. */
export function alertRepo(): string | undefined {
  return (
    process.env.GITHUB_ALERT_REPO ??
    (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : undefined)
  );
}
