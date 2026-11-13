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
    (r) => r.url().endsWith("/draft") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "下書き保存", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("下書きを保存");
  return (await browserAPI(page, "/admin/api/v2/sites/demo")).drafts[0]
    .campaign;
}

test("node editor creates, edits, tests and reopens a campaign without losing graph data", async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  const host = page.locator("#conditionBuilder");
  await expect(host.locator(".node")).toHaveCount(2);
  await host
    .getByLabel("何を伝えたいですか？", { exact: true })
    .fill("夏のポロシャツを案内");
  await host.locator('[data-edit="jev_1"]').click();
  const modal = host.locator("#nodeEditDialog");
  await expect(modal).toBeVisible();
  await modal
    .getByLabel("どんな人に届けたいですか？", { exact: true })
    .fill("ポロシャツに関心がある");
  await modal.getByRole("button", { name: "変更を保存", exact: true }).click();
  await expect(host.locator(".node.jev")).toContainText(
    "ポロシャツに関心がある",
  );
  await page.getByLabel("施策名", { exact: true }).fill("ノード施策");
  await host
    .getByRole("button", { name: "この設定を試す", exact: true })
    .click();
  await expect(host.locator("#testOutcome")).toContainText("条件を満たします");
  const saved = await saveThresholdDraft(page);
  expect(
    saved.conditionGraph.nodes.filter((n) => n.kind === "jev"),
  ).toHaveLength(1);
  expect(saved.conditionGraph.offer).toBe("夏のポロシャツを案内");
  await page
    .getByRole("button", { name: "表示コンテンツ", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "表示タイトル", exact: true })
    .fill("夏の案内");
  await page
    .getByRole("button", { name: "配信内容を確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この内容で配信開始", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "施策一覧", exact: true }),
  ).toBeVisible();
  await page.locator(`[data-open="${saved.id}"]`).first().click();
  await expect(host.locator(".node.jev")).toContainText(
    "ポロシャツに関心がある",
  );
  expect(
    (await browserAPI(page, "/admin/api/v2/sites/demo")).site.campaigns.find(
      (c) => c.id === saved.id,
    ).conditionGraph,
  ).toBeTruthy();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`node-editor-${width}.png`),
      fullPage: true,
    });
  }
  expect(calls).toBe(0);
});

const graph = async (page) =>
  JSON.parse(await page.locator("#conditionBuilder #json").textContent());
