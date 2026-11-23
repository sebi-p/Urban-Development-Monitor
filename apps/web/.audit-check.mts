import { chromium } from "@playwright/test";
import { encode } from "../../node_modules/.pnpm/@auth+core@0.41.3/node_modules/@auth/core/jwt.js";
import { createDb, startAudit } from "@mdu/db";
process.loadEnvFile("../../.env");
const out = process.argv[2];
const login = process.env.ADMIN_GITHUB_LOGINS!.split(",")[0]!.trim();
const { db, client } = createDb(process.env.DATABASE_URL!, { max: 1 });
const id = await startAudit(db, { city: "brasov", size: 5, actor: "local-check", seed: 11 });
const token = await encode({
  token: { login, name: "check" },
  secret: process.env.AUTH_SECRET!,
  salt: "authjs.session-token",
});
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([
  { name: "authjs.session-token", value: token, url: "http://localhost:3100" },
]);
const p = await ctx.newPage();
await p.goto("http://localhost:3100/admin/audit");
await p.screenshot({ path: `${out}/audit-list.png` });
await p.goto(`http://localhost:3100/admin/audit/${id}/1`);
await p.locator("[data-field=status] button[value=correct]").click();
await p.waitForTimeout(1500);
console.log(
  "status pressed:",
  await p.locator("[data-field=status] button[value=correct]").getAttribute("aria-pressed"),
);
const frame = p.locator("iframe");
console.log(
  "viewer src:",
  (await frame.count())
    ? (await frame.getAttribute("src"))?.replace(/[0-9a-f-]{36}/, "<id>")
    : "none",
);
if (await frame.count()) {
  const res = await p.request.get(
    "http://localhost:3100" + (await frame.getAttribute("src"))!.split("#")[0],
  );
  console.log("document route:", res.status(), res.headers()["content-type"]);
}
const anon = await (
  await b.newContext()
).request.get(`http://localhost:3100/admin/documents/00000000-0000-0000-0000-000000000000`);
console.log("anonymous document route:", anon.status());
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/audit-item.png` });
console.log("AUDIT_ID", id);
await b.close();
await client.end();
