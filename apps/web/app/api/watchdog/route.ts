import { citySlugs, runFindings, type Finding } from "@mdu/db";
import { syncAlerts } from "@/lib/alerts";
import { getDb } from "@/lib/db";
import { alertRepo } from "@/lib/workflows";
import { smokeCheck, smokeReport } from "@/lib/smoke";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/watchdog (M5.4, ADR 0021). Vercel Cron calls it once a day with
 * `Authorization: Bearer $CRON_SECRET`, outside GitHub's scheduler. It checks each city's runs
 * and the production pages, then opens, comments on or closes the `alert` issues.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const db = getDb();
  const cities = await citySlugs(db);
  const findings: Finding[] = [];
  for (const city of cities) findings.push(...(await runFindings(db, city)));
  // The production domain, not the deployment URL Vercel Cron calls: that one is protected.
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = domain ? `https://${domain}` : new URL(request.url).origin;
  const report = smokeReport(base, await smokeCheck(base, cities));
  if (report) findings.push({ key: "pages", title: "Production pages are broken", detail: report });

  const token = process.env.GITHUB_ALERT_TOKEN;
  const repo = alertRepo();
  if (!token || !repo) {
    // Without a token the findings only reach the function log: fail so Vercel shows it.
    console.error("watchdog: GITHUB_ALERT_TOKEN or the repository is not set", findings);
    return Response.json({ findings, alerts: null }, { status: 500 });
  }
  const alerts = await syncAlerts({ repo, token }, findings, {
    closeOthers: true,
    source: "the daily watchdog",
  });
  return Response.json({ findings, alerts });
}
