import { expect, test } from "./fixtures";

/**
 * M4.1 done criterion: works on a mid-range phone at 3G speed. Emulated: Moto G4 screen, network
 * 1.6 Mbit/s down, 750 kbit/s up, 150 ms latency (Lighthouse's mobile throttling), CPU 4x slower.
 * Budget: the filters are usable within 3 s, the map's pins within 10 s, and opening the list
 * sheet takes under 0.5 s. Map tiles are served locally (fixtures.ts).
 */
const FILTERS_MS = 3_000;
const PINS_MS = 10_000;
const TAB_MS = 500;

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

  const tab = Date.now();
  await page.getByRole("button", { name: "Listă" }).click();
  await expect(page.getByRole("complementary", { name: "Rezultate și filtre" })).toHaveAttribute(
    "data-snap",
    "full",
    { timeout: TAB_MS },
  );
  const tabMs = Date.now() - tab;

  info.annotations.push({
    type: "budget",
    description: `filters ${filtersAt} ms, pins ${pinsAt} ms, list tab ${tabMs} ms`,
  });
  console.log(`3G phone: filters ${filtersAt} ms, pins ${pinsAt} ms, list tab ${tabMs} ms`);
  expect(filtersAt).toBeLessThan(FILTERS_MS);
  expect(pinsAt).toBeLessThan(PINS_MS);
  expect(tabMs).toBeLessThan(TAB_MS);
});
