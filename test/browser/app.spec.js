import { test, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/store.js";
import { buildApp } from "../../src/server.js";
import { fixture } from "../helpers.js";
const token = "browser-test-".repeat(4);
let app,
  calls = 0;
test.beforeEach(async ({ page }) => {
  const store = new Store(
    join(await mkdtemp(join(tmpdir(), "jev-browser-")), "config.json"),
  );
  const c = fixture();
  c.sites[0].origins = ["https://www.example.com"];
  c.sites[0].minQualifiedVisits = 1;
  c.sites[0].minVisibleMs = 1000;
  await store.save(c);
  app = await buildApp({
    store,
    adminToken: token,
    jev: async () => {
      calls++;
      return { model: "test", answers: { c0q0: { noul: 0.95 } } };
    },
  });
  calls = 0;
  await page.route("https://api.example.com/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const r = await app.inject({
      method: req.method(),
      url: u.pathname + u.search,
      headers: { ...req.headers(), host: "api.example.com" },
      payload: req.postData() ?? undefined,
    });
    await route.fulfill({
      status: r.statusCode,
      headers: r.headers,
      body: r.body,
    });
  });
});
test.afterEach(async () => app.close());
test("single script -> consent -> observation -> API -> safe content; revoke removes overlay", async ({
  page,
}) => {
  await page.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>導入ガイド</title><h1>Sample</h1><script src="https://api.example.com/sdk.js" data-site="demo" defer></script>',
    }),
  );
  await page.goto("https://www.example.com/guides/start?email=hidden");
  await expect
    .poll(() => page.evaluate(() => !!window.JevPersonalization))
    .toBe(true);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  expect(calls).toBe(0);
  await page.evaluate(() => window.JevPersonalization.consent(true));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.JevPersonalization.decide());
  await expect.poll(() => page.locator("aside").count()).toBe(1);
  expect(calls).toBe(1);
  const state = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("jev:v1:demo")),
  );
  expect(JSON.stringify(state)).not.toContain("email");
  expect(state.delivery.guide.shown).toBe(1);
  await page.evaluate(() => window.JevPersonalization.consent(false));
  await expect(page.locator("aside")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
test("management UI authenticates, drafts, edits and persists a campaign", async ({
  page,
}) => {
  await page.goto("https://api.example.com/admin");
  await page.locator("#token").fill(token);
  await page.getByRole("button", { name: "設定を読み込む" }).click();
  await expect(page.locator("#title")).toHaveValue("導入ガイド");
  await page.locator("#intent").fill("通勤ランに関心を示す人に案内したい");
  await page.locator("#subject").fill("通勤ラン");
  await page.getByRole("button", { name: "質問案を作る", exact: true }).click();
  await expect(page.locator("#suggestion")).toContainText("requiresReview");
  await page.getByRole("button", { name: "上の質問案を取り込む" }).click();
  await page.locator("#title").fill("新しいガイド");
  await page
    .getByRole("button", { name: "編集を設定に反映", exact: true })
    .click();
  await page
    .getByRole("button", { name: "確認した設定を保存して配信に反映" })
    .click();
  await expect(page.locator("#status")).toHaveText("完了しました");
  await page.getByRole("button", { name: "設定を読み込む" }).click();
  await expect(page.locator("#title")).toHaveValue("新しいガイド");
  expect(calls).toBe(0);
});
