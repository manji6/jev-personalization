import { test, expect } from "@playwright/test";
import { cloudflareFixture } from "../cloudflare-fixture.js";
let runtime, urls;
test.beforeEach(async ({ page }) => {
  runtime = await cloudflareFixture();
  urls = [];
  await page.route("https://api.example.com/**", async (route) => {
    const u = new URL(route.request().url());
    urls.push(u.pathname);
    const r = await runtime.dispatch(u.pathname, {
      method: route.request().method(),
    });
    await route.fulfill({
      status: r.status,
      headers: Object.fromEntries(r.headers),
      body: Buffer.from(await r.arrayBuffer()),
    });
  });
  await page.addInitScript(() => {
    window.violations = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.violations.push(e.effectiveDirective),
    );
  });
  await page.goto("https://api.example.com/admin-preview");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
  await runtime.mf.dispose();
});
async function login(page) {
  await page.getByRole("button", { name: "パスキーでログイン" }).click();
  await page
    .getByRole("button", { name: "認証成功を再現", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "こんにちは、美香さん。" }),
  ).toBeVisible();
}
async function nav(page, name) {
  await page
    .getByRole("navigation", { name: "サイトのメニュー" })
    .getByRole("link", { name, exact: true })
    .click();
}

test("prototype has independent CSP and mock login; never contacts APIs or models", async ({
  page,
}, testInfo) => {
  await page.locator("#toast").evaluate((el) => {
    el.hidden = true;
  });
  await page.screenshot({
    path: testInfo.outputPath("admin-v2-login.png"),
    fullPage: true,
  });
  await login(page);
  await expect(
    page.getByText("配信実績・効果の集計は、別途設計して追加します。", {
      exact: false,
    }),
  ).toBeVisible();
  expect(urls).toEqual(["/admin-preview"]);
  expect(runtime.calls()).toBe(0);
  expect(await page.evaluate(() => window.violations)).toEqual([]);
  await page.locator("#toast").evaluate((el) => {
    el.hidden = true;
  });
  await page.screenshot({
    path: testInfo.outputPath("admin-v2-home.png"),
    fullPage: true,
  });
});
test("site switching is reflected in campaigns; editor becomes viewer on another site", async ({
  page,
}) => {
  await login(page);
  await nav(page, "施策一覧");
  await expect(
    page.getByRole("button", {
      name: "吸汗速乾ポロシャツのご案内",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("サイトを切り替える").selectOption("studio");
  await nav(page, "施策一覧");
  await expect(
    page.getByRole("button", {
      name: "読者のためのニュースレター",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "吸汗速乾ポロシャツのご案内",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel("権限を再現").selectOption("editor");
  await nav(page, "施策一覧");
  await expect(
    page.getByRole("button", { name: "新規施策を作成" }),
  ).toBeDisabled();
  expect(
    await page.getByRole("link", { name: "JevSense管理", exact: true }).count(),
  ).toBe(0);
  await page.getByLabel("権限を再現").selectOption("viewer");
  expect(
    await page.getByLabel("サイトを切り替える").locator("option").count(),
  ).toBe(1);
});
test("unsaved changes guard site switching and discard keeps other site untouched", async ({
  page,
}) => {
  await login(page);
  await nav(page, "施策一覧");
  await page
    .getByRole("button", { name: "吸汗速乾ポロシャツのご案内", exact: true })
    .click();
  await page.getByLabel("施策名", { exact: true }).fill("未保存の施策");
  await page.getByLabel("サイトを切り替える").selectOption("studio");
  await expect(
    page.getByRole("dialog", { name: "未保存の変更があります" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "編集を続ける" }).click();
  await expect(page.getByLabel("施策名", { exact: true })).toHaveValue(
    "未保存の施策",
  );
  await page.getByLabel("サイトを切り替える").selectOption("studio");
  await page.getByRole("button", { name: "破棄して切り替える" }).click();
  await nav(page, "施策一覧");
  await expect(
    page.getByRole("button", {
      name: "読者のためのニュースレター",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("サイトを切り替える").selectOption("atelier");
  await nav(page, "施策一覧");
  await expect(
    page.getByRole("button", {
      name: "吸汗速乾ポロシャツのご案内",
      exact: true,
    }),
  ).toBeVisible();
});
test("new campaign flows through content and delivery confirmation into filtered list", async ({
  page,
}, testInfo) => {
  await login(page);
  await nav(page, "施策一覧");
  await page.getByRole("button", { name: "新規施策を作成" }).click();
  await page.getByLabel("施策名", { exact: true }).fill("新規レビュー施策");
  await page
    .getByLabel("どんな人に、どんな状態で届けたいですか？")
    .fill("ポロシャツに関心がありそうな人");
  await page
    .getByRole("button", { name: "表示コンテンツ", exact: true })
    .click();
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("夏の新作をご案内します。");
  await page
    .getByRole("button", { name: "配信内容を確認", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("新規レビュー施策");
  await page
    .getByRole("button", { name: "配信開始を再現", exact: true })
    .click();
  await page
    .getByRole("button", { name: /配信中/ })
    .first()
    .click();
  await page.getByLabel("施策を検索").fill("新規レビュー");
  await expect(
    page.getByRole("button", { name: "新規レビュー施策", exact: true }),
  ).toBeVisible();
  expect(runtime.calls()).toBe(0);
  await page.locator("#toast").evaluate((el) => {
    el.hidden = true;
  });
  await page.screenshot({
    path: testInfo.outputPath("admin-v2-campaigns.png"),
    fullPage: true,
  });
});
test("manual invitation shows a sample link and passkey enrollment rather than email delivery", async ({
  page,
}) => {
  await login(page);
  await nav(page, "メンバー");
  await page.getByRole("button", { name: "メンバーを招待" }).click();
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("invited@example.com");
  await page
    .getByRole("button", { name: "招待を作成（モック）", exact: true })
    .click();
  await expect(page.getByLabel("共有する招待リンク")).toHaveValue(
    /DEMO-NOT-VALID/,
  );
  await page.getByRole("button", { name: "招待された側の画面を見る" }).click();
  await expect(
    page.getByText("invited@example.com", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "招待を確認してパスキーを登録" })
    .click();
  await page.getByRole("button", { name: "登録成功を再現" }).click();
  await page.getByRole("link", { name: "アカウント・パスキー" }).click();
  await expect(page.getByText("ログインID（メール未検証）")).toBeVisible();
  expect(urls).toEqual(["/admin-preview"]);
});
test("Superuser has system settings; site administrators cannot enter them", async ({
  page,
}, testInfo) => {
  await login(page);
  await page.getByRole("link", { name: "JevSense管理", exact: true }).click();
  await page.getByRole("button", { name: "JevSense設定", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "JevSense共通設定" }),
  ).toBeVisible();
  await expect(page.getByLabel("接続キー")).toBeDisabled();
  await page.locator("#toast").evaluate((el) => {
    el.hidden = true;
  });
  await page.screenshot({
    path: testInfo.outputPath("admin-v2-superuser.png"),
    fullPage: true,
  });
  await page.getByLabel("権限を再現").selectOption("admin");
  await page.evaluate(() => (location.hash = "/installation"));
  await expect(
    page.getByRole("heading", { name: "Superuserの権限が必要です。" }),
  ).toBeVisible();
});
test("setup and recovery scenarios explicitly simulate enrollment without actual WebAuthn", async ({
  page,
}) => {
  await page.getByLabel("シナリオ").selectOption("setup");
  await page.getByRole("button", { name: "パスキー登録へ" }).click();
  await page.getByRole("button", { name: "登録成功を再現" }).click();
  await expect(
    page.getByRole("link", { name: "JevSense管理", exact: true }),
  ).toBeVisible();
  await page.getByLabel("シナリオ").selectOption("recover");
  await page.getByLabel("リカバリーコード", { exact: true }).fill("DEMO-CODE");
  await page
    .getByRole("button", { name: "リカバリーコードで復旧", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "コード入力だけで管理画面へは入りません",
  );
  await page.getByRole("button", { name: "パスキー再登録へ" }).click();
  await page.getByRole("button", { name: "登録成功を再現" }).click();
  await expect(
    page.getByRole("heading", { name: "こんにちは、美香さん。" }),
  ).toBeVisible();
  expect(urls).toEqual(["/admin-preview"]);
});
test("mobile navigation and site header fit the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await nav(page, "施策一覧");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("サイトを切り替える").selectOption("studio");
  await expect(
    page.getByRole("heading", { name: "こんにちは、美香さん。" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#toast").evaluate((el) => {
    el.hidden = true;
  });
  await page.screenshot({
    path: testInfo.outputPath("admin-v2-mobile.png"),
    fullPage: true,
  });
});
