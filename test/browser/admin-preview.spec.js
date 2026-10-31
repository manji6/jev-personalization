import { test, expect } from "@playwright/test";
import { startAdminPreview } from "../../scripts/preview-admin.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
let preview, baseURL, urls;
test.beforeAll(async () => {
  preview = await startAdminPreview({ port: 0 });
  baseURL = `http://127.0.0.1:${preview.address().port}`;
});
test.afterAll(
  async () =>
    new Promise((resolve, reject) =>
      preview.close((error) => (error ? reject(error) : resolve())),
    ),
);
test.beforeEach(async ({ page }) => {
  urls = [];
  page.on("request", (request) => urls.push(new URL(request.url()).pathname));
  await page.addInitScript(() => {
    window.violations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.violations.push(event.effectiveDirective),
    );
  });
  await page.goto(baseURL);
});
async function choose(page, label, value) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .locator(`[role="option"][data-value=${JSON.stringify(value)}]`)
    .click();
}
async function login(page) {
  await page.getByRole("button", { name: "パスキーでログイン" }).click();
  await page
    .getByRole("button", { name: "認証成功を再現", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^こんにちは、/ }),
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
  expect(urls).toEqual(["/"]);

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
  await choose(page, "サイトを切り替える", "studio");
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
  await choose(page, "権限を再現", "editor");
  await nav(page, "施策一覧");
  await expect(
    page.getByRole("button", { name: "新規施策を作成" }),
  ).toBeDisabled();
  expect(
    await page.getByRole("link", { name: "JevSense管理", exact: true }).count(),
  ).toBe(0);
  await choose(page, "権限を再現", "viewer");
  expect(await page.locator("#siteSwitcher option").count()).toBe(1);
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
  await choose(page, "サイトを切り替える", "studio");
  await expect(
    page.getByRole("dialog", { name: "未保存の変更があります" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "編集を続ける" }).click();
  await expect(page.getByLabel("施策名", { exact: true })).toHaveValue(
    "未保存の施策",
  );
  await choose(page, "サイトを切り替える", "studio");
  await page.getByRole("button", { name: "破棄して切り替える" }).click();
  await nav(page, "施策一覧");
  await expect(
    page.getByRole("button", {
      name: "読者のためのニュースレター",
      exact: true,
    }),
  ).toBeVisible();
  await choose(page, "サイトを切り替える", "atelier");
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
    .getByLabel("何を伝えたいですか？")
    .fill("吸汗速乾ポロシャツの特集を案内する");
  await page
    .getByLabel("どんな関心・状態に当てはまる人ですか？")
    .fill("吸汗速乾機能のあるポロシャツに関心がある");
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
  await page.getByLabel("表示名", { exact: true }).fill("高橋 結衣");
  await page
    .getByRole("button", { name: "招待を確認してパスキーを登録" })
    .click();
  await page.getByRole("button", { name: "登録成功を再現" }).click();
  await page.getByRole("link", { name: "アカウント・パスキー" }).click();
  await expect(page.getByText("ログインID（メール未検証）")).toBeVisible();
  expect(urls).toEqual(["/"]);
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
  await choose(page, "権限を再現", "admin");
  await page.evaluate(() => (location.hash = "/installation"));
  await expect(
    page.getByRole("heading", { name: "Superuserの権限が必要です。" }),
  ).toBeVisible();
});
test("setup and recovery scenarios explicitly simulate enrollment without actual WebAuthn", async ({
  page,
}) => {
  await choose(page, "シナリオ", "setup");
  await page.getByLabel("表示名", { exact: true }).fill("佐藤 美香");
  await page.getByRole("button", { name: "パスキー登録へ" }).click();
  await page.getByRole("button", { name: "登録成功を再現" }).click();
  await expect(
    page.getByRole("link", { name: "JevSense管理", exact: true }),
  ).toBeVisible();
  await choose(page, "シナリオ", "recover");
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
    page.getByRole("heading", { name: /^こんにちは、/ }),
  ).toBeVisible();
  expect(urls).toEqual(["/"]);
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
  await choose(page, "サイトを切り替える", "studio");
  await expect(
    page.getByRole("heading", { name: /^こんにちは、/ }),
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

test("standalone HTML opens directly from disk without a server", async ({
  page,
}) => {
  await page.goto(pathToFileURL(resolve("docs/prototypes/admin-v2.html")).href);
  await login(page);
  await nav(page, "施策一覧");
  await expect(
    page.getByRole("button", {
      name: "吸汗速乾ポロシャツのご案内",
      exact: true,
    }),
  ).toBeVisible();
});

test("question preview inserts both inputs verbatim with no generation or API access", async ({
  page,
}, testInfo) => {
  await login(page);
  await nav(page, "施策一覧");
  await page.getByRole("button", { name: "新規施策を作成" }).click();
  await page.getByLabel("施策名", { exact: true }).fill("機能訴求のテスト");
  const offer = "吸汗速乾ポロシャツの特集を案内する";
  const statement = "吸汗速乾機能のあるポロシャツに関心がある";
  await page.getByLabel("何を伝えたいですか？").fill(offer);
  await page
    .getByLabel("どんな関心・状態に当てはまる人ですか？")
    .fill(statement);
  const preview = page.locator("#judgmentPreview .question-text");
  expect(await preview.textContent()).toBe(
    `今回案内する内容：${offer}\n閲覧履歴と連携された行動・状態の情報に基づき、この閲覧者に「${statement}」が当てはまりますか？`,
  );
  await page.getByLabel("施策名", { exact: true }).fill("内部の施策名を変更");
  expect(await preview.textContent()).not.toContain("内部の施策名");
  await expect(page.locator("#previewStage")).not.toContainText("内部の施策名");
  await page
    .getByLabel("施策名", { exact: true })
    .fill("吸汗速乾ポロシャツのご案内");
  await page.getByLabel("何を伝えたいですか？").focus();
  expect(urls).toEqual(["/"]);
  expect(await page.evaluate(() => window.violations)).toEqual([]);
  await page.locator("#toast").evaluate((el) => {
    el.hidden = true;
  });
  await page.screenshot({
    path: testInfo.outputPath("admin-v2-conditions.png"),
    fullPage: true,
  });
});

test("missing audience or offer does not produce an incomplete question or allow delivery review", async ({
  page,
}) => {
  await login(page);
  await nav(page, "施策一覧");
  await page.getByRole("button", { name: "新規施策を作成" }).click();
  await page.getByLabel("施策名", { exact: true }).fill("未入力の確認");
  await page
    .getByLabel("どんな関心・状態に当てはまる人ですか？")
    .fill("速乾性に関心がある");
  await expect(page.locator("#judgmentPreview .question-text")).toHaveCount(0);
  await page
    .getByRole("button", { name: "配信内容を確認", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#toast")).toHaveText(
    "訴求内容と判定したい関心・状態を入力してください。",
  );
  await page.getByLabel("何を伝えたいですか？").fill("ポロシャツを紹介する");
  await expect(page.locator("#judgmentPreview .question-text")).toHaveCount(1);
  await page.getByLabel("どんな関心・状態に当てはまる人ですか？").fill("   ");
  await expect(page.locator("#judgmentPreview .question-text")).toHaveCount(0);
});

test("writing examples and compound warning guide input without rewriting it", async ({
  page,
}) => {
  await login(page);
  await nav(page, "施策一覧");
  await page.getByRole("button", { name: "新規施策を作成" }).click();
  await page.getByText("書き方の例を見る", { exact: true }).click();
  await page
    .getByRole("button", { name: "BtoBの例を入れる", exact: true })
    .click();
  await expect(page.getByLabel("何を伝えたいですか？")).toHaveValue(
    "予約管理サービスの導入事例と比較ガイドを紹介する",
  );
  await expect(
    page.getByLabel("どんな関心・状態に当てはまる人ですか？"),
  ).toHaveValue("予約管理サービスの導入を比較・検討している");
  const statement = "予約管理に関心がある、かつ導入事例を比較している";
  await page
    .getByLabel("どんな関心・状態に当てはまる人ですか？")
    .fill(statement);
  await expect(
    page.locator("#judgmentPreview .question-warning"),
  ).toBeVisible();
  expect(
    await page.locator("#judgmentPreview .question-text").textContent(),
  ).toContain(`「${statement}」`);
  await expect(page.locator("#judgmentPreview .question-text")).toHaveCount(1);
  expect(urls).toEqual(["/"]);
});

test("question preview safely displays text and survives draft save and tab changes", async ({
  page,
}) => {
  await login(page);
  await nav(page, "施策一覧");
  await page.getByRole("button", { name: "新規施策を作成" }).click();
  await page.getByLabel("施策名", { exact: true }).fill("文字列の確認");
  await page
    .getByLabel("何を伝えたいですか？")
    .fill('<img src=x onerror="window.unwanted=1">について案内する');
  await page
    .getByLabel("どんな関心・状態に当てはまる人ですか？")
    .fill("「快適さ」に関心がある");
  const before = await page
    .locator("#judgmentPreview .question-text")
    .textContent();
  await expect(page.locator("#judgmentPreview img")).toHaveCount(0);
  expect(await page.evaluate(() => window.unwanted)).toBeUndefined();
  await page
    .getByRole("button", { name: "表示コンテンツ", exact: true })
    .click();
  await page.getByRole("button", { name: "対象者・条件", exact: true }).click();
  expect(
    await page.locator("#judgmentPreview .question-text").textContent(),
  ).toBe(before);
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  await page.getByRole("button", { name: "文字列の確認", exact: true }).click();
  expect(
    await page.locator("#judgmentPreview .question-text").textContent(),
  ).toBe(before);
});

test("real-page preview checks URL range and simulates one launch without opening a page or calling APIs", async ({
  page,
  context,
}) => {
  await login(page);
  await nav(page, "施策一覧");
  const row = page.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "吸汗速乾ポロシャツのご案内",
      exact: true,
    }),
  });
  await row.getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "実ページプレビュー", exact: true }),
  ).toBeVisible();
  const url = page.getByLabel("動作確認するページURL");
  const start = page.getByRole("button", {
    name: "プレビューを開始（モック）",
    exact: true,
  });
  for (const bad of [
    "https://other.example.com/ja/",
    "https://atelier.example.com/other/",
    "https://atelier.example.com/account",
    "https://user:pass@atelier.example.com/ja/",
    "http://atelier.example.com/ja/",
  ]) {
    await url.fill(bad);
    await expect(start).toBeDisabled();
  }
  await url.fill("https://atelier.example.com/ja/polo/?color=blue#details");
  await expect(start).toBeEnabled();
  const pages = context.pages().length;
  await start.click();
  await expect(page.getByRole("dialog")).toContainText(
    "この起動で開いたタブの1回だけ",
  );
  await expect(page.getByRole("dialog")).toContainText("Jevに問い合わせず");
  await expect(
    page.getByRole("button", { name: "この起動は使用済みです" }),
  ).toBeDisabled();
  expect(context.pages().length).toBe(pages);
  expect(urls).toEqual(["/"]);
  await page.getByRole("button", { name: "一覧へ戻る", exact: true }).click();
  await expect(row).toContainText("配信中");
});

