import { test, expect } from "@playwright/test";
import { buildManagedApp } from "../../src/app.js";
import { fixture } from "../helpers.js";

async function clickSaveDraft(page) {
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  // 公開中の施策を保存するときだけ、確認モーダルが出る。
  await page
    .getByRole("button", { name: "保存して公開を停止", exact: true })
    .click({ timeout: 1000 })
    .catch(() => {});
}
async function releaseFromList(page) {
  const save = page.getByRole("button", { name: "下書き保存", exact: true });
  if (await save.isVisible()) {
    await save.click();
    await expect(page.getByRole("status")).toContainText("下書きを保存");
  }
  await page.locator('a[data-nav="campaigns"]').click();
  await page
    .getByRole("button", { name: "本番へリリース", exact: true })
    .click();
  await page
    .getByRole("button", { name: "本番へリリースする", exact: true })
    .click();
}

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
    jevKeyring: JSON.stringify({
      active: "test",
      keys: { test: Buffer.alloc(32, 31).toString("base64url") },
    }),
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
async function saveThresholdDraft(page) {
  const saved = page.waitForResponse(
    (r) => r.url().includes("/draft") && r.request().method() === "PUT",
  );
  await clickSaveDraft(page);
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("下書きを保存");
  return (await browserAPI(page, "/admin/api/v2/sites/demo")).drafts[0]
    .campaign;
}
test("threshold presets save numeric values, publish normally and fit desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await setup(page);
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "標準", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("しきい値を数値で指定", { exact: true }),
  ).toBeHidden();
  await page
    .locator(".threshold-control")
    .screenshot({ path: testInfo.outputPath("threshold-presets.png") });
  await page.getByRole("radio", { name: "広めに判定", exact: true }).check();
  const broad = await saveThresholdDraft(page);
  expect(broad.threshold).toBe(0.6);
  expect(broad).not.toHaveProperty("thresholdPreset");
  await page.getByRole("radio", { name: "広めに判定", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "標準", exact: true }),
  ).toBeChecked();
  expect((await saveThresholdDraft(page)).threshold).toBe(0.7);
  await page.getByRole("radio", { name: "標準", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("radio", { name: "慎重に判定", exact: true }),
  ).toBeChecked();
  expect((await saveThresholdDraft(page)).threshold).toBe(0.85);
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "慎重に判定", exact: true }),
  ).toBeChecked();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll("main *")]
        .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
        .slice(0, 8)
        .map((el) => ({
          tag: el.tagName,
          className: el.className,
          width: el.getBoundingClientRect().width,
        })),
    }));
    expect(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout)).toBe(
      true,
    );
    await page
      .locator(".threshold-control")
      .screenshot({ path: testInfo.outputPath(`threshold-${width}.png`) });
  }
  await page
    .getByLabel("何を伝えたいですか？", { exact: true })
    .fill("導入ガイドを案内する");
  await page
    .getByLabel("どんな人に届けたいですか？", { exact: true })
    .fill("導入方法に関心がある");
  await page
    .getByRole("button", { name: "表示コンテンツ", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "表示タイトル", exact: true })
    .fill("導入ガイド");
  await saveThresholdDraft(page);
  await releaseFromList(page);
  await expect(page.getByRole("heading", { name: "施策一覧" })).toBeVisible();
  const published = (await admin.repo.publicConfig()).sites[0].campaigns.find(
    (c) => c.id === broad.id,
  );
  expect(published.threshold).toBe(0.85);
  expect(published.combination).toBe("all");
  expect(calls).toBe(0);
});
test("existing custom thresholds retain exact precision; invalid values cannot save", async ({
  page,
}) => {
  await setup(page);
  const row = db.raw
    .prepare("SELECT body FROM admin_sites WHERE id='demo'")
    .get();
  const site = JSON.parse(row.body);
  site.campaigns[0].threshold = 0.735123;
  db.raw
    .prepare("UPDATE admin_sites SET body=? WHERE id='demo'")
    .run(JSON.stringify(site));
  await page.goto(origin + "/admin#/campaign/" + site.campaigns[0].id);
  await page.reload();
  const number = page.getByLabel("しきい値を数値で指定", { exact: true });
  await expect(number).toBeVisible();
  await expect(number).toHaveValue("0.735123");
  await expect(page.locator("[data-threshold-preset]:checked")).toHaveCount(0);
  await expect(page.locator("#thresholdSelection")).toHaveText(
    "現在：カスタム設定",
  );
  await page
    .getByRole("button", { name: "表示コンテンツ", exact: true })
    .click();
  await page.getByRole("button", { name: "対象者・条件", exact: true }).click();
  await expect(number).toHaveValue("0.735123");
  expect((await saveThresholdDraft(page)).threshold).toBe(0.735123);
  const writes = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().endsWith("/draft"))
      writes.push(req);
  });
  await number.fill("0.49");
  await clickSaveDraft(page);
  await expect(page.getByRole("status")).toContainText("しきい値は0.5〜0.99");
  expect(writes).toHaveLength(0);
  await number.fill("0.99");
  expect((await saveThresholdDraft(page)).threshold).toBe(0.99);
  expect(writes).toHaveLength(1);
  // 公開中の施策を保存したので、公開設定から外れて下書きになっている。
  expect((await admin.repo.publicConfig()).sites[0].campaigns).toHaveLength(0);
  expect(calls).toBe(0);
});
test("threshold slider synchronizes values and presets with keyboard bounds; viewers cannot edit", async ({
  page,
}) => {
  await setup(page);
  const campaign = (await admin.repo.publicConfig()).sites[0].campaigns[0];
  await page.goto(origin + "/admin#/campaign/" + campaign.id);
  await page.locator(".threshold-details > summary").click();
  const slider = page.getByRole("slider", {
    name: "スライダーで調整",
    exact: true,
  });
  const number = page.getByLabel("しきい値を数値で指定", { exact: true });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(number).toHaveValue("0.5");
  await page.keyboard.press("ArrowLeft");
  await expect(number).toHaveValue("0.5");
  await page.keyboard.press("End");
  await expect(number).toHaveValue("0.99");
  await page.keyboard.press("ArrowRight");
  await expect(number).toHaveValue("0.99");
  await number.fill("0.6");
  await expect(slider).toHaveValue("0.6");
  await expect(
    page.getByRole("radio", { name: "広めに判定", exact: true }),
  ).toBeChecked();
  await slider.focus();
  await page.keyboard.press("ArrowUp");
  await expect(number).toHaveValue("0.61");
  await expect(page.locator("[data-threshold-preset]:checked")).toHaveCount(0);
  expect((await saveThresholdDraft(page)).threshold).toBe(0.61);
  await page.reload();
  await expect(number).toBeVisible();
  await expect(number).toHaveValue("0.61");
  const user = (await admin.repo.all("SELECT id FROM admin_users"))[0].id;
  db.raw
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES('reserved-superuser','reserved@example.com','Reserved','superuser','active',?)",
    )
    .run(Date.now());
  db.raw
    .prepare("UPDATE admin_users SET global_role='member' WHERE id=?")
    .run(user);
  db.raw
    .prepare(
      "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,'demo','viewer')",
    )
    .run(user);
  await page.reload();
  await expect(number).toBeDisabled();
  await expect(slider).toBeDisabled();
  for (const label of ["広めに判定", "標準", "慎重に判定"])
    await expect(
      page.getByRole("radio", { name: label, exact: true }),
    ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "下書き保存", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(0);
});
test("site creation validates copied origins before reauthentication and preserves the form when cancelled", async ({
  page,
}) => {
  await setup(page);
  await page.locator('a[data-nav="installation"]').click();
  await page.getByRole("button", { name: "サイトを追加", exact: true }).click();
  await page.getByLabel("サイトID", { exact: true }).fill("new-site");
  await page.getByLabel("サイト名", { exact: true }).fill("新しいサイト");
  await page
    .getByLabel("オリジン", { exact: true })
    .fill("https://new.example.com/");
  db.raw
    .prepare("UPDATE admin_sessions SET authenticated_at=?")
    .run(Date.now() - 600000);
  await page
    .getByRole("button", { name: "サイトを追加", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.getByLabel("サイトID", { exact: true })).toHaveValue(
    "new-site",
  );
  expect(
    db.raw
      .prepare("SELECT count(*) AS n FROM admin_sites WHERE id='new-site'")
      .get().n,
  ).toBe(0);
  await page
    .getByRole("button", { name: "サイトを追加", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "パスキーで確認", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "サイト設定" })).toBeVisible();
  const site = JSON.parse(
    db.raw.prepare("SELECT body FROM admin_sites WHERE id='new-site'").get()
      .body,
  );
  expect(site.origins).toEqual(["https://new.example.com"]);
  expect(site.name).toBe("新しいサイト");
  expect(site.allowedPathPrefixes).toEqual(["/"]);
  expect(calls).toBe(0);
});

