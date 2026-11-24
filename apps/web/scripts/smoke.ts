/**
 * `node scripts/smoke.ts <base-url> <city>...` (live-smoke.yml, M5.4): checks the production
 * pages; on a failure it opens or comments on the `pages` alert issue when GITHUB_TOKEN and
 * GITHUB_REPOSITORY are set, and exits 1. VERCEL_AUTOMATION_BYPASS_SECRET, if set, is sent for
 * protected previews.
 */
import { syncAlerts } from "../lib/alerts.ts";
import { smokeCheck, smokeReport } from "../lib/smoke.ts";

const [base, ...cities] = process.argv.slice(2);
if (!base || !cities.length) {
  console.error("usage: node scripts/smoke.ts <base-url> <city>...");
  process.exit(2);
}
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const checks = await smokeCheck(base, cities, {
  headers: bypass ? { "x-vercel-protection-bypass": bypass } : {},
});
for (const c of checks)
  console.log(`${c.problem ? "FAIL" : "ok  "} ${c.status ?? "---"} ${c.path} ${c.problem}`);
const report = smokeReport(base, checks);
if (report) {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, ALERT_SOURCE: source } = process.env;
  if (token && repo) {
    const r = await syncAlerts(
      { repo, token },
      [{ key: "pages", title: "Production pages are broken", detail: report }],
      { source: source ?? "live-smoke" },
    );
    console.log(
      `alert: opened ${r.opened.join(",") || "-"}, commented ${r.commented.join(",") || "-"}`,
    );
  }
  process.exit(1);
}