test("draft campaigns can preview but viewers cannot start it", async ({
  page,
}) => {
  await login(page);
  await nav(page, "施策一覧");
  const draft = page.getByRole("row").filter({
    has: page.getByRole("button", {
      name: "はじめての方へ、選び方ガイド",
      exact: true,
    }),
  });
  await draft.getByRole("button", { name: "プレビュー", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "プレビューを開始（モック）",
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await choose(page, "権限を再現", "viewer");
  await nav(page, "施策一覧");
  const buttons = page.getByRole("button", { name: "プレビュー", exact: true });
  expect(await buttons.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) await expect(button).toBeDisabled();
});

test("display name can be edited in the account and is shared across sites", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "アカウント・パスキー" }).click();
  const email = await page.getByLabel("ログイン用メールアドレス").inputValue();
  await page.getByLabel("表示名", { exact: true }).fill("新しい表示名");
  await page
    .getByRole("button", { name: "プロフィールを保存", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "アカウント・パスキー" }),
  ).toContainText("新しい表示名");
  await expect(page.getByLabel("ログイン用メールアドレス")).toHaveValue(email);
  await nav(page, "ホーム");
  await expect(
    page.getByRole("heading", { name: "こんにちは、新しい表示名さん。" }),
  ).toBeVisible();
  await choose(page, "サイトを切り替える", "studio");
  await expect(
    page.getByRole("heading", { name: "こんにちは、新しい表示名さん。" }),
  ).toBeVisible();
  await nav(page, "メンバー");
  await expect(page.getByText("新しい表示名", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "JevSense管理", exact: true }).click();
  await page
    .getByRole("button", { name: "ユーザーと権限", exact: true })
    .click();
  await expect(page.getByText("新しい表示名", { exact: true })).toBeVisible();
  expect(urls).toEqual(["/"]);
});

