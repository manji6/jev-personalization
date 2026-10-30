import { test, expect } from "@playwright/test";
import { cloudflareFixture, adminToken } from "../cloudflare-fixture.js";
import { fixture } from "../helpers.js";
let runtime, config;
test.beforeEach(async ({ page }) => {
  config = fixture();
  const s = config.sites[0];
  s.minQualifiedVisits = 1;
  s.minVisibleMs = 1000;
  runtime = await cloudflareFixture({ config });
  await page.route("https://api.example.com/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    const r = await runtime.dispatch(u.pathname + u.search, {
      method: req.method(),
      headers: req.headers(),
      body: req.postData() ?? undefined,
    });
    await route.fulfill({
      status: r.status,
      headers: Object.fromEntries(r.headers),
      body: Buffer.from(await r.arrayBuffer()),
    });
  });
  await page.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>導入方法</title><button id="before">ページの操作</button><script src="https://api.example.com/sdk.js" data-site="demo" defer></script>',
    }),
  );
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await runtime.mf.dispose();
});
async function saveConfig() {
  await runtime.db
    .prepare("UPDATE app_config SET body = ? WHERE id = 1")
    .bind(JSON.stringify(config))
    .run();
}
async function visit(page) {
  await page.goto("https://www.example.com/guides/a");
  await expect
    .poll(() => page.evaluate(() => !!window.JevPersonalization))
    .toBe(true);
  await page.evaluate(() => window.JevPersonalization.consent(true));
  await page.waitForTimeout(1100);
}
async function decide(page) {
  await page.evaluate(() => window.JevPersonalization.decide());
}
async function login(page) {
  await page.goto("https://api.example.com/admin");
  await page.locator("#token").fill(adminToken);
  await page.getByRole("button", { name: "設定を読み込む" }).click();
  await expect(page.locator("#connectionLabel")).toHaveText("接続済み");
}

