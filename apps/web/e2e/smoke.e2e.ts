import { smokeCheck, smokeReport } from "../lib/smoke";
import { expect, test } from "./fixtures";

/** M5.4: the checks live-smoke.yml and the watchdog run in production pass on this build. */
test("the production page checks pass", async ({ city, baseURL }, info) => {
  test.skip(info.project.name !== "desktop", "plain HTTP: once is enough");
  const checks = await smokeCheck(baseURL!, [city]);
  expect(smokeReport(baseURL!, checks)).toBe("");
  expect(checks.length).toBe(9);
});
