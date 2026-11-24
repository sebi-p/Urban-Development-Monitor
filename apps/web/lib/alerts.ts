/**
 * Alerts as GitHub issues (M5.4, ADR 0021): one open issue per problem key, found by a marker in
 * its body. A problem that is still there gets a comment instead of a new issue; the watchdog
 * closes the issues whose problem is gone. Plain fetch only, so Node runs it without a build.
 */

export interface Alert {
  key: string;
  title: string;
  detail: string;
}

export interface AlertTarget {
  /** "owner/name" */
  repo: string;
  token: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface SyncResult {
  opened: number[];
  commented: number[];
  closed: number[];
}

const marker = (key: string) => `<!-- mdu-alert:${key} -->`;
const MARKER = /<!-- mdu-alert:(\S+) -->/;

async function gh(t: AlertTarget, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await (t.fetch ?? fetch)(`https://api.github.com/repos/${t.repo}${path}`, {
    method: init.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${t.token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

/** Open alert issues by key (pull requests and issues without a marker are left out). */
async function openAlerts(t: AlertTarget): Promise<Map<string, number>> {
  const issues = (await gh(t, "/issues?state=open&per_page=100")) as {
    number: number;
    body: string | null;
    pull_request?: unknown;
  }[];
  const out = new Map<string, number>();
  for (const i of issues) {
    const key = !i.pull_request && i.body?.match(MARKER)?.[1];
    if (key) out.set(key, i.number);
  }
  return out;
}

/**
 * Opens or comments on an issue for each alert. With `closeOthers` (the watchdog, which checks
 * everything) the open alert issues whose key is not among `alerts` are closed as resolved.
 */
export async function syncAlerts(
  t: AlertTarget,
  alerts: Alert[],
  opts: { closeOthers?: boolean; source: string },
): Promise<SyncResult> {
  const open = await openAlerts(t);
  const result: SyncResult = { opened: [], commented: [], closed: [] };
  for (const a of alerts) {
    const n = open.get(a.key);
    if (n) {
      await gh(t, `/issues/${n}/comments`, {
        method: "POST",
        body: { body: `Still happening (${opts.source}):\n\n${a.detail}` },
      });
      result.commented.push(n);
    } else {
      const issue = (await gh(t, "/issues", {
        method: "POST",
        body: {
          title: a.title,
          body: `${a.detail}\n\nRaised by ${opts.source}. It closes when the problem is gone.\n\n${marker(a.key)}`,
          labels: ["alert"],
        },
      })) as { number: number };
      result.opened.push(issue.number);
    }
  }
  if (opts.closeOthers) {
    const current = new Set(alerts.map((a) => a.key));
    for (const [key, n] of open) {
      if (current.has(key)) continue;
      await gh(t, `/issues/${n}/comments`, {
        method: "POST",
        body: { body: `Resolved: ${opts.source} found no problem.` },
      });
      await gh(t, `/issues/${n}`, { method: "PATCH", body: { state: "closed" } });
      result.closed.push(n);
    }
  }
  return result;
}