test("site form explains invalid origins before requesting a passkey and keeps input after server errors", async ({
  page,
}) => {
  await setup(page);
  await page.locator('a[data-nav="installation"]').click();
  await page.getByRole("button", { name: "サイトを追加", exact: true }).click();
  await page.getByLabel("サイトID", { exact: true }).fill("test-site");
  await page.getByLabel("サイト名", { exact: true }).fill("テストサイト");
  const input = page.getByLabel("オリジン", { exact: true });
  db.raw
    .prepare("UPDATE admin_sessions SET authenticated_at=?")
    .run(Date.now() - 600000);
  for (const value of [
    "https://new.example.com/ja/",
    "https://user:password@new.example.com",
    "https://new.example.com/?x=1",
    "http://new.example.com",
  ]) {
    await input.fill(value);
    await page
      .getByRole("button", { name: "サイトを追加", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("button", { name: "パスキーで確認", exact: true }),
    ).toHaveCount(0);
    expect(await input.evaluate((el) => el.validationMessage)).toContain(
      "オリジン",
    );
  }
  await input.fill("https://new.example.com/");
  await page.route(origin + "/admin/api/v2/sites", async (route) => {
    const authenticatedAt = db.raw
      .prepare("SELECT authenticated_at FROM admin_sessions")
      .get().authenticated_at;
    if (Date.now() - authenticatedAt > 300000) return route.fallback();
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "invalid_request",
        issues: [{ path: ["id"], message: "Invalid input" }],
      }),
    });
  });
  await page
    .getByRole("button", { name: "サイトを追加", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "パスキーで確認", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "入力内容を確認してください",
  );
  await expect(page.getByLabel("サイト名", { exact: true })).toHaveValue(
    "テストサイト",
  );
  await expect(input).toHaveValue("https://new.example.com/");
});

