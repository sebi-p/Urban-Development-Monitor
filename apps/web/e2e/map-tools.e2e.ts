import { expect, test } from "./fixtures";

/** M5.6: the neighbourhood filter, a drawn area and "near me", on desktop and phone. */

const listItems = (page: import("@playwright/test").Page) => page.locator(".project-list > li");
const shown = (page: import("@playwright/test").Page) =>
  page.locator("output").first().textContent();

// The demo city's box (config bbox) and a triangle far outside it.
const WHOLE_CITY = "25.5,45.57;25.7,45.57;25.7,45.71;25.5,45.71";
const NOWHERE = "26,44;26.01,44;26,44.01";

test("the neighbourhood filter narrows the list and keeps the slug in the URL", async ({
  page,
  city,
}) => {
  await page.goto(`/${city}`);
  await expect(page.locator(".map[data-ready=true]")).toBeAttached();
  const before = await shown(page);
  await page.getByText("Mai multe filtre").click();
  await page.getByLabel("Cartier").selectOption("demo-vest");
  await expect(page).toHaveURL(/cartier=demo-vest/);
  await expect.poll(() => shown(page)).not.toBe(before);
  await expect(page.getByLabel("Cartier")).toHaveValue("demo-vest");
});

test("a drawn area filters through the URL; clearing it shows everything again", async ({
  page,
  city,
}) => {
  await page.goto(`/${city}`);
  const all = await listItems(page).count();
  await page.goto(`/${city}?zona=${WHOLE_CITY}`);
  await expect(page.locator(".map[data-area='4']")).toBeAttached();
  // Every located project is inside; projects with no location are in no area.
  const located = Number(await page.locator(".map").getAttribute("data-count"));
  expect(located).toBeGreaterThan(0);
  await expect(listItems(page)).toHaveCount(located);
  await page.goto(`/${city}?zona=${NOWHERE}`);
  await expect(listItems(page)).toHaveCount(0);
  await expect(page.locator(".map")).toHaveAttribute("data-count", "0");
  const feed = page.getByRole("link", { name: "Flux RSS pentru zonă" });
  await expect(feed).toHaveAttribute("href", `/${city}/feed.xml?zona=${NOWHERE}`);
  expect((await page.request.get((await feed.getAttribute("href"))!)).status()).toBe(200);
  await page.getByRole("button", { name: "Șterge zona" }).click();
  await expect(page).not.toHaveURL(/zona=/);
  await expect.poll(() => listItems(page).count()).toBe(all);
});

test("drawing a polygon on the map sets the area", async ({ page, city }, info) => {
  await page.goto(`/${city}`);
  const map = page.locator(".map[data-ready=true]");
  await expect(map).toBeAttached();
  await page.getByRole("button", { name: "Desenează zona" }).click();
  await expect(page.locator(".map[data-drawing=true]")).toBeAttached();
  await expect(page.getByText(/Atinge colțurile zonei/)).toBeVisible();
  // Corners in the upper right of the map: clear of the tools, the desktop panel (left) and the
  // phone's sheet (bottom).
  const box = (await map.boundingBox())!;
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy];
  const corners = [at(0.55, 0.25), at(0.85, 0.25), at(0.8, 0.45), at(0.6, 0.42)];
  const tap = async ([x, y]: number[]) => {
    if (info.project.name === "phone") await page.touchscreen.tap(x!, y!);
    else await page.mouse.click(x!, y!);
    await page.waitForTimeout(150); // terra-draw tells a double click from two clicks
  };
  for (const c of corners) await tap(c);
  await tap(corners[0]!); // closing on the first corner finishes the polygon
  await expect(page).toHaveURL(/zona=([\d.]+,[\d.]+;){3}[\d.]+,[\d.]+/);
  await expect(page.locator(".map[data-area='4']")).toBeAttached();
  await expect(page.locator(".map[data-drawing]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Șterge zona" })).toBeVisible();
});

test("near me moves the map to the reader and keeps the position out of the URL", async ({
  page,
  city,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ longitude: 25.6, latitude: 45.65 });
  await page.goto(`/${city}`);
  const map = page.locator(".map[data-ready=true]");
  await expect(map).toBeAttached();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.getByRole("button", { name: "Lângă mine" }).click();
  await expect(page.getByRole("img", { name: "Poziția ta" })).toBeVisible();
  await expect.poll(async () => Number(await map.getAttribute("data-zoom"))).toBeGreaterThan(14);
  expect(page.url()).not.toMatch(/25\.6|45\.65/);
  expect(requests.filter((u) => u.includes("45.65"))).toEqual([]);
});

test("near me says so when the browser gives no position", async ({ page, city }) => {
  await page.goto(`/${city}`);
  await expect(page.locator(".map[data-ready=true]")).toBeAttached();
  await page.getByRole("button", { name: "Lângă mine" }).click();
  await expect(page.getByText(/Nu am primit locația/)).toBeVisible();
});

test("robots.txt and the sitemap open every published project to search engines", async ({
  page,
  city,
}) => {
  const robots = await (await page.request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toMatch(/Sitemap: http.*\/sitemap\.xml/);
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  const geo = await (await page.request.get(`/api/${city}/projects.geojson`)).json();
  const slug = geo.features[0].properties.slug as string;
  expect(sitemap).toContain(`/${city}/proiecte/${slug}</loc>`);
  expect(sitemap).toContain(`hreflang="en"`);
  expect(sitemap).toContain(`/en/${city}/proiecte/${slug}`);
});
