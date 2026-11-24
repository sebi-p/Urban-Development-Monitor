/**
 * `node scripts/alert.ts <key> <title> <detail>` (M5.4): opens the alert issue for a key, or
 * comments on the open one. The workflows call it when a run fails (GITHUB_TOKEN with
 * `issues: write`, GITHUB_REPOSITORY); the daily watchdog closes it once the problem is gone.
 */
import { syncAlerts } from "../lib/alerts.ts";

const [key, title, detail] = process.argv.slice(2);
const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo, ALERT_SOURCE: source } = process.env;
if (!key || !title || !detail || !token || !repo) {
  console.error(
    "usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=… node scripts/alert.ts <key> <title> <detail>",
  );
  process.exit(2);
}
const r = await syncAlerts({ repo, token }, [{ key, title, detail }], {
  source: source ?? "a workflow",
});
console.log(
  `alert ${key}: opened ${r.opened.join(",") || "-"}, commented ${r.commented.join(",") || "-"}`,
);
