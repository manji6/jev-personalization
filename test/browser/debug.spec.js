import { test, expect } from "@playwright/test";
import { cloudflareFixture, adminToken } from "../cloudflare-fixture.js";
import { fixture } from "../helpers.js";
let runtime, granted, shortExpiry, requests;
test.beforeEach(async ({ context }) => {
  granted = true;
  shortExpiry = false;
  requests = [];
  const config = fixture();
  config.sites[0].minVisibleMs = 1000;
  config.sites[0].minQualifiedVisits = 1;
  config.sites[0].campaigns[0].threshold = 0.99;
  runtime = await cloudflareFixture({ config });
  await context.route("https://api.example.com/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    requests.push({
      path: url.pathname,
      headers: req.headers(),
      body: req.postData(),
    });
    const r = await runtime.dispatch(url.pathname + url.search, {
      method: req.method(),
      headers: req.headers(),
      body: req.postData() ?? undefined,
    });
    if (shortExpiry && url.pathname === "/v1/debug-session" && r.status === 200)
      return route.fulfill({
        status: 200,
        headers: Object.fromEntries(r.headers),
        json: { expiresAt: Date.now() + 2000 },
      });
    await route.fulfill({
      status: r.status,
      headers: Object.fromEntries(r.headers),
      body: Buffer.from(await r.arrayBuffer()),
    });
  });
  await context.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="utf-8"><title>導入方法</title><script type="application/ld+json">{"@type":"Product","name":"Polo guide","description":"Sports clothing","keywords":"polo,sports"}</script></head><body><h1>サンプルサイト</h1><input value="private-form@example.com"><script defer src="https://api.example.com/sdk.js" data-site="demo" ${granted ? 'data-consent="granted"' : ""}></script></body></html>`,
    }),
  );
});
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: "wait" });
  await runtime.mf.dispose();
});
async function login(page) {
  await page.goto("https://api.example.com/admin");
  await page.locator("#token").fill(adminToken);
  await page.locator("#load").click();
  await expect(page.locator("#connectionLabel")).toHaveText("接続済み");
}
async function launch(page) {
  await login(page);
  await page
    .locator("#debugTarget")
    .fill("https://www.example.com/guides/a?omit=private#omit");
  const opening = page.waitForEvent("popup");
  await page.locator("#startDebug").click();
  const popup = await opening;
  await expect(popup.locator("[data-jevsense-debug]")).toHaveCount(1);
  await expect(page.locator("#debugStatus")).toContainText("接続しました");
  return popup;
}
const panel = (page) => page.locator("[data-jevsense-debug]");

test("admin launches a real cross-origin panel with measured data and actual authorized trace", async ({
  page,
}, testInfo) => {
  const popup = await launch(page),
    ui = panel(popup);
  await expect(ui).toContainText("同意取得済み・計測有効");
  await expect.poll(() => runtime.calls()).toBe(1);
  await ui.getByRole("button", { name: "閲覧・行動", exact: true }).click();
  await expect(ui).toContainText("Polo guide");
  await expect(ui).toContainText("JSON-LD");
  await expect(ui).not.toContainText("private-form@example.com");
  await ui.getByRole("button", { name: "判定履歴", exact: true }).click();
  await expect(ui).toContainText("mock-jev");
  await ui
    .locator("summary")
    .filter({ hasText: "判断APIの応答" })
    .first()
    .click();
  await expect(ui.getByText(/Jevに問い合わせました/)).toBeVisible();
  await ui
    .locator("summary")
    .filter({ hasText: "導入ガイド (guide)" })
    .first()
    .click();
  await expect(ui.getByText(/0.950/)).toBeVisible();
  expect(popup.url()).toBe("https://www.example.com/guides/a");
  const diagnostic = requests.filter(
    (r) => r.path === "/v1/decision" && r.headers["x-jevsense-debug"],
  );
  expect(diagnostic.length).toBeGreaterThan(0);
  expect(
    diagnostic.every((r) => !r.body.includes("private-form@example.com")),
  ).toBe(true);
  expect(
    diagnostic.every((r) => !JSON.stringify(r.headers).includes(adminToken)),
  ).toBe(true);
  await ui.locator("section").screenshot({
    path: testInfo.outputPath("debug-panel.png"),
  });
});

test("diagnosis never grants consent or causes model requests; revoke clears collected diagnostic data", async ({
  page,
}) => {
  granted = false;
  const popup = await launch(page),
    ui = panel(popup);
  await expect(ui).toContainText("計測停止中");
  expect(runtime.calls()).toBe(0);
  expect(requests.filter((r) => r.path === "/v1/decision")).toHaveLength(0);
  expect(await popup.evaluate(() => sessionStorage.length)).toBe(0);
  await popup.evaluate(() => window.JevPersonalization.consent(true));
  await expect.poll(() => runtime.calls()).toBe(1);
  await ui.getByRole("button", { name: "判定履歴", exact: true }).click();
  await expect(ui).toContainText("mock-jev");
  await popup.evaluate(() => window.JevPersonalization.consent(false));
  await expect(ui).not.toContainText("mock-jev");
  await expect(ui).not.toContainText("Polo guide");
  expect(await popup.evaluate(() => sessionStorage.length)).toBe(0);
});

test("full navigation reauthorizes in memory; ending diagnosis prevents reopening on navigation", async ({
  page,
}) => {
  const popup = await launch(page);
  await popup.goto("https://www.example.com/guides/b");
  await expect(panel(popup)).toHaveCount(1);
  const keys = await popup.evaluate(() => Object.keys(sessionStorage));
  expect(keys).toEqual(["jev:v1:demo"]);
  expect(
    await popup.evaluate(() => JSON.stringify(sessionStorage)),
  ).not.toContain("jevsense-debug-v1");
  await panel(popup).getByRole("button", { name: "終了", exact: true }).click();
  await expect(page.locator("#debugStatus")).toContainText(
    "診断を終了しました",
  );
  await popup.goto("https://www.example.com/guides/c");
  await expect(panel(popup)).toHaveCount(0);
  await popup.waitForTimeout(200);
  expect(await panel(popup).count()).toBe(0);
});

test("expiration clears records and diagnostic headers while normal decisions continue", async ({
  page,
}) => {
  shortExpiry = true;
  const popup = await launch(page),
    ui = panel(popup);
  await expect(
    ui.getByText(
      "診断の有効期限が切れました。管理画面から再度開始してください。",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 5000 });
  const count = requests.filter((r) => r.path === "/v1/decision").length;
  await popup.evaluate(() =>
    window.JevPersonalization.setFact("registered", false),
  );
  await expect
    .poll(() => requests.filter((r) => r.path === "/v1/decision").length)
    .toBe(count + 1);
  expect(
    requests.filter((r) => r.path === "/v1/decision").at(-1).headers[
      "x-jevsense-debug"
    ],
  ).toBeUndefined();
  await expect(ui).not.toContainText("mock-jev");
});

test("normal visitors and forged diagnostic messages cannot open the panel", async ({
  page,
  context,
}) => {
  await login(page);
  const opened = page.waitForEvent("popup");
  await page.evaluate(() => window.open("https://www.example.com/guides/a"));
  const popup = await opened;
  await popup.waitForLoadState();
  await popup.evaluate(() =>
    dispatchEvent(
      new MessageEvent("message", {
        origin: "https://api.example.com",
        source: opener,
        data: {
          type: "jevsense:debug-start",
          siteId: "demo",
          token: "forged.invalid",
        },
      }),
    ),
  );
  await popup.waitForTimeout(200);
  expect(await panel(popup).count()).toBe(0);
  const ordinary = await context.newPage();
  await ordinary.goto("https://www.example.com/guides/a");
  expect(await panel(ordinary).count()).toBe(0);
});

test("panel fits mobile and can be folded without affecting normal page content", async ({
  page,
}) => {
  const popup = await launch(page);
  await popup.setViewportSize({ width: 390, height: 844 });
  const ui = panel(popup);
  const rect = await ui.locator("section").boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(390);
  await ui.getByRole("button", { name: "折りたたむ", exact: true }).click();
  await expect(
    ui.getByRole("button", { name: "現在の状態", exact: true }),
  ).toBeHidden();
  await ui.getByRole("button", { name: "開く", exact: true }).click();
  await expect(
    ui.getByRole("button", { name: "現在の状態", exact: true }),
  ).toBeVisible();
  await expect(
    popup.getByRole("heading", { name: "サンプルサイト" }),
  ).toBeVisible();
});

test("a diagnostic response arriving after consent withdrawal cannot restore erased history", async ({
  page,
  context,
}) => {
  let release, started;
  const wait = new Promise((r) => {
    release = r;
  });
  const requested = new Promise((r) => {
    started = r;
  });
  await context.route("**/v1/decision?siteId=demo", async (route) => {
    const req = route.request();
    const r = await runtime.dispatch("/v1/decision?siteId=demo", {
      method: req.method(),
      headers: req.headers(),
      body: req.postData(),
    });
    if (req.headers()["x-jevsense-debug"]) {
      started();
      await wait;
    }
    await route.fulfill({
      status: r.status,
      headers: Object.fromEntries(r.headers),
      body: Buffer.from(await r.arrayBuffer()),
    });
  });
  const popup = await launch(page),
    ui = panel(popup);
  await requested;
  await popup.evaluate(() => window.JevPersonalization.consent(false));
  const response = popup.waitForResponse("**/v1/decision?siteId=demo");
  release();
  await response;
  await ui.getByRole("button", { name: "判定履歴", exact: true }).click();
  await expect(ui).not.toContainText("mock-jev");
  await expect(ui).not.toContainText("Polo guide");
  expect(await popup.evaluate(() => sessionStorage.length)).toBe(0);
});
