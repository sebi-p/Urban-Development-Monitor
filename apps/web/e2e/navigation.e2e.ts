import { expect, test } from "./fixtures";

/** M5.7: going back to the map returns to where the reader was, without asking the server. */

const sheetBody = (page: import("@playwright/test").Page) => page.locator("[data-sheet-body]");
const scrollTop = (page: import("@playwright/test").Page) =>
  sheetBody(page).evaluate((el) => el.scrollTop);

test("back from a project restores the map view and the list's scroll", async ({
  page,
  city,
}, info) => {
  test.skip(info.project.name !== "desktop", "desktop: the panel and the map side by side");
  await page.goto(`/${city}`);
  const map = page.locator(".map[data-ready=true]");
  await expect(map).toBeAttached();
  const start = Number(await map.getAttribute("data-zoom"));
  await page.mouse.move(900, 400);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -400);
  await expect.poll(async () => Number(await map.getAttribute("data-zoom"))).toBeGreaterThan(start);
  await page.waitForTimeout(500); // the zoom settles
  const zoom = await map.getAttribute("data-zoom");

  const card = page.locator(".project-list > li").nth(8);
  await card.scrollIntoViewIfNeeded();
  const scrolled = await scrollTop(page);
  expect(scrolled).toBeGreaterThan(0);

  const documents: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents.push(r.url());
  });
  await card.locator("h3 a").click();
  await expect(page).toHaveURL(/proiecte/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${city}$`));
  await expect(map).toBeAttached();
  await expect(map).toHaveAttribute("data-zoom", zoom!);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(scrolled - 5);
  expect(documents).toEqual([]);
});

test("on a phone, back reopens the sheet at its height and scroll, with the filters", async ({
  page,
  city,
}, info) => {
  test.skip(info.project.name !== "phone", "the sheet exists on phones");
  await page.goto(`/${city}`);
  await expect(page.locator(".map[data-ready=true]")).toBeAttached();
  await page.getByRole("checkbox", { name: "PUZ", exact: true }).check();
  await expect(page).toHaveURL(/tip=puz/);
  const sheet = page.getByRole("complementary", { name: "Rezultate și filtre" });
  await sheet.getByRole("button", { name: "Listă", exact: true }).click();
  await expect(sheet).toHaveAttribute("data-snap", "full");
  const card = page.locator(".project-list > li").nth(4);
  await card.scrollIntoViewIfNeeded();
  const scrolled = await scrollTop(page);
  expect(scrolled).toBeGreaterThan(0);

  await card.locator("h3 a").click();
  await expect(page).toHaveURL(/proiecte/);
  await page.goBack();
  await expect(page).toHaveURL(/tip=puz/);
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(page.getByRole("checkbox", { name: "PUZ", exact: true })).toBeChecked();
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(scrolled - 5);
  const metas = await page.locator(".project-list > li .meta").allTextContents();
  expect(metas.every((m) => m.startsWith("PUZ"))).toBe(true);
});
