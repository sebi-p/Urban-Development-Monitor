import { expect, test } from "./fixtures";

const listItems = (page: import("@playwright/test").Page) => page.locator(".project-list > li");
/** The number of results the page reports (the list renders 30 cards at a time). */
const total = async (page: import("@playwright/test").Page) =>
  Number((await page.locator("output").first().textContent())?.match(/\d+/)?.[0] ?? 0);

test("filters update the URL, the list and the map together", async ({ page, city }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout shows map and list side by side");
  await page.goto(`/${city}`);
  const map = page.locator(".map[data-ready=true]");
  await expect(map).toBeVisible();
  const all = await total(page);
  expect(all).toBeGreaterThan(0);

  await page.getByRole("checkbox", { name: "PUZ", exact: true }).check();
  await expect(page).toHaveURL(/tip=puz/);
  await expect.poll(() => total(page)).toBeLessThan(all);
  const metas = await listItems(page).locator(".meta").first().allTextContents();
  expect(metas.every((m) => m.startsWith("PUZ"))).toBe(true);
  const located = await page.locator(".map").getAttribute("data-count");
  expect(Number(located)).toBeLessThanOrEqual(await total(page));

  await page.getByRole("link", { name: "Resetează filtrele" }).click();
  await expect(page).not.toHaveURL(/tip=/);
  await expect.poll(() => total(page)).toBe(all);
  await expect(page.getByRole("checkbox", { name: "PUZ", exact: true })).not.toBeChecked();
});

test("a shared link opens with its filters applied", async ({ page, city }) => {
  await page.goto(`/${city}?tip=pud&consultare=deschisa`);
  await expect(page.getByRole("checkbox", { name: "PUD", exact: true })).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Doar cu consultare publică deschisă acum" }),
  ).toBeChecked();
  await expect(page.locator("output")).toContainText(/proiect/i);
});

test("the filters work without JavaScript", async ({ browser, city }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`/${city}`);
  const all = await total(page);
  await page.getByRole("checkbox", { name: "PUZ", exact: true }).check();
  await page.getByRole("button", { name: "Aplică" }).click();
  await expect(page).toHaveURL(/tip=puz/);
  expect(await total(page)).toBeLessThan(all);
  await context.close();
});

test("nearby projects are clustered and a cluster click zooms in", async ({ page, city }, info) => {
  test.skip(info.project.name !== "desktop", "clicking a canvas cluster is a desktop gesture");
  await page.goto(`/${city}`);
  const map = page.locator(".map[data-clusters]");
  await expect(map).toBeVisible();
  const clusters = Number(await map.getAttribute("data-clusters"));
  test.skip(clusters === 0, "no clusters at this zoom with the current data");
  const zoom = Number(await map.getAttribute("data-zoom"));
  // The map reports the first cluster's position on screen (data-cluster-xy) when it is idle.
  const box = (await map.boundingBox())!;
  const xy = await map.getAttribute("data-cluster-xy");
  const [x, y] = (xy ?? "0,0").split(",").map(Number);
  await page.mouse.click(box.x + x!, box.y + y!);
  await expect.poll(async () => Number(await map.getAttribute("data-zoom"))).toBeGreaterThan(zoom);
});