test("setup and invitation require a name and carry it into the account", async ({
  page,
}) => {
  await choose(page, "シナリオ", "setup");
  await page.getByRole("button", { name: "パスキー登録へ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("表示名", { exact: true }).fill("初回 管理者");
  await page.getByRole("button", { name: "パスキー登録へ" }).click();
  await page
    .getByRole("button", { name: "登録成功を再現", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "こんにちは、初回 管理者さん。" }),
  ).toBeVisible();
  await choose(page, "シナリオ", "invite");
  await page
    .getByRole("button", { name: "招待を確認してパスキーを登録" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("表示名", { exact: true }).fill("参加した メンバー");
  await page
    .getByRole("button", { name: "招待を確認してパスキーを登録" })
    .click();
  await page
    .getByRole("button", { name: "登録成功を再現", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "こんにちは、参加した メンバーさん。" }),
  ).toBeVisible();
});

test("profile cancel preserves the saved name and user text never becomes markup", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "アカウント・パスキー" }).click();
  const old = await page.getByLabel("表示名", { exact: true }).inputValue();
  await page.getByLabel("表示名", { exact: true }).fill("取り消す 名前");
  await page
    .getByRole("button", { name: "変更を取り消す", exact: true })
    .click();
  await expect(page.getByLabel("表示名", { exact: true })).toHaveValue(old);
  await page
    .getByLabel("表示名", { exact: true })
    .fill('<img src=x onerror="window.badName=1">');
  await page
    .getByRole("button", { name: "プロフィールを保存", exact: true })
    .click();
  await nav(page, "ホーム");
  await expect(
    page.getByRole("heading", { name: /こんにちは、<img/ }),
  ).toBeVisible();
  expect(await page.locator("#app img").count()).toBe(0);
  expect(await page.evaluate(() => window.badName)).toBeUndefined();
});

