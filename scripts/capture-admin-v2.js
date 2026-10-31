// Reproducible screenshots of the real UI with an ephemeral synthetic account.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { buildManagedApp } from "../src/app.js";
import { fixture } from "../test/helpers.js";
const config = fixture();
config.sites[0].name = "Atelier Store";
const token = "capture-only-bootstrap-".repeat(3),
  origin = "https://review.example.com";
const { app } = await buildManagedApp({
  databasePath: ":memory:",
  config,
  origin,
  secret: "capture-only-secret-".repeat(3),
  bootstrapToken: token,
  jev: async () => {
    throw Error("Not used");
  },
});
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  await context.route(origin + "/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    const r = await app.inject({
      url: u.pathname + u.search,
      method: req.method(),
      headers: { ...req.headers(), host: "review.example.com" },
      payload: req.postData() ?? undefined,
    });
    await route.fulfill({
      status: r.statusCode,
      headers: r.headers,
      body: r.body,
    });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await mkdir("docs/images", { recursive: true });
  const capture = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/images/admin-v2-implemented-${name}.png`,
      fullPage: true,
    });
  };
  await page.goto(origin + "/admin");
  await page.getByLabel("表示名", { exact: true }).waitFor();
  await capture("setup");
  await page.getByLabel("表示名", { exact: true }).fill("佐藤 美香");
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("owner@example.com");
  await page.getByLabel("初回登録用の管理トークン").fill(token);
  await page.getByRole("button", { name: "パスキーを登録する" }).click();
  await page
    .getByRole("heading", { name: "こんにちは、佐藤 美香さん。" })
    .waitFor();
  await capture("home");
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  await page.getByLabel("施策名", { exact: true }).fill("夏のポロシャツ特集");
  await page
    .getByLabel("何を伝えたいですか？", { exact: true })
    .fill("吸汗速乾ポロシャツの特集を案内する");
  await page
    .getByLabel("どんな関心・状態に当てはまる人ですか？", { exact: true })
    .fill("吸汗速乾機能のあるポロシャツに関心がある");
  await capture("editor");
  await page
    .getByRole("button", { name: "表示コンテンツ", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "表示タイトル", exact: true })
    .fill("さらりと、軽やかに。");
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("夏を心地よく過ごすポロシャツをご紹介します。");
  await page.getByLabel("メッセージ", { exact: true }).blur();
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "下書きを保存" }).waitFor();
  await capture("content");
  await page.locator('a[data-nav="account"]').click();
  await page.getByRole("heading", { name: "あなたの、アカウント。" }).waitFor();
  await capture("account");
  await page.locator('a[data-nav="settings"]').click();
  await page.getByRole("button", { name: "共通デザイン", exact: true }).click();
  await page.getByLabel("背景色", { exact: true }).waitFor();
  await capture("design");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('a[data-nav="campaigns"]').click();
  await page
    .getByRole("heading", { name: "伝えたいことを、ちょうどいい人へ。" })
    .waitFor();
  await capture("mobile");
} finally {
  await browser.close();
  await app.close();
}