test("account passkey labels and details occupy separate readable lines on desktop and mobile", async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.locator('a[data-nav="account"]').click();
  const row = page.locator(".passkey-row").first();
  await expect(row.locator(".passkey-label")).toHaveText("最初のパスキー");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const boxes = await row.evaluate((el) => {
      const label = el.querySelector(".passkey-label").getBoundingClientRect(),
        detail = el.querySelector("small").getBoundingClientRect();
      return {
        labelBottom: label.bottom,
        detailTop: detail.top,
        color: getComputedStyle(el.querySelector(".passkey-label")).color,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(boxes.detailTop).toBeGreaterThanOrEqual(boxes.labelBottom);
    expect(boxes.color).toBe("rgb(35, 60, 49)");
    expect(boxes.overflow).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`account-${width}.png`),
      fullPage: true,
    });
  }
});
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
    page.getByRole("heading", { name: "アカウント設定" }),
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
    .getByLabel("どんな人に届けたいですか？", { exact: true })
    .fill("吸汗速乾機能のあるポロシャツに関心がある");
  await expect(page.locator("#conditionBuilder #question")).toContainText(
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
  await clickSaveDraft(page);
  await expect(page.getByRole("status")).toContainText("下書きを保存");
  expect((await admin.repo.publicConfig()).sites[0].campaigns.length).toBe(1); // existing fixture only
  await releaseFromList(page);
  await expect(page.getByRole("heading", { name: "施策一覧" })).toBeVisible();
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

test("site Jev key form saves encrypted write-only credentials with confirmation and passkey reauthentication", async ({
  page,
}, testInfo) => {
  db.raw
    .prepare(
      "INSERT INTO site_jev_calls(id,site_id,started_at,outcome,configured_model,key_source,credential_revision) VALUES('prebootstrap-call','demo',?,'success','jev-test','instance','prebootstrap')",
    )
    .run(Date.now());
  await setup(page);
  expect(
    db.raw
      .prepare(
        "SELECT count(*) AS n FROM site_jev_calls WHERE id='prebootstrap-call'",
      )
      .get().n,
  ).toBe(1);
  await page.locator('a[data-nav="jev"]').click();
  await expect(
    page.getByRole("heading", { name: "Jev連携", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "使用するキー", exact: true })
    .click();
  await page.locator('[role="option"][data-value="site"]').click();
  const key = "browser-private-synthetic-key";
  await page.getByLabel("新しいサイト専用APIキー", { exact: true }).fill(key);
  await db.raw
    .prepare("UPDATE admin_sessions SET authenticated_at=?")
    .run(Date.now() - 600000);
  await page
    .getByRole("button", { name: "Jev接続設定を保存", exact: true })
    .click();
  await expect(
    page.getByLabel("新しいサイト専用APIキー", { exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await page
    .getByRole("button", { name: "パスキーで確認", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Jev接続設定を保存しました",
  );
  await expect(
    page.getByLabel("新しいサイト専用APIキー", { exact: true }),
  ).toHaveValue("");
  const row = db.raw
    .prepare("SELECT * FROM site_jev_credentials WHERE site_id='demo'")
    .get();
  expect(row.mode).toBe("site");
  expect(JSON.stringify(row)).not.toContain(key);
  await page.reload();
  await expect(
    page.getByText("保存済み（値は表示しません）", { exact: false }),
  ).toBeVisible();
  expect(await page.content()).not.toContain(key);
  await page.screenshot({
    path: testInfo.outputPath("jev-connection.png"),
    fullPage: true,
  });
  expect(calls).toBe(0);
});
test("Jev usage displays real-call metadata, UTC totals and pending results with manual refresh on mobile", async ({
  page,
}, testInfo) => {
  await setup(page);
  const now = Date.now();
  for (const [i, outcome, status] of [
    [0, "success", 200],
    [1, "http_error", 401],
    [2, "started", null],
  ])
    db.raw
      .prepare(
        "INSERT INTO site_jev_calls(id,site_id,started_at,outcome,configured_model,actual_model,http_status,elapsed_ms,key_source,credential_revision) VALUES(?,'demo',?,?,'jev-test',?,?,?,'site','test-revision')",
      )
      .run(
        "browser-test-" + i,
        now - i,
        outcome,
        outcome === "success" ? "actual-model" : null,
        status,
        outcome === "started" ? null : 123,
      );
  await page.locator('a[data-nav="jev"]').click();
  await page.getByRole("button", { name: "利用状況", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "正常応答", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("actual-model", { exact: true })).toBeVisible();
  await expect(
    page.getByText("未確定（処理中・結果未記録）", { exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "集計期間", exact: true }).click();
  await page.locator('[role="option"][data-value="90"]').click();
  await page.getByRole("button", { name: "更新", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "集計期間", exact: true }),
  ).toContainText("過去90日");
  await page.screenshot({
    path: testInfo.outputPath("jev-usage.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(calls).toBe(0);
});
test("editors cannot see Jev navigation or open credential and usage endpoints through a deep link", async ({
  page,
}) => {
  await setup(page);
  const user = db.raw.prepare("SELECT id FROM admin_users").get().id;
  db.raw
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES('reserved-superuser','reserved@example.com','Reserved','superuser','active',?)",
    )
    .run(Date.now());
  db.raw
    .prepare("UPDATE admin_users SET global_role='member' WHERE id=?")
    .run(user);
  db.raw
    .prepare(
      "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,'demo','editor')",
    )
    .run(user);
  await page.reload();
  await expect(page.locator('a[data-nav="jev"]')).toHaveCount(0);
  await page.goto(origin + "/admin#/jev");
  await expect(
    page.getByText(
      "Jev連携の設定と利用状況は、サイト管理者とSuperuserだけが確認できます。",
      { exact: true },
    ),
  ).toBeVisible();
  for (const tail of ["", "/usage"])
    expect(
      (await browserAPI(page, "/admin/api/v2/sites/demo/jev" + tail)).status,
    ).toBe(403);
});

async function metadataTab(page) {
  await page.locator('a[data-nav="settings"]').click();
  await page
    .getByRole("button", { name: "ページ情報の取得", exact: true })
    .click();
}
test("metadata settings follow the approved layout, validate/edit/order rules, save with CAS and render at mobile widths", async ({
  page,
}, testInfo) => {
  await setup(page);
  await metadataTab(page);
  await expect(page.locator("#metadataSettings")).toContainText(
    "従来のJSON-LD優先",
  );
  await page
    .getByRole("button", { name: "サイト独自のルール", exact: true })
    .click();
  await expect(page.locator(".metadata-rule")).toHaveCount(3);
  await page
    .locator(".metadata-rule")
    .first()
    .getByRole("button", { name: "編集", exact: true })
    .click();
  let modal = page.getByRole("dialog");
  await modal.locator('[name="nameOutput.prefix"]').fill("製品：");
  await page.getByRole("button", { name: "候補を保存", exact: true }).click();
  await expect(page.locator(".metadata-rule").first()).toContainText("製品：");
  await page
    .locator(".metadata-rule")
    .nth(1)
    .getByRole("button", { name: "↑", exact: true })
    .click();
  await expect(page.locator(".metadata-rule").first()).toContainText(
    "OGPから取得",
  );
  await page
    .getByText("導入前に取得値を手動入力して試す", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "人工データで確認", exact: true })
    .click();
  await expect(page.locator("#metadataResult")).toContainText(
    "夏のポロシャツ特集",
  );
  await expect(page.locator("#metadataResult")).toContainText("人工データ");
  await page
    .getByRole("button", { name: "変更内容を確認", exact: true })
    .click();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("取得方法を保存");
  const stored = (await browserAPI(page, "/admin/api/v2/sites/demo")).site
    .metadataExtraction;
  expect(stored.mode).toBe("custom");
  expect(stored.rules[0].id).toBe("ogp");
  expect(stored.rules[1].nameOutput.prefix).toBe("製品：");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`metadata-${width}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "標準の自動取得", exact: true })
    .click();
  await page.getByRole("button", { name: "基本設定", exact: true }).click();
  await page.getByRole("button", { name: "切り替える", exact: true }).click();
  await page
    .getByRole("button", { name: "ページ情報の取得", exact: true })
    .click();
  await expect(page.locator(".metadata-rule")).toHaveCount(3);
  expect(calls).toBe(0);
});
test("live metadata inspection respects consent, evaluates unsaved rules, refreshes DOM and never starts normal collection", async ({
  page,
  context,
}) => {
  await setup(page);
  await metadataTab(page);
  await page
    .getByRole("button", { name: "サイト独自のルール", exact: true })
    .click();
  await page
    .getByLabel("取得しないGETパラメータのキー", { exact: true })
    .fill("email");
  const inspectionBodies = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/metadata-inspection"))
      inspectionBodies.push(req.postDataJSON());
  });
  const requests = [];
  context.on("request", (req) => requests.push(req.url()));
  await context.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><meta charset="utf-8"><title>HTML title</title><meta property="og:title" content="OGP title"><script type="application/ld+json">{"@type":"Product","sku":"SECRET-SKU","name":"実ページの商品","description":"商品の説明"}</script><script src="${origin}/sdk.js" data-site="demo" defer></script><h1>実ページ</h1>`,
    }),
  );
  await page
    .getByLabel("確認するページURL", { exact: true })
    .fill(
      "https://www.example.com/products/polo?variant=blue&email=PRIVATE-URL#size",
    );
  const opening = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "このURLで確認", exact: true })
    .click();
  const popup = await opening;
  await expect(page.locator("#metadataResult")).toContainText("同意");
  expect(
    await admin.repo.one("SELECT used FROM admin_metadata_tickets"),
  ).toMatchObject({ used: 0 });
  expect(
    requests.filter((u) => u.includes("/v1/metadata/redeem")),
  ).toHaveLength(0);
  await popup.evaluate(() => window.JevPersonalization.consent(true));
  await expect(page.locator("#metadataResult")).toContainText(
    "商品詳細：実ページの商品",
  );
  await expect(page.locator("#metadataResult")).toContainText(
    "実ページの取得結果",
  );
  await expect(page.locator("#metadataResult")).not.toContainText("SECRET-SKU");
  await expect(page.locator("#metadataResult")).not.toContainText(
    "PRIVATE-URL",
  );
  await expect(page.locator("#metadataResult")).toContainText(
    "https://www.example.com/products/polo?variant=blue",
  );
  expect(inspectionBodies).toHaveLength(1);
  expect(inspectionBodies[0].url).toBe("https://www.example.com/products/polo");
  expect(inspectionBodies[0].excludedQueryKeys).toEqual(["email"]);
  expect(JSON.stringify(inspectionBodies)).not.toContain("PRIVATE-URL");
  expect(
    (await admin.repo.one("SELECT policy FROM admin_metadata_tickets")).policy,
  ).not.toContain("PRIVATE-URL");
  expect(popup.url()).toBe(
    "https://www.example.com/products/polo?variant=blue&email=PRIVATE-URL#size",
  );
  await popup.evaluate(() => {
    document.querySelector('script[type="application/ld+json"]').textContent =
      JSON.stringify({
        "@type": "Product",
        sku: "SECRET-SKU",
        name: "更新後の商品",
      });
  });
  await expect(page.locator("#metadataResult")).toContainText(
    "商品詳細：更新後の商品",
  );
  await page
    .getByRole("button", { name: "同じページから再取得", exact: true })
    .click();
  expect(
    requests.filter((u) => u.includes("/v1/metadata/redeem")),
  ).toHaveLength(1);
  expect(
    requests.filter(
      (u) => u.includes("/v1/decision") || u.includes("/v1/sites/"),
    ),
  ).toHaveLength(0);
  expect(
    await popup.evaluate(() => sessionStorage.getItem("jev:v1:demo")),
  ).toBeNull();
  expect(
    (await browserAPI(page, "/admin/api/v2/sites/demo")).site
      .metadataExtraction,
  ).toBeUndefined();
  expect(calls).toBe(0);
  await popup.evaluate(() => window.JevPersonalization.consent(false));
  await expect(page.locator("#metadataResult")).toContainText("終了");
  await popup.close();
});
test("inspection ignores forged messages and invalidates live results when the draft changes", async ({
  page,
  context,
}) => {
  await setup(page);
  await metadataTab(page);
  await page
    .getByRole("button", { name: "標準の自動取得", exact: true })
    .click();
  await context.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>HTML</title><meta property="og:title" content="OGP title"><script src="${origin}/sdk.js" data-site="demo" data-consent="granted" defer></script>`,
    }),
  );
  await page
    .getByLabel("確認するページURL", { exact: true })
    .fill("https://www.example.com/products/polo");
  const opening = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "このURLで確認", exact: true })
    .click();
  const popup = await opening;
  await expect(page.locator("#metadataResult")).toContainText("OGP title");
  const nonce = (
    await admin.repo.one("SELECT nonce FROM admin_metadata_tickets")
  ).nonce;
  await page.evaluate(
    ({ nonce }) =>
      window.postMessage(
        {
          type: "jevsense:metadata-result",
          siteId: "demo",
          nonce,
          page: { name: "forged" },
          provenance: { trace: [] },
        },
        location.origin,
      ),
    { nonce },
  );
  await expect(page.locator("#metadataResult")).not.toContainText("forged");
  await page
    .getByRole("button", { name: "サイト独自のルール", exact: true })
    .click();
  await expect(page.locator("#metadataResult")).toContainText("設定案を変更");
  await expect(page.locator("#metadataResult")).not.toContainText("OGP title");
  await expect(
    popup.locator("[data-jevsense-metadata-inspection]"),
  ).toContainText("終了");
  expect(calls).toBe(0);
  await popup.close();
});

test("metadata inspection expires and terminates on navigation, and the read-only role cannot launch or edit", async ({
  page,
  context,
}) => {
  await setup(page);
  await metadataTab(page);
  await page
    .getByRole("button", { name: "標準の自動取得", exact: true })
    .click();
  await page.clock.install();
  await context.route("https://www.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><title>HTML</title><script src="${origin}/sdk.js" data-site="demo" defer></script>`,
    }),
  );
  await page
    .getByLabel("確認するページURL", { exact: true })
    .fill("https://www.example.com/products/polo");
  let opening = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "このURLで確認", exact: true })
    .click();
  let popup = await opening;
  await popup.waitForFunction(() => window.JevPersonalization);
  await popup.evaluate(() => window.JevPersonalization.consent(true));
  await expect(page.locator("#metadataResult")).toContainText(
    "実ページの取得結果",
  );
  await popup.clock.fastForward(300001);
  await expect(page.locator("#metadataResult")).toContainText(/終了|期限/);
  await popup.close();
  await page.clock.setSystemTime(new Date());
  opening = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "このURLで確認", exact: true })
    .click();
  popup = await opening;
  await popup.waitForFunction(() => window.JevPersonalization);
  await popup.evaluate(() => window.JevPersonalization.consent(true));
  await expect(page.locator("#metadataResult")).toContainText(
    "実ページの取得結果",
  );
  await popup.evaluate(() => history.pushState(null, "", "/products/next"));
  await expect(page.locator("#metadataResult")).toContainText("終了");
  await popup.close();
  await page
    .getByRole("button", { name: "変更内容を確認", exact: true })
    .click();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  const session = await page.evaluate(
    async () => await (await fetch("/auth/session")).json(),
  );
  await admin.repo.run(
    "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES('other-superuser','other@example.com','Other','superuser','active',?)",
    Date.now(),
  );
  await admin.repo.run(
    "UPDATE admin_users SET global_role='member' WHERE id=?",
    session.user.id,
  );
  await admin.repo.run(
    "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,'demo','editor') ON CONFLICT(user_id,site_id) DO UPDATE SET role='editor'",
    session.user.id,
  );
  await page.reload();
  await metadataTab(page);
  await expect(
    page.getByRole("button", { name: "このURLで確認", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "サイト独自のルール", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "変更内容を確認", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(0);
});

test("URL exclusions save independently of metadata mode and preview removed values without leaking markup", async ({
  page,
}, testInfo) => {
  await setup(page);
  await metadataTab(page);
  await page
    .getByLabel("取得しないGETパラメータのキー", { exact: true })
    .fill("email\ntoken");
  await page
    .locator("#metadataURL")
    .fill(
      "https://www.example.com/guides/a?cid=mail_runner&email=PRIVATE&token=SECRET#private",
    );
  await expect(page.locator("#sanitizedURL")).toHaveText(
    "https://www.example.com/guides/a?cid=mail_runner",
  );
  await page
    .getByRole("button", { name: "変更内容を確認", exact: true })
    .click();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("取得方法を保存");
  const stored = (await browserAPI(page, "/admin/api/v2/sites/demo")).site;
  expect(stored.excludedQueryKeys).toEqual(["email", "token"]);
  expect(stored.metadataExtraction).toBeUndefined();
  await page.reload();
  await metadataTab(page);
  await expect(
    page.getByLabel("取得しないGETパラメータのキー", { exact: true }),
  ).toHaveValue("email\ntoken");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`url-policy-${width}.png`),
      fullPage: true,
    });
  }
  expect(calls).toBe(0);
});