test("modal renders HTML, traps focus, closes with Escape and restores focus", async ({
  page,
}) => {
  config.sites[0].campaigns[0].presentation.type = "modal";
  await saveConfig();
  await visit(page);
  await page.locator("#before").focus();
  await decide(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "導入ガイド" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "オファーを閉じる" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement.tagName)).toBe(
    "ASIDE",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("aside")).toHaveCount(0);
  await expect(page.locator("#before")).toBeFocused();
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("jev:v1:demo")).delivery.guide,
    ),
  ).toEqual({ shown: 1, dismissed: true });
});
test("floating banner inherits theme; SPA navigation removes it", async ({
  page,
}) => {
  const s = config.sites[0];
  s.design.colors.background = "#112233";
  s.design.radius = 24;
  s.design.floating.position = "bottom-left";
  await saveConfig();
  await visit(page);
  await decide(page);
  const offer = page.locator("aside").locator("section");
  await expect(offer).toBeVisible();
  await expect(offer).toHaveCSS("background-color", "rgb(17, 34, 51)");
  await expect(offer).toHaveCSS("border-radius", "24px");
  await page.evaluate(() => history.pushState({}, "", "/guides/b"));
  await expect(page.locator("aside")).toHaveCount(0);
});
test("announcement supports text without a link and stays within a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const c = config.sites[0].campaigns[0];
  c.presentation.type = "bar";
  delete c.content.url;
  c.content.linkLabel = "";
  await saveConfig();
  await visit(page);
  await decide(page);
  await expect(
    page.locator("aside").getByRole("heading", { name: "導入ガイド" }),
  ).toBeVisible();
  await expect(page.locator("aside").getByRole("link")).toHaveCount(0);
  expect(
    await page
      .locator("aside")
      .locator("section")
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth;
      }),
  ).toBe(true);
});
test("broken image-only banners do not count as shown", async ({ page }) => {
  const c = config.sites[0].campaigns[0];
  c.presentation.imageOnly = true;
  c.content.imageUrl = "https://images.example.com/missing.jpg";
  c.content.imageAlt = "画像";
  await saveConfig();
  await page.route("https://images.example.com/**", (r) =>
    r.fulfill({ status: 404, body: "" }),
  );
  await visit(page);
  await decide(page);
  await expect(page.locator("aside")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("jev:v1:demo")).delivery.guide,
    ),
  ).toBeUndefined();
});
test("custom code receives string data and cleans up on consent withdrawal", async ({
  page,
}) => {
  const s = config.sites[0],
    c = s.campaigns[0];
  s.allowCustomJavaScript = true;
  c.presentation.type = "custom";
  c.custom = {
    variables: { label: "<b>これは文字列</b>" },
    code: `export function render({ variables, mount, reportShown }) { const p=document.createElement('p');p.textContent=variables.label;mount.append(p);reportShown();reportShown();return () => { window.customCleanup = true; p.remove(); }; }`,
  };
  await saveConfig();
  await visit(page);
  await decide(page);
  await expect(page.locator("aside").locator("p")).toHaveText(
    "<b>これは文字列</b>",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("jev:v1:demo")).delivery.guide.shown,
    ),
  ).toBe(1);
  await page.evaluate(() => window.JevPersonalization.consent(false));
  await expect(page.locator("aside")).toHaveCount(0);
  expect(await page.evaluate(() => window.customCleanup)).toBe(true);
});
test("site designer changes all offer previews and saves without JSON or extra apply", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);
  await page.getByRole("tab", { name: "サイト設定・共通デザイン" }).click();
  await page.locator("#themeBackground").fill("#eeddcc");
  await page.locator("#modalWidth").fill("600");
  await page.locator("#previewType").selectOption("modal");
  await expect(page.locator("#offerPreview").locator("section")).toHaveCSS(
    "background-color",
    "rgb(238, 221, 204)",
  );
  expect(
    await page.locator("#offerPreview").evaluate((el) => {
      const frame = el
        .querySelector("aside")
        .shadowRoot.querySelector(".modal")
        .getBoundingClientRect();
      const outer = el.getBoundingClientRect();
      return frame.left >= outer.left && frame.right <= outer.right;
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "保存して配信に反映" }).click();
  await expect(page.locator("#saveState")).toHaveText("設定を保存しました");
  await page.getByRole("button", { name: "設定を読み込む" }).click();
  await expect(page.locator("#themeBackground")).toHaveValue("#eeddcc");
  await expect(page.locator("#modalWidth")).toHaveValue("600");
  expect(runtime.calls()).toBe(0);
  await page.locator("#token").fill("");
  await page.screenshot({
    path: testInfo.outputPath("site-design.png"),
    fullPage: true,
  });
});
test("admin never executes custom code and shows guidance", async ({
  page,
}) => {
  const s = config.sites[0],
    c = s.campaigns[0];
  s.allowCustomJavaScript = true;
  c.presentation.type = "custom";
  c.custom = {
    code: "export function render() { window.unwantedExecution = true; }",
    variables: {},
  };
  await saveConfig();
  await login(page);
  await expect(page.locator("#customFields")).toBeVisible();
  await expect(page.locator("#offerPreview")).toContainText(
    "管理画面では実行しません",
  );
  await expect(page.locator("#openPreview")).toBeDisabled();
  expect(await page.evaluate(() => window.unwantedExecution)).toBeUndefined();
});
test("a delayed custom module is not executed after consent is revoked", async ({
  page,
}) => {
  const s = config.sites[0],
    c = s.campaigns[0];
  s.allowCustomJavaScript = true;
  c.presentation.type = "custom";
  c.custom = {
    code: "export function render({ reportShown }) { window.lateExecution = true; reportShown(); }",
    variables: {},
  };
  await saveConfig();
  let release, started;
  const requested = new Promise((r) => (started = r));
  const wait = new Promise((r) => (release = r));
  await page.route("**/v1/offer-script/**", async (route) => {
    const u = new URL(route.request().url());
    started();
    await wait;
    const r = await runtime.dispatch(u.pathname, {
      headers: route.request().headers(),
    });
    await route.fulfill({
      status: r.status,
      headers: Object.fromEntries(r.headers),
      body: Buffer.from(await r.arrayBuffer()),
    });
  });
  await visit(page);
  await decide(page);
  await requested;
  await page.evaluate(() => window.JevPersonalization.consent(false));
  release();
  await page.unrouteAll({ behavior: "wait" });
  expect(await page.evaluate(() => window.lateExecution)).toBeUndefined();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
test("image-only banners load successfully and count once", async ({
  page,
}) => {
  const c = config.sites[0].campaigns[0];
  c.presentation.imageOnly = true;
  c.content.imageUrl = "https://images.example.com/banner.svg";
  c.content.imageAlt = "特集バナー";
  await saveConfig();
  await page.route("https://images.example.com/**", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="green"/></svg>',
    }),
  );
  await visit(page);
  await decide(page);
  await expect(
    page.locator("aside").getByRole("img", { name: "特集バナー" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("jev:v1:demo")).delivery.guide.shown,
    ),
  ).toBe(1);
});
test("site design is inherited by multiple campaigns and raw JSON is not silently overwritten", async ({
  page,
}) => {
  const s = config.sites[0],
    second = structuredClone(s.campaigns[0]);
  second.id = "another";
  second.content.title = "別の施策";
  s.campaigns.push(second);
  await saveConfig();
  await login(page);
  await page.getByRole("tab", { name: "サイト設定・共通デザイン" }).click();
  await page.locator("#themeAccent").fill("#990011");
  await page.getByRole("tab", { name: "施策を編集する", exact: true }).click();
  await page.locator("#campaign").selectOption("another");
  await expect(page.locator("#offerPreview").getByRole("link")).toHaveCSS(
    "background-color",
    "rgb(153, 0, 17)",
  );
  await page.getByRole("button", { name: "保存して配信に反映" }).click();
  const row = await runtime.db
    .prepare("SELECT body FROM app_config WHERE id=1")
    .first();
  const value = JSON.parse(row.body);
  expect(value.sites[0].design.colors.accent).toBe("#990011");
  expect(value.sites[0].campaigns[0].design).toBeUndefined();
  await page.locator("#advanced > summary").click();
  await page.locator("#config").fill("{}");
  await page.getByRole("button", { name: "保存して配信に反映" }).click();
  await expect(page.locator("#status")).toContainText("JSONの変更を取り込む");
});
test("a site can be added with disabled collection and a new campaign without JSON", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("tab", { name: "サイト設定・共通デザイン" }).click();
  await page.getByText("別のサイトを追加する", { exact: true }).click();
  await page.locator("#newSiteId").fill("another-site");
  await page.getByRole("button", { name: "サイトを追加", exact: true }).click();
  await expect(page.locator("#currentSiteId")).toHaveValue("another-site");
  await expect(page.locator("#siteMetadataEnabled")).toHaveValue("false");
  await page.getByRole("button", { name: "施策を追加", exact: true }).click();
  await expect(page.locator("#enabled")).toHaveValue("false");
  await page.getByRole("button", { name: "保存して配信に反映" }).click();
  await expect(page.locator("#saveState")).toHaveText("設定を保存しました");
});