test("site picker uses styled options with domain, role, selected marker and keyboard support", async ({
  page,
}, testInfo) => {
  await login(page);
  const picker = page.getByRole("combobox", {
    name: "サイトを切り替える",
    exact: true,
  });
  await picker.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(
    page.getByRole("option", { name: /Atelier Store/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("option", { name: /Studio Journal/ }),
  ).toContainText("journal.example.com");
  await expect(
    page.getByRole("option", { name: /Studio Journal/ }),
  ).toContainText("Superuser");
  await expect(page.getByRole("listbox")).toHaveCSS("border-radius", "10px");
  await page.locator("#toast").evaluate((el) => {
    el.hidden = true;
  });
  await page.screenshot({
    path: testInfo.outputPath("admin-v2-site-picker.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(picker).toBeFocused();
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  await picker.press("ArrowDown");
  await picker.press("End");
  await picker.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "サイトを切り替える", exact: true }),
  ).toContainText("Studio Journal");
  expect(await page.evaluate(() => window.violations)).toEqual([]);
});

test("selectors in dialogs and settings share styles and preserve form values", async ({
  page,
}) => {
  await login(page);
  await nav(page, "メンバー");
  await page.getByRole("button", { name: "メンバーを招待" }).click();
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("read-only@example.com");
  const role = page.getByRole("combobox", {
    name: "このサイトでの権限",
    exact: true,
  });
  await role.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCSS("border-radius", "10px");
  await role.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(role).toBeFocused();
  await role.click();
  await page.locator('[role="option"][data-value="viewer"]').click();
  await page.getByRole("button", { name: "招待を作成（モック）" }).click();
  await page.getByRole("button", { name: "一覧へ戻る", exact: true }).click();
  const invitation = page
    .locator(".list-row")
    .filter({ hasText: "read-only@example.com" });
  await expect(invitation).toContainText("閲覧者");
  await nav(page, "サイト設定");
  await page.getByRole("button", { name: "共通デザイン", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "基本の雰囲気", exact: true }),
  ).toBeEnabled();
  await choose(page, "権限を再現", "editor");
  await nav(page, "サイト設定");
  await page.getByRole("button", { name: "共通デザイン", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "基本の雰囲気", exact: true }),
  ).toBeDisabled();
});

test("custom menu fits mobile, closes outside, and supports typeahead", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const picker = page.getByRole("combobox", {
    name: "サイトを切り替える",
    exact: true,
  });
  await picker.click();
  const box = await page.getByRole("listbox").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await picker.press("s");
  await picker.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "サイトを切り替える", exact: true }),
  ).toContainText("Studio Journal");
  await page
    .getByRole("combobox", { name: "サイトを切り替える", exact: true })
    .click();
  await page.getByRole("heading", { name: /こんにちは、/ }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});