async function importGraph(page, g) {
  const h = page.locator("#conditionBuilder");
  await h.getByText("条件グラフのJSONを見る", { exact: true }).click();
  await h.locator("#editJSON").click();
  await h.locator("#graphJSON").fill(JSON.stringify(g));
  await h.getByRole("button", { name: "JSONを反映", exact: true }).click();
}
test("test results show on nodes only in the test tab; no preset scenarios", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  const h = page.locator("#conditionBuilder");
  await h.locator("#offer").fill("ポロシャツのご案内");
  await h.locator('[data-edit="jev_1"]').click();
  await h.locator("#nodeEditDialog textarea").fill("ポロシャツに興味がある人");
  await h.locator("#nodeEditForm button[type=submit]").click();
  await h.locator('[data-tab="test"]').click();
  await expect(h.locator("[data-scenario]")).toHaveCount(0);
  await h.locator("#testRun").click();
  await expect(h.locator(".node .tag").first()).toBeVisible();
  await expect(h.locator(".node.result")).toContainText(
    /条件を満たす|対象外|情報不足/,
  );
  await h.locator('[data-tab="edit"]').click();
  await expect(h.locator(".node .tag")).toHaveCount(0);
  await expect(h.locator(".node.result")).not.toContainText("条件を満たす");
  await h.locator('[data-tab="test"]').click();
  await expect(h.locator(".node .tag").first()).toBeVisible();
});
test("node buttons and context menu edit/cancel/delete/undo; ports build nested conditions and reject cycles", async ({
  page,
}, testInfo) => {
  test.setTimeout(45000);
  await setup(page);
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  const h = page.locator("#conditionBuilder");
  await h.locator("#offer").fill("ポロシャツのご案内");
  await h.locator('[data-edit="jev_1"]').click();
  await h.locator("#nodeEditDialog textarea").fill("変更せず取り消す");
  await h.locator("#nodeEditCancel").click();
  expect((await graph(page)).nodes[0].condition).toBe("");
  await h.locator('[data-edit="jev_1"]').click();
  await h.locator("#nodeEditDialog textarea").fill("比較している");
  await h.getByRole("button", { name: "変更を保存", exact: true }).click();
  // Add URL and OR via palette; existing Jev -> result link is removed explicitly.
  await h.locator('[data-add="url"]').click();
  const urlId = (await graph(page)).nodes.find((n) => n.kind === "url").id;
  await h.locator('[data-edit="' + urlId + '"]').click();
  await h.locator("#modal-value").fill("runner");
  await h.getByRole("button", { name: "変更を保存", exact: true }).click();
  await h.locator('[data-add="or"]').click();
  const orId = (await graph(page)).nodes.find((n) => n.kind === "or").id;
  const oldEdge = (await graph(page)).edges[0].id;
  await h.locator(`[data-edge="${oldEdge}"]`).first().click();
  await h.locator("#removeSelected").click();
  const connect = async (from, to) => {
    await h.locator(`[data-out="${from}"]`).click();
    await h.locator(`[data-in="${to}"]`).click();
  };
  await connect("jev_1", orId);
  await h
    .locator(`[data-out="${urlId}"]`)
    .dragTo(h.locator(`[data-in="${orId}"]`));
  await connect(orId, "result");
  expect((await graph(page)).edges).toHaveLength(3);
  await expect(h.locator("#issues")).toBeHidden();
  await h.locator('[data-add="and"]').click();
  const andId = (await graph(page)).nodes.find((n) => n.kind === "and").id;
  await connect(orId, andId);
  await connect(andId, orId);
  await expect(h.locator("#message")).toContainText("循環");
  expect((await graph(page)).edges).toHaveLength(4);
  await h.locator(`[data-node="${andId}"]`).click({ button: "right" });
  await expect(h.getByRole("menu")).toBeVisible();
  await h.getByRole("menuitem", { name: "削除する", exact: true }).click();
  expect((await graph(page)).nodes.some((n) => n.id === andId)).toBe(false);
  await h.locator("#undo").click();
  expect((await graph(page)).nodes.some((n) => n.id === andId)).toBe(true);
  await h.locator(`[data-delete-node="${andId}"]`).click();
  await h.locator('[data-node="result"]').click({ button: "right" });
  await expect(h.getByRole("menu")).toContainText("最終結果は固定");
  await page.keyboard.press("Escape");
  expect((await graph(page)).nodes.find((n) => n.id === "result")).toBeTruthy();
  // Dragging moves coordinates, rather than changing logical node data.
  const before = (await graph(page)).layout[urlId];
  const handle = h.locator(`[data-drag="${urlId}"]`);
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y + 45, { steps: 3 });
  await page.mouse.up();
  expect((await graph(page)).layout[urlId]).not.toEqual(before);
  await h.locator("#arrange").click();
  await h.locator("#trySettings").click();
  await expect(h.locator("#testOutcome")).toContainText("条件を満たします");
  expect(calls).toBe(0);
  await page.screenshot({
    path: testInfo.outputPath("node-ports-and-or.png"),
    fullPage: true,
  });
  await h.screenshot({ path: testInfo.outputPath("condition-nodes.png") });
});
test("sample tester handles positive/negative/unknown/boundary, sanitizes URLs before sending, invalidates changes and rejects malformed JSON without replacing nodes", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "新しい施策", exact: true }).click();
  const h = page.locator("#conditionBuilder");
  const { mixedGraph } = await import("../graph-fixtures.js");
  await importGraph(page, mixedGraph());
  // Add a blocked query key via actual site config; editor receives it after reload.
  await saveThresholdDraft(page);
  const current = (await browserAPI(page, "/admin/api/v2/sites/demo")).site;
  current.excludedQueryKeys = ["email"];
  db.raw
    .prepare("UPDATE admin_sites SET body=?,revision=? WHERE id='demo'")
    .run(JSON.stringify(current), crypto.randomUUID());
  await page.reload();
  const requests = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/condition-test")) requests.push(r.postDataJSON());
  });
  await h.locator('[data-tab="test"]').click();
  await h
    .locator("#sampleEntry")
    .fill(
      "https://www.example.com/products/a?cid=runner&email=private@example.com",
    );
  await h.locator("#prob-comparison").fill("0.9");
  await h.locator("#testRun").click();
  await expect(h.locator("#testOutcome")).toContainText("条件を満たします");
  expect(JSON.stringify(requests.at(-1))).not.toContain("private@");
  expect(requests.at(-1).entryUrl).not.toContain("email=");
  await h.locator("#prob-comparison").fill("0.7");
  await expect(h.locator("#testOutcome")).toContainText(
    "テストを実行してください",
  );
  await h.locator("#testRun").click();
  await expect(h.locator("#testOutcome")).toContainText("対象外");
  await h.locator("#prob-comparison").fill("");
  await h.locator("#testRun").click();
  await expect(h.locator("#testOutcome")).toContainText("情報不足");
  await h.locator("#prob-comparison").fill("0.8");
  await h.locator("#testRun").click();
  await expect(h.locator("#testOutcome")).toContainText("条件を満たします");
  await page.getByRole("radio", { name: "慎重に判定", exact: true }).check();
  await expect(h.locator("#testOutcome")).toContainText(
    "テストを実行してください",
  );
  await h.locator("#testRun").click();
  await expect(h.locator("#testOutcome")).toContainText("対象外");
  const original = await graph(page);
  await h.getByText("条件グラフのJSONを見る", { exact: true }).click();
  await h.locator("#editJSON").click();
  const cycle = structuredClone(original);
  cycle.edges.push({ id: "cycle", from: "and", to: "or" });
  await h.locator("#graphJSON").fill(JSON.stringify(cycle));
  await h.getByRole("button", { name: "JSONを反映", exact: true }).click();
  await expect(h.locator("#jsonError")).toContainText("循環");
  await h.locator("#cancelJSON").click();
  expect(await graph(page)).toEqual(original);
  expect(calls).toBe(0);
});
test("viewer sees graph conditions but cannot modify nodes, modal fields, ports or test", async ({
  page,
}) => {
  await setup(page);
  const session = await browserAPI(page, "/auth/session");
  db.raw
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES('reserved','reserved@example.com','Reserved','superuser','active',?)",
    )
    .run(Date.now());
  db.raw
    .prepare("UPDATE admin_users SET global_role='member' WHERE id=?")
    .run(session.user.id);
  db.raw
    .prepare(
      "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,'demo','viewer')",
    )
    .run(session.user.id);
  await page.reload();
  await page.locator('a[data-nav="campaigns"]').click();
  await page.locator('[data-open="guide"]').first().click();
  const h = page.locator("#conditionBuilder");
  await expect(h.locator(".node.jev")).toHaveCount(1);
  await expect(h.locator('[data-add="url"]')).toBeDisabled();
  await expect(h.locator("#offer")).toBeDisabled();
  await expect(h.locator('[data-out="jev_1"]')).toBeDisabled();
  await h.locator('[data-edit="jev_1"]').click();
  await expect(h.locator("#nodeEditDialog textarea")).toBeDisabled();
  await expect(
    h.getByRole("button", { name: "変更を保存", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(0);
});
