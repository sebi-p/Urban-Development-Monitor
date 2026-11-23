import { expect, test } from "./fixtures";

/** M4.3: archive search over the demo data. */

test('searching without diacritics finds and marks "Grădinii"', async ({ page, city }) => {
  await page.goto(`/${city}/arhiva`);
  await page.getByRole("searchbox").fill("gradinii");
  await page.getByRole("button", { name: "Caută" }).click();
  await expect(page).toHaveURL(/q=gradinii/);
  // demo-1 names the street; Romanian stemming may also find "grădiniță" in real data.
  const hit = page.locator(".results > li").filter({ hasText: "[DEMO] PUZ locuințe colective" });
  await expect(hit.locator("mark").first()).toHaveText("Grădinii");
  await hit.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/${city}/proiecte/demo-1$`));
});

test("facets filter the results and keep their counts", async ({ page, city }) => {
  await page.goto(`/${city}/arhiva`);
  const all = Number((await page.locator("output").textContent())!.match(/\d+/)![0]);
  // With JavaScript running, Apply is hidden and a change submits the form by itself.
  await expect(page.getByRole("button", { name: "Aplică" })).toBeHidden();
  await page.getByRole("checkbox", { name: /^PUD/ }).check();
  await expect(page).toHaveURL(/tip=pud/);
  const pud = page.locator(".results > li");
  await expect.poll(() => pud.count()).toBeLessThan(all);
  // The kind facet still offers PUZ with its count (counts ignore their own selection).
  await expect(page.getByRole("checkbox", { name: /^PUZ/ })).toBeVisible();
  await page.getByRole("link", { name: "Șterge filtrele" }).click();
  await expect(page).not.toHaveURL(/tip=/);
});

test("the filters work without JavaScript", async ({ browser, city }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`/${city}/arhiva`);
  await page.getByRole("checkbox", { name: /^PUZ/ }).check();
  await page.getByRole("checkbox", { name: /^PUD/ }).check();
  await page.getByRole("button", { name: "Aplică" }).click();
  await expect(page).toHaveURL(/tip=puz&tip=pud|tip=pud&tip=puz/);
  await expect(page.getByRole("checkbox", { name: /^PUD/ })).toBeChecked();
  await context.close();
});

test("CSV export has every result, a BOM and the project links", async ({ page, city }) => {
  const res = await page.request.get(`/api/${city}/search.csv?q=gradinii`);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.body();
  expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = body.toString("utf8").trim().split("\r\n");
  expect(lines[0]).toContain('"Titlu"');
  expect(lines.length).toBeGreaterThanOrEqual(2);
  expect(lines.some((l) => l.includes(`/${city}/proiecte/demo-1"`))).toBe(true);
});

test("a repeated search answers from the cache in under 300 ms", async ({ page, city }) => {
  const url = `/${city}/arhiva?q=locuinte&tip=puz`;
  await page.request.get(url); // fills the cache
  const start = Date.now();
  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(Date.now() - start).toBeLessThan(300);
});
