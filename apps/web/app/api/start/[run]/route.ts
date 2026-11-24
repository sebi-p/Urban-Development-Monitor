import { syncAlerts } from "@/lib/alerts";
import { alertRepo, dispatchWorkflow, RUNS, type RunName } from "@/lib/workflows";

export const dynamic = "force-dynamic";

/**
 * GET /api/start/daily and /api/start/backfill (M5.4, ADR 0021). Vercel Cron calls them with
 * `Authorization: Bearer $CRON_SECRET` and they start the workflow on GitHub: GitHub's own
 * schedule started runs 8 to 10 hours late, past the back-fill's night window. If GitHub refuses,
 * the run's alert issue is opened.
 */
export async function GET(request: Request, { params }: { params: Promise<{ run: string }> }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const { run } = await params;
  if (!(run in RUNS)) return new Response("not found", { status: 404 });
  const token = process.env.GITHUB_ALERT_TOKEN;
  const repo = alertRepo();
  if (!token || !repo) {
    console.error("start: GITHUB_ALERT_TOKEN or the repository is not set");
    return new Response("not configured", { status: 500 });
  }
  const file = RUNS[run as RunName];
  try {
    await dispatchWorkflow({ repo, token }, file);
  } catch (err) {
    const detail = `Vercel Cron couldn't start ${file}: ${err instanceof Error ? err.message : err}. Check that GITHUB_ALERT_TOKEN has Actions: read and write.`;
    console.error(detail);
    await syncAlerts(
      { repo, token },
      [{ key: `start:${run}`, title: `Couldn't start ${file}`, detail }],
      {
        source: "the start route",
      },
    ).catch(() => {});
    return new Response(detail, { status: 502 });
  }
  return Response.json({ started: file });
}