test("on a phone the list is a sheet over the map: button, drag, no sideways scroll", async ({
  page,
  city,
}, info) => {
  test.skip(info.project.name !== "phone", "phone layout");
  await page.goto(`/${city}`);
  const sheet = page.getByRole("complementary", { name: "Rezultate și filtre" });
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(page.locator(".map[data-ready=true]")).toBeVisible();

  await sheet.getByRole("button", { name: "Listă", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(page.locator(".project-list > li").first()).toBeInViewport();
  await sheet.getByRole("button", { name: "Hartă", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-snap", "peek");

  // Drag the handle up one step (peek -> half), as a finger would.
  const handle = sheet.locator("[data-handle]");
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await handle.dispatchEvent("pointerdown", { clientY: y, pointerId: 1, pointerType: "touch" });
  await handle.dispatchEvent("pointerup", { clientY: y - 120, pointerId: 1, pointerType: "touch" });
  await expect(sheet).toHaveAttribute("data-snap", "half");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a map popup link opens the sheet at that project", async ({ page, city }, info) => {
  test.skip(info.project.name !== "phone", "phone layout");
  await page.goto(`/${city}`);
  const first = page.locator(".project-list > li").first();
  const id = await first.getAttribute("id");
  await page.evaluate((hash) => (window.location.hash = hash), `#${id}`);
  const sheet = page.getByRole("complementary", { name: "Rezultate și filtre" });
  await expect(sheet).toHaveAttribute("data-snap", "full");
});

test("hovering or focusing a card highlights its pin", async ({ page, city }, info) => {
  test.skip(info.project.name !== "desktop", "hover and keyboard: the desktop panel");
  await page.goto(`/${city}`);
  const map = page.locator(".map[data-ready=true]");
  await expect(map).toBeVisible();
  // Zoomed in on demo-1 first, so its pin isn't inside a cluster.
  await page.locator("#p-demo-1 [data-show-on-map]").click();
  await expect(page.locator(".maplibregl-popup")).toContainText("PUZ locuințe colective");
  await expect(map).toHaveAttribute("data-highlight", "demo-1");
  await expect(map).toHaveAttribute("data-highlighted", "1");
  await page.locator(".maplibregl-popup-close-button").click();
  await page.mouse.move(900, 500); // off the list
  await expect(map).toHaveAttribute("data-highlight", "");
  // Keyboard: focusing a card's button highlights the pin again.
  await page.locator("#p-demo-1 [data-show-on-map]").focus();
  await expect(map).toHaveAttribute("data-highlight", "demo-1");
  await expect(map).toHaveAttribute("data-highlighted", "1");
  await page.locator("#p-demo-1 h3 a").blur();
  // Mouse: hovering another located card moves the highlight.
  await page.locator("#p-demo-2").hover();
  await expect(map).toHaveAttribute("data-highlight", "demo-2");
});

test("on a phone, Arată pe hartă lowers the sheet and opens the pin's popup", async ({
  page,
  city,
}, info) => {
  test.skip(info.project.name !== "phone", "the sheet exists on phones");
  await page.goto(`/${city}#p-demo-1`);
  const sheet = page.getByRole("complementary", { name: "Rezultate și filtre" });
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(page.locator(".map[data-ready=true]")).toBeAttached();
  await page.locator("#p-demo-1 [data-show-on-map]").tap();
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  await expect(page.locator(".maplibregl-popup")).toContainText("PUZ locuințe colective");
  await expect(page.locator(".map")).toHaveAttribute("data-highlighted", "1");
});

test("projects without a location have no Arată pe hartă button", async ({ page, city }) => {
  await page.goto(`/${city}`);
  for (const card of await page.locator(".project-list > li").all()) {
    const located = await card.getAttribute("data-located");
    await expect(card.locator("[data-show-on-map]")).toHaveCount(located ? 1 : 0);
  }
});

test("a filter change needs no request once the index is in; before that, cues show", async ({
  page,
  city,
}) => {
  // Hold the city's index until the cues have been checked: the server's first view shows.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(`**/api/${city}/map.json`, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/${city}`);
  await page.getByRole("checkbox", { name: "PUZ", exact: true }).check();
  await expect(page).toHaveURL(/tip=puz/);
  await expect(page.locator(".busy-bar")).toHaveCSS("opacity", "1");
  await expect(page.locator(".busy-spinner")).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-busy-fade]:has(> .project-list)")).toHaveCSS("opacity", "0.5");
  release();
  await expect(page.locator("html")).not.toHaveAttribute("data-busy");
  await expect(page.locator(".busy-bar")).toHaveCSS("opacity", "0");
  const metas = await listItems(page).locator(".meta").allTextContents();
  expect(metas.every((m) => m.startsWith("PUZ"))).toBe(true);

  // From now on filters only touch the URL: no page or data request.
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "fetch" || r.resourceType() === "document") requests.push(r.url());
  });
  await page.getByRole("checkbox", { name: "PUD", exact: true }).check();
  await expect(page).toHaveURL(/tip=puz,pud/);
  await page.getByRole("checkbox", { name: "PUZ", exact: true }).uncheck();
  await expect(page).toHaveURL(/tip=pud/);
  expect(requests).toEqual([]);
});

test("the list shows 30 cards and more as the reader scrolls; a link shows more without JavaScript", async ({
  browser,
  page,
  city,
}, info) => {
  test.skip(info.project.name !== "desktop", "the desktop panel scrolls without a drag");
  await page.goto(`/${city}`);
  const all = await total(page);
  test.skip(all <= 30, "the demo data fits on one page");
  await expect(listItems(page)).toHaveCount(30);
  await page.locator("[data-more]").scrollIntoViewIfNeeded();
  await expect.poll(() => listItems(page).count()).toBe(Math.min(all, 60));

  const context = await browser.newContext({ javaScriptEnabled: false });
  const nojs = await context.newPage();
  await nojs.goto(`/${city}`);
  await expect(listItems(nojs)).toHaveCount(30);
  await nojs.locator("[data-more]").click();
  await expect(nojs).toHaveURL(/afisate=60/);
  await expect(listItems(nojs)).toHaveCount(Math.min(all, 60));
  await context.close();
});
