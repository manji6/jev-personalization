import { test, expect } from "@playwright/test";
import { buildManagedApp } from "../../src/app.js";
import { fixture } from "../helpers.js";
const origin = "https://admin.example.com",
  token = "test-bootstrap-".repeat(4);
let app, db, calls, admin, authenticator;
async function virtualPasskey(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  return { cdp, authenticatorId };
}
async function routeContext(context) {
  await context.route(origin + "/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    const r = await app.inject({
      url: u.pathname + u.search,
      method: req.method(),
      headers: { ...req.headers(), host: "admin.example.com" },
      payload: req.postData() ?? undefined,
    });
    await route.fulfill({
      status: r.statusCode,
      headers: r.headers,
      body: r.body,
    });
  });
}
async function setup(page) {
  await page.goto(origin + "/admin");
  await page.getByLabel("表示名", { exact: true }).fill("佐藤 美香");
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("owner@example.com");
  await page.getByLabel("初回登録用の管理トークン").fill(token);
  await page.getByRole("button", { name: "パスキーを登録する" }).click();
  await expect(
    page.getByRole("heading", { name: "こんにちは、佐藤 美香さん。" }),
  ).toBeVisible();
}
async function getCSRF(page) {
  return page.evaluate(
    async () => (await (await fetch("/auth/session")).json()).csrf,
  );
}
async function browserAPI(page, path, method = "GET", body, revision) {
  return page.evaluate(
    async ({ path, method, body, revision }) => {
      const session = await (await fetch("/auth/session")).json();
      const r = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-JevSense-CSRF": session.csrf,
          ...(revision ? { "If-Match": revision } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, ...(await r.json()) };
    },
    { path, method, body, revision },
  );
}
test.beforeEach(async ({ page, context }) => {
  calls = 0;
  const built = await buildManagedApp({
    databasePath: ":memory:",
    config: fixture(),
    origin,
    secret: "test-auth-secret-".repeat(4),
    bootstrapToken: token,
    jev: async () => {
      calls++;
      return { model: "stub", answers: { c0q0: { noul: 0.95 } } };
    },
  });
  app = built.app;
  db = built.db;
  admin = built.administration;
  await routeContext(context);
  authenticator = await virtualPasskey(page);
});
test.afterEach(async () => app.close());
test("real passkey setup, secure cookie, profile persistence, logout and signed login", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "__Host-jevsense_session",
  );
  expect(cookie.secure).toBeTruthy();
  expect(cookie.httpOnly).toBeTruthy();
  expect(cookie.sameSite).toBe("Lax");
  await page.locator('a[data-nav="account"]').click();
  await expect(
    page.getByRole("heading", { name: "あなたの、アカウント。" }),
  ).toBeVisible();
  await page.getByLabel("表示名", { exact: true }).fill("三浦 さくら");
  await page.getByRole("button", { name: "プロフィールを保存" }).click();
  await expect(page.getByRole("status")).toContainText("表示名を保存");
  await page.reload();
  await expect(page.getByLabel("表示名", { exact: true })).toHaveValue(
    "三浦 さくら",
  );
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("owner@example.com");
  await page
    .getByRole("button", { name: "パスキーでログイン", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "こんにちは、三浦 さくらさん。" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(calls).toBe(0);
});
test("guided editing saves isolated draft, renders question preview, publishes and preserves theme settings", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "新しい施策をつくる。" }),
  ).toBeVisible();
  await page.getByLabel("施策名", { exact: true }).fill("夏のポロシャツ");
  await page
    .getByLabel("何を伝えたいですか？", { exact: true })
    .fill("吸汗速乾ポロシャツの特集を案内する");
  await page
    .getByLabel("どんな関心・状態に当てはまる人ですか？", { exact: true })
    .fill("吸汗速乾機能のあるポロシャツに関心がある");
  await expect(page.locator("#questionPreview")).toContainText(
    "今回案内する内容：吸汗速乾ポロシャツの特集を案内する",
  );
  await page
    .getByRole("button", { name: "表示コンテンツ", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "表示タイトル", exact: true })
    .fill("さらりと、軽やかに。");
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("夏におすすめのご案内");
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("下書きを保存");
  expect((await admin.repo.publicConfig()).sites[0].campaigns.length).toBe(1); // existing fixture only
  await page
    .getByRole("button", { name: "配信内容を確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で配信開始", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "伝えたいことを、ちょうどいい人へ。" }),
  ).toBeVisible();
  expect((await admin.repo.publicConfig()).sites[0].campaigns.length).toBe(2);
  expect(calls).toBe(0);
  await page.locator('a[data-nav="settings"]').click();
  await page.getByRole("button", { name: "共通デザイン", exact: true }).click();
  await page.getByLabel("モーダルの幅", { exact: true }).fill("560");
  await page.getByRole("button", { name: "設定を保存" }).click();
  await expect(page.getByRole("status")).toContainText("サイト設定を保存");
  expect((await admin.repo.publicConfig()).sites[0].design.modal.width).toBe(
    560,
  );
});
test("manual invitation registers new user; site membership and viewer restrictions are real", async ({
  page,
  browser,
}) => {
  await setup(page);
  const data = await browserAPI(
    page,
    "/admin/api/v2/sites/demo/invitations",
    "POST",
    { email: "viewer@example.com", role: "viewer" },
  );
  expect(data.status).toBe(200);
  const context = await browser.newContext();
  await routeContext(context);
  const invited = await context.newPage();
  await virtualPasskey(invited);
  await invited.goto(data.url);
  await expect(invited).not.toHaveURL(/token=/);
  await invited.getByLabel("表示名", { exact: true }).fill("招待された閲覧者");
  await invited.getByRole("button", { name: "パスキーを登録する" }).click();
  await expect(
    invited.getByRole("heading", {
      name: "こんにちは、招待された閲覧者さん。",
    }),
  ).toBeVisible();
  await expect(
    invited.getByRole("button", { name: "新しい施策", exact: true }),
  ).toBeDisabled();
  expect((await browserAPI(invited, "/admin/api/v2/users")).status).toBe(403);
  const invToken = new URL(data.url).hash.slice(7);
  const r = await browserAPI(page, "/auth/invitation/inspect", "POST", {
    token: invToken,
  });
  expect(r.status).toBe(410);
  await context.close();
});
test("recovery code re-enrolls passkey and revokes previous sessions and credentials", async ({
  page,
}) => {
  await setup(page);
  const data = await browserAPI(
    page,
    "/admin/api/v2/recovery-codes",
    "POST",
    {},
  );
  expect(data.codes.length).toBe(8);
  const old = (await admin.repo.all("SELECT id FROM admin_credentials"))[0].id;
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await authenticator.cdp.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: authenticator.authenticatorId,
  });
  await virtualPasskey(page);
  await page.getByRole("button", { name: "パスキーが使えない場合" }).click();
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("owner@example.com");
  await page
    .getByLabel("リカバリーコード", { exact: true })
    .fill(data.codes[0]);
  await page.getByRole("button", { name: "パスキーを登録する" }).click();
  await expect(
    page.getByRole("heading", { name: "こんにちは、佐藤 美香さん。" }),
  ).toBeVisible();
  const rows = await admin.repo.all("SELECT id FROM admin_credentials");
  expect(rows.length).toBe(1);
  expect(rows[0].id).not.toBe(old);
  expect(
    (
      await admin.repo.all(
        "SELECT code_hash FROM admin_recovery_codes WHERE used=0",
      )
    ).length,
  ).toBe(0);
});
test("single-use real-page preview displays disabled campaign without ordinary decisions or browser history writes", async ({
  page,
  context,
}) => {
  await setup(page);
  const value = await admin.repo.site("demo");
  value.site.campaigns[0].enabled = false;
  await admin.repo.run(
    "UPDATE admin_sites SET body=? WHERE id=?",
    JSON.stringify(value.site),
    "demo",
  );
  // Serve an actual page with the built SDK; the site itself is never edited or deployed.
  const sdk = await import("node:fs/promises").then((fs) =>
    fs.readFile("dist/sdk.js", "utf8"),
  );
  await context.route("https://www.example.com/**", async (route) => {
    if (route.request().url().includes("sdk.js"))
      return route.fulfill({
        contentType: "application/javascript",
        body: sdk,
      });
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>吸汗速乾ポロシャツ</title><script src="${origin}/sdk.js" data-site="demo" data-consent="granted" defer></script><h1>実ページ</h1>`,
    });
  });
  await page.locator('a[data-nav="campaigns"]').click();
  await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  await page
    .getByLabel("確認するページURL", { exact: true })
    .fill("https://www.example.com/products/polo");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "ページを開いて確認" }).click();
  const popup = await popupPromise;
  await expect(popup.locator("[data-jev-offer] .frame")).toBeVisible();
  await expect(popup).not.toHaveURL(/jevsense-preview|token=/);
  expect(
    await popup.evaluate(() => sessionStorage.getItem("jev:v1:demo")),
  ).toBeNull();
  expect(calls).toBe(0);
  await expect(page.getByRole("status")).toContainText("確認表示しました");
  await popup.evaluate(() => history.pushState(null, "", "/products/other"));
  await expect(popup.locator("[data-jev-offer]")).toHaveCount(0);
  expect(calls).toBe(0);
});
test("site picker and all selectors use styled keyboard-operable listboxes", async ({
  page,
}) => {
  await setup(page);
  const current = await browserAPI(page, "/admin/api/v2/sites/demo");
  const second = {
    ...current.site,
    id: "second",
    name: "Second Site",
    campaigns: [],
  };
  expect(
    (await browserAPI(page, "/admin/api/v2/sites", "POST", second)).status,
  ).toBe(201);
  await page.reload();
  const picker = page.getByRole("combobox", { name: "サイトを切り替える" });
  await picker.click();
  await expect(page.getByRole("option", { name: /Second Site/ })).toBeVisible();
  await picker.press("End");
  await picker.press("Enter");
  await expect(picker).toContainText("Second Site");
});
test("disabled custom JavaScript previews receive explicit preview mode and one-use module grant", async ({
  page,
  context,
}) => {
  await setup(page);
  const value = await admin.repo.site("demo");
  value.site.allowCustomJavaScript = true;
  const c = value.site.campaigns[0];
  c.enabled = false;
  c.presentation.type = "custom";
  c.custom = {
    code: 'export function render(context) { const el=context.mount.ownerDocument.createElement("div"); el.setAttribute("data-custom-mode",context.mode);el.textContent=context.variables.message;context.mount.append(el);context.reportShown(); }',
    variables: { message: "カスタムの確認表示" },
  };
  await admin.repo.run(
    "UPDATE admin_sites SET body=? WHERE id=?",
    JSON.stringify(value.site),
    "demo",
  );
  await page.reload();
  await context.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Custom preview</title><script src="${origin}/sdk.js" data-site="demo" data-consent="granted" defer></script>`,
    }),
  );
  await page.locator('a[data-nav="campaigns"]').click();
  await page.getByRole("button", { name: "プレビュー", exact: true }).click();
  await page
    .getByLabel("確認するページURL", { exact: true })
    .fill("https://www.example.com/products/polo");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "ページを開いて確認" }).click();
  const popup = await popupPromise;
  await expect(popup.locator('[data-custom-mode="preview"]')).toHaveText(
    "カスタムの確認表示",
  );
  expect(calls).toBe(0);
  expect(
    await popup.evaluate(() => sessionStorage.getItem("jev:v1:demo")),
  ).toBeNull();
  const module = await admin.repo.one("SELECT * FROM admin_preview_modules");
  expect(module.used).toBe(1);
  await popup.close();
});
test("passkey-authenticated administrator launches scoped live diagnostics from the new UI", async ({
  page,
  context,
}) => {
  await setup(page);
  await context.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>導入ガイド</title><script src="${origin}/sdk.js" data-site="demo" data-consent="granted" defer></script><h1>確認用サイト</h1>`,
    }),
  );
  await page.locator('a[data-nav="diagnostics"]').click();
  await page
    .getByLabel("確認するページURL", { exact: true })
    .fill("https://www.example.com/products/polo");
  const opening = page.waitForEvent("popup");
  await page.getByRole("button", { name: "実サイトで診断を開始" }).click();
  const popup = await opening;
  await expect(popup.locator("[data-jevsense-debug]")).toHaveCount(1);
  await expect(page.locator("#toast")).toContainText("診断パネルに接続");
  expect(calls).toBe(0);
  await popup.close();
});
