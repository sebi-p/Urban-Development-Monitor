import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * M4.1 done criterion: works on a mid-range phone at 3G speed. Emulated: Moto G4 screen, network
 * 1.6 Mbit/s down, 750 kbit/s up, 150 ms latency (Lighthouse's mobile throttling), CPU 4x slower.
 * Budget: the filters are usable within 3 s, the map's pins within 10 s, and opening the list
 * sheet takes under 0.5 s. M5.7 adds: a filter change shows its results, and going back from a
 * project shows the list where it was, each within 0.3 s. Map tiles are served locally
 * (fixtures.ts).
 *
 * The interactions are timed inside the page, from the input event to the change on screen
 * (after the next paint), so Playwright's own round trips to the browser don't count.
 */
const FILTERS_MS = 3_000;
const PINS_MS = 10_000;
const TAB_MS = 500;
const FILTER_CHANGE_MS = 300;
const BACK_MS = 300;

/** What the page shows once an interaction is done: an attribute's value, or a changed text. */
type Done =
  { selector: string; attr: string; value: string } | { selector: string; textNot: string };

/** Milliseconds from `event` on `target` until `done` holds, measured to the next paint. */
async function timeInPage(page: Page, target: string, event: string, done: Done) {
  await page.evaluate(
    ({ target, event, done }) => {
      const w = window as unknown as { __timing?: Promise<number> };
      const holds = () => {
        const el = document.querySelector<HTMLElement>(done.selector);
        if (!el) return false;
        return "attr" in done
          ? el.getAttribute(done.attr) === done.value
          : el.textContent !== done.textNot;
      };
      w.__timing = new Promise<number>((resolve) => {
        document.querySelector(target)!.addEventListener(
          event,
          () => {
            const t0 = performance.now();
            const check = () => {
              if (holds()) requestAnimationFrame(() => resolve(performance.now() - t0));
              else requestAnimationFrame(check);
            };
            check();
          },
          { capture: true, once: true },
        );
      });
    },
    { target, event, done },
  );
}

const timing = (page: Page) =>
  page.evaluate(() => (window as unknown as { __timing: Promise<number> }).__timing);

test("3G phone budget", async ({ page, city }, info) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const start = Date.now();
  await page.goto(`/${city}`, { waitUntil: "commit" });
  await expect(page.getByRole("checkbox", { name: "PUZ", exact: true })).toBeVisible({
    timeout: FILTERS_MS,
  });
  const filtersAt = Date.now() - start;
  await expect(page.locator(".map[data-ready=true]")).toBeVisible({ timeout: PINS_MS });
  const pinsAt = Date.now() - start;

  const sheet = page.getByRole("complementary", { name: "Rezultate și filtre" });
  await timeInPage(page, "aside [aria-expanded]", "click", {
    selector: "aside[data-snap]",
    attr: "data-snap",
    value: "full",
  });
  await sheet.getByRole("button", { name: "Listă", exact: true }).click();
  const tabMs = await timing(page);
  await expect(sheet).toHaveAttribute("data-snap", "full");

  // A filter: the count changes in place, with no request.
  const before = await page.locator("output").first().textContent();
  await timeInPage(page, "body", "input", { selector: "output", textNot: before ?? "" });
  await page.getByRole("checkbox", { name: "PUZ", exact: true }).check();
  const filterMs = await timing(page);

  // Back from a project: the list is there again, scrolled where it was.
  const card = page.locator(".project-list > li").nth(3);
  await card.scrollIntoViewIfNeeded();
  const scrolled = await page.locator("[data-sheet-body]").evaluate((el) => el.scrollTop);
  await card.locator("h3 a").click();
  await expect(page).toHaveURL(/proiecte/);
  await page.evaluate(() => {
    const w = window as unknown as { __timing?: Promise<number> };
    w.__timing = new Promise<number>((resolve) => {
      window.addEventListener(
        "popstate",
        () => {
          const t0 = performance.now();
          const check = () => {
            const body = document.querySelector<HTMLElement>("[data-sheet-body]");
            if (body && document.querySelector(".project-list") && body.scrollTop > 0)
              requestAnimationFrame(() => resolve(performance.now() - t0));
            else requestAnimationFrame(check);
          };
          check();
        },
        { once: true },
      );
    });
  });
  await page.goBack();
  const backMs = await timing(page);
  const restored = await page.locator("[data-sheet-body]").evaluate((el) => el.scrollTop);
  expect(Math.abs(restored - scrolled)).toBeLessThan(5);

  const report =
    `filters ${filtersAt} ms, pins ${pinsAt} ms, list tab ${Math.round(tabMs)} ms, ` +
    `filter change ${Math.round(filterMs)} ms, back ${Math.round(backMs)} ms`;
  info.annotations.push({ type: "budget", description: report });
  console.log(`3G phone: ${report}`);
  expect(filtersAt).toBeLessThan(FILTERS_MS);
  expect(pinsAt).toBeLessThan(PINS_MS);
  expect(tabMs).toBeLessThan(TAB_MS);
  expect(filterMs).toBeLessThan(FILTER_CHANGE_MS);
  expect(backMs).toBeLessThan(BACK_MS);
});
