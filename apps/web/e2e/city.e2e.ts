import { expect, test } from "./fixtures";

const listItems = (page: import("@playwright/test").Page) => page.locator(".project-list > li");

test("filters update the URL, the list and the map together", async ({ page, city }, info) => {
  test.skip(info.project.name !== "desktop", "desktop layout shows map and list side by side");
  await page.goto(`/${city}`);
  const map = page.locator(".map[data-ready=true]");
  await expect(map).toBeVisible();
  const all = await listItems(page).count();
  expect(all).toBeGreaterThan(0);

  await page.getByRole("checkbox", { name: "PUZ", exact: true }).check();
  await expect(page).toHaveURL(/tip=puz/);
  await expect.poll(() => listItems(page).count()).toBeLessThan(all);
  const metas = await listItems(page).locator(".meta").first().allTextContents();
  expect(metas.every((m) => m.startsWith("PUZ"))).toBe(true);
  const located = await page.locator(".map").getAttribute("data-count");
  expect(Number(located)).toBeLessThanOrEqual(await listItems(page).count());

  await page.getByRole("link", { name: "Resetează filtrele" }).click();
  await expect(page).not.toHaveURL(/tip=/);
  await expect.poll(() => listItems(page).count()).toBe(all);
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
  const all = await listItems(page).count();
  await page.getByRole("checkbox", { name: "PUZ", exact: true }).check();
  await page.getByRole("button", { name: "Aplică" }).click();
  await expect(page).toHaveURL(/tip=puz/);
  expect(await listItems(page).count()).toBeLessThan(all);
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

test("on a phone the map and list are tabs and nothing scrolls sideways", async ({
  page,
  city,
}, info) => {
  test.skip(info.project.name !== "phone", "phone layout");
  await page.goto(`/${city}`);
  await expect(page.getByRole("tab", { name: "Hartă" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".panel-list")).toBeHidden();
  await page.getByRole("tab", { name: "Listă" }).click();
  await expect(page.locator(".panel-list")).toBeVisible();
  await expect(page.locator(".panel-map")).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