test("URL-only campaign editor saves an entry cid condition with zero required history and no Jev questions", async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  await page.locator('[name="name"]').fill("メールからのランナー向け案内");
  const { graphFromCampaign } = await import("../../src/condition-graph.js");
  const g = graphFromCampaign({
    decisionMode: "rules",
    urlTargeting: {
      combination: "all",
      conditions: [
        {
          source: "entry",
          field: "query",
          key: "cid",
          operator: "contains",
          value: "runner",
        },
      ],
    },
  });
  await editGraphJSON(page, g);
  const draft = await saveThresholdDraft(page);
  expect(draft.decisionMode).toBe("rules");
  expect(draft.minimumHistory).toBe(0);
  expect(draft.questions).toEqual([]);
  expect(
    draft.conditionGraph.nodes.find((n) => n.kind === "url"),
  ).toMatchObject({
    source: "entry",
    field: "query",
    key: "cid",
    operator: "contains",
    value: "runner",
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`url-campaign-${width}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "表示コンテンツ", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "表示タイトル", exact: true })
    .fill("ランナー向け特集");
  await releaseFromList(page);
  await expect(
    page.getByRole("heading", { name: "施策一覧", exact: true }),
  ).toBeVisible();
  const published = (await admin.repo.publicConfig()).sites[0].campaigns.find(
    (c) => c.id === draft.id,
  );
  expect(published.enabled).toBe(true);
  expect(published.decisionMode).toBe("rules");
  expect(
    published.conditionGraph.nodes.find((n) => n.kind === "url").value,
  ).toBe("runner");
  expect(published.questions).toEqual([]);
  expect(calls).toBe(0);
});

async function seedEditorCampaign(page, campaign) {
  const value = (await browserAPI(page, "/admin/api/v2/sites/demo")).site;
  value.campaigns = [campaign];
  db.raw
    .prepare("UPDATE admin_sites SET body=?,revision=? WHERE id='demo'")
    .run(JSON.stringify(value), crypto.randomUUID());
  await page.reload();
  await page.locator('a[data-nav="campaigns"]').click();
  await page.locator('[data-open="guide"]').first().click();
  await expect(page.locator("#campaignForm")).toBeVisible();
}
for (const variant of ["current", "legacy", "original"])
  test(`saved ${variant} questions default to input forms and preserve five OR conditions across JSON, drafts, publication and reopening`, async ({
    page,
  }) => {
    await setup(page);
    const { guidedQuestions } = await import("../../src/questions.js");
    const c = structuredClone(
      (await browserAPI(page, "/admin/api/v2/sites/demo")).site.campaigns[0],
    );
    c.combination = "any";
    c.questions =
      variant === "original"
        ? Array.from({ length: 5 }, (_, i) => ({
            key: `custom_${i}`,
            instructions: `案内${i + 1}について：この閲覧者は「関心${i + 1}」に該当しますか？\n原文を保持してください。`,
          }))
        : guidedQuestions({
            offer: "夏のウェアをご案内",
            conditions: Array.from(
              { length: 5 },
              (_, i) => `関心${i + 1}に当てはまる`,
            ),
            keys: Array.from({ length: 5 }, (_, i) => `custom_${i}`),
            templateVersion: variant,
          });
    delete c.judgment;
    await seedEditorCampaign(page, c);
    const host = page.locator("#conditionBuilder");
    await expect(host.locator(".node.jev")).toHaveCount(5);
    await expect(host.locator(".node.or")).toHaveCount(1);
    for (let i = 0; i < 5; i++)
      await expect(host.locator(`[data-node="jev_${i + 1}"]`)).toContainText(
        variant === "original"
          ? c.questions[i].instructions
          : `関心${i + 1}に当てはまる`,
      );
    const { graphQuestions } = await import("../../src/condition-graph.js");
    for (let i = 0; i < 2; i++) {
      const graph = await readGraphJSON(page);
      expect(graphQuestions(graph)).toEqual(c.questions);
      await applyGraphJSON(page, graph);
    }
    const draft = await saveThresholdDraft(page);
    expect(draft.questions).toEqual(c.questions);
    expect(draft.combination).toBe("any");
    await releaseFromList(page);
    await expect(
      page.getByRole("heading", { name: "施策一覧", exact: true }),
    ).toBeVisible();
    const published = (await browserAPI(page, "/admin/api/v2/sites/demo")).site
      .campaigns[0];
    expect(published.questions).toEqual(c.questions);
    expect(published.combination).toBe("any");
    await page.reload();
    await page.locator('a[data-nav="campaigns"]').click();
    await page.locator('[data-open="guide"]').first().click();
    await expect(host.locator(".node.jev")).toHaveCount(5);
    const reopened = await readGraphJSON(page);
    expect(graphQuestions(reopened)).toEqual(c.questions);
    await page.locator("#cancelJSON").click();
    expect(calls).toBe(0);
  });

test("edited graph JSON preserves original questions and OR semantics", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  const { graphFromCampaign } = await import("../../src/condition-graph.js");
  const questions = [
    { key: "one", instructions: "任意の原文1？" },
    { key: "two", instructions: "別の案内の原文2？" },
  ];
  await editGraphJSON(
    page,
    graphFromCampaign({ questions, combination: "any" }),
  );
  await expect(page.locator("#conditionBuilder .node.or")).toHaveCount(1);
  const c = await saveThresholdDraft(page);
  expect(c.questions).toEqual(questions);
  expect(c.judgment).toBeUndefined();
});

test("site readiness messages explain missing keys, disappear on save, and are scoped/read-only for viewers", async ({
  page,
}, testInfo) => {
  await setup(page);
  const status = page.getByRole("region", {
    name: "サイトの設定状況",
    exact: true,
  });
  await expect(status).toContainText("Jev APIキーが未設定");
  await status
    .getByRole("link", { name: "Jev連携を設定", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "使用するキー", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: "インスタンス共通キー", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByLabel("新しいサイト専用APIキー", { exact: true })
    .fill("synthetic-readiness-key");
  await page
    .getByRole("button", { name: "Jev接続設定を保存", exact: true })
    .click();
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Jev接続設定を保存しました",
  );
  await expect(status).toHaveCount(0);
  const current = (await browserAPI(page, "/admin/api/v2/sites/demo")).site;
  expect(
    (
      await browserAPI(page, "/admin/api/v2/sites", "POST", {
        ...current,
        id: "other",
        name: "Other site",
        campaigns: [],
      })
    ).status,
  ).toBe(201);
  await page.reload();
  await page
    .getByRole("combobox", { name: "サイトを切り替える", exact: true })
    .click();
  await page.locator('[role="option"][data-value="other"]').click();
  await expect(status).toContainText("Jev APIキーが未設定");
  await expect(status).toContainText("配信中の施策がありません");
  await page
    .getByRole("combobox", { name: "サイトを切り替える", exact: true })
    .click();
  await page.locator('[role="option"][data-value="demo"]').click();
  await expect(status).toHaveCount(0);

  const user = db.raw.prepare("SELECT id FROM admin_users").get();
  db.raw
    .prepare(
      "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,'demo','viewer')",
    )
    .run(user.id);
  db.raw
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES('backup-owner','backup@example.com','Backup','superuser','active',?)",
    )
    .run(Date.now());
  db.raw
    .prepare("UPDATE admin_users SET global_role='member' WHERE id=?")
    .run(user.id);
  db.raw.prepare("DELETE FROM site_jev_credentials WHERE site_id='demo'").run();
  await page.reload();
  await expect(status).toContainText("サイト管理者に依頼");
  await expect(
    status.getByRole("link", { name: "Jev連携を設定", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('a[data-nav="jev"]')).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`readiness-${width}.png`),
      fullPage: true,
    });
  }
  expect(calls).toBe(0);
});

test("removing and adding guided conditions preserves surviving IDs and allows AND without changing restored text", async ({
  page,
}) => {
  await setup(page);
  const { guidedQuestions } = await import("../../src/questions.js");
  const c = structuredClone(
    (await browserAPI(page, "/admin/api/v2/sites/demo")).site.campaigns[0],
  );
  c.combination = "any";
  c.questions = guidedQuestions({
    offer: "案内",
    conditions: ["Aに関心", "Bに関心", "Cに関心"],
    keys: ["a", "b", "c"],
  });
  delete c.judgment;
  await seedEditorCampaign(page, c);
  const host = page.locator("#conditionBuilder");
  await host.locator('[data-delete-node="jev_2"]').click();
  await host.locator('[data-add="jev"]').click();
  const g = await readGraphJSON(page),
    added = g.nodes.find(
      (n) => n.kind === "jev" && !["a", "c"].includes(n.key),
    );
  added.condition = "Dに関心";
  g.nodes.find((n) => n.kind === "or").kind = "and";
  g.edges.push({ id: "new_edge", from: added.id, to: "model_group" });
  await applyGraphJSON(page, g);
  const draft = await saveThresholdDraft(page);
  expect(draft.questions.map((q) => q.key)).toEqual(["a", "c", "condition_1"]);
  expect(
    draft.conditionGraph.nodes
      .filter((n) => n.kind === "jev")
      .map((n) => n.condition),
  ).toEqual(["Aに関心", "Cに関心", "Dに関心"]);
  expect(
    draft.conditionGraph.nodes.find((n) => n.id === "model_group").kind,
  ).toBe("and");
});

async function openGraphJSON(page) {
  const host = page.locator("#conditionBuilder");
  const b = host.getByRole("button", { name: "JSONで編集", exact: true });
  if (!(await b.isVisible()))
    await host.getByText("条件グラフのJSONを見る", { exact: true }).click();
  await b.click();
}
async function readGraphJSON(page) {
  await openGraphJSON(page);
  return JSON.parse(
    await page.getByLabel("条件グラフJSON", { exact: true }).inputValue(),
  );
}
async function applyGraphJSON(page, g) {
  await page
    .getByLabel("条件グラフJSON", { exact: true })
    .fill(JSON.stringify(g));
  await page.getByRole("button", { name: "JSONを反映", exact: true }).click();
}
async function editGraphJSON(page, g) {
  await openGraphJSON(page);
  await applyGraphJSON(page, g);
}

test("stopping returns a campaign to draft; saving a live campaign asks first and unpublishes", async ({
  page,
}) => {
  await setup(page);
  await page.locator('a[data-nav="campaigns"]').click();
  const row = page.locator("tbody tr").first();
  await expect(row).toContainText("公開中");
  expect((await admin.repo.publicConfig()).sites[0].campaigns[0].enabled).toBe(
    true,
  );
  // 公開中の施策を保存すると、確認のうえで公開が止まり、下書きになる。
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("公開が止まり");
  await page
    .getByRole("button", { name: "保存して公開を停止", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("下書きを保存");
  expect((await admin.repo.publicConfig()).sites[0].campaigns).toHaveLength(0);
  await page.locator('a[data-nav="campaigns"]').click();
  await expect(row).toContainText("下書き");
  await expect(page.getByRole("button", { name: "再開" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "公開を停止" })).toHaveCount(0);
  // 本番へリリースすると、再び公開される。
  await page
    .getByRole("button", { name: "本番へリリース", exact: true })
    .click();
  await page
    .getByRole("button", { name: "本番へリリースする", exact: true })
    .click();
  await expect(row).toContainText("公開中");
  expect((await admin.repo.publicConfig()).sites[0].campaigns).toHaveLength(1);
  // 一覧の「公開を停止」は、公開を止めて下書きに戻す。
  await page.getByRole("button", { name: "公開を停止", exact: true }).click();
  await page.getByRole("button", { name: "停止する", exact: true }).click();
  await expect(row).toContainText("下書き");
  expect((await admin.repo.publicConfig()).sites[0].campaigns).toHaveLength(0);
});
