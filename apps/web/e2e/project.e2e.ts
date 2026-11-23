import { expect, test } from "./fixtures";

/** M4.2: the project page with the demo data (demo-1 has an open consultation, figures, a
 * summary and demo-2 within 500 m). */

test("a list card opens the project page", async ({ page, city }, info) => {
  test.skip(info.project.name !== "desktop", "the desktop panel shows the list without a drag");
  await page.goto(`/${city}`);
  const card = page.locator(".project-list > li#p-demo-1");
  await card.getByRole("link", { name: /\[DEMO\] PUZ locuințe colective/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${city}/proiecte/demo-1$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("PUZ locuințe colective");
});

test("the page shows the consultation, summary, figures, timeline and nearby projects", async ({
  page,
  city,
}) => {
  await page.goto(`/${city}/proiecte/demo-1`);
  const box = page.locator(".consultation[data-state=open]");
  await expect(box).toBeVisible();
  await expect(box.locator(".days-left")).toContainText(/Mai sunt \d+ de zile|Mai sunt \d+ zile/);
  await expect(box.getByRole("link", { name: "registratura@example.org" })).toHaveAttribute(
    "href",
    /^mailto:registratura@example\.org\?subject=/,
  );
  await expect(page.locator(".summary")).toContainText("Rezumat generat automat");
  await expect(page.locator(".summary .source-chip")).toHaveAttribute("href", /#page=1$/);
  await expect(page.locator(".figures li")).toHaveCount(2);
  await expect(page.locator(".figures a").first()).toHaveAttribute("href", /#page=3$/);
  // Two events, then the comments deadline still to come.
  await expect(page.locator(".timeline > li")).toHaveCount(3);
  await expect(page.locator(".timeline > li").last()).toContainText("Termen pentru observații");
  await expect(page.locator(".last-checked")).toContainText("Verificat ultima dată");

  const nearby = page.locator(".nearby a").first();
  await expect(nearby).toContainText("m");
  await nearby.click();
  await expect(page).toHaveURL(new RegExp(`/${city}/proiecte/demo-2$`));
});

test("the small map loads when scrolled into view", async ({ page, city }) => {
  await page.goto(`/${city}/proiecte/demo-1`);
  const map = page.locator(".mini-map");
  await map.scrollIntoViewIfNeeded();
  await expect(page.locator(".mini-map[data-ready=true]")).toBeVisible();
});

test("JSON-LD describes the page, its place and breadcrumbs", async ({ page, city }) => {
  await page.goto(`/${city}/proiecte/demo-1`);
  const raw = await page.locator('script[type="application/ld+json"]').textContent();
  const data = JSON.parse(raw!) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(data["@context"]).toBe("https://schema.org");
  expect(data["@type"]).toBe("WebPage");
  expect(data.url).toMatch(new RegExp(`/${city}/proiecte/demo-1$`));
  expect(data.about["@type"]).toBe("Place");
  expect(data.about.geo["@type"]).toBe("GeoCoordinates");
  expect(typeof data.about.geo.latitude).toBe("number");
  expect(data.about.address.addressCountry).toBe("RO");
  expect(data.breadcrumb.itemListElement).toHaveLength(3);
  expect(data.description).toBe(
    await page.locator('meta[name="description"]').getAttribute("content"),
  );
});

test("the share preview carries the summary and a 1200×630 image", async ({ page, city }) => {
  await page.goto(`/${city}/proiecte/demo-1`);
  const meta = (name: string) =>
    page.locator(`meta[property="${name}"]`).first().getAttribute("content");
  const summary = (await page.locator(".summary p").first().textContent())!.trim();
  expect(await meta("og:description")).toBe(summary);
  expect(await meta("og:title")).toContain("PUZ locuințe colective");
  expect(await meta("og:type")).toBe("article");
  const image = await meta("og:image");
  const res = await page.request.get(new URL(image!).pathname + new URL(image!).search);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const png = await res.body();
  // PNG header: width and height are big-endian at bytes 16 and 20.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
});

test("an unknown project is a 404 and the JSON API answers", async ({ page, city }) => {
  const missing = await page.goto(`/${city}/proiecte/nu-exista`);
  expect(missing?.status()).toBe(404);
  const api = await page.request.get(`/api/${city}/projects/demo-1`);
  expect(api.status()).toBe(200);
  expect(api.headers()["cache-control"]).toContain("s-maxage=300");
  const body = (await api.json()) as { slug: string; consultations: unknown[] };
  expect(body.slug).toBe("demo-1");
  expect(body.consultations).toHaveLength(1);
});
