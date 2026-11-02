import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManagedApp } from "../../src/app.js";
import { fixture } from "../helpers.js";
import { randomToken, hash } from "../../src/admin/crypto.js";
test("a registered account recovers under a new RP domain without deleting sites or reopening bootstrap", async ({
  page,
  context,
}) => {
  const folder = await mkdtemp(join(tmpdir(), "jevsense-domain-")),
    databasePath = join(folder, "admin.sqlite");
  const old = "https://old.example.com",
    next = "https://new.example.com",
    bootstrapToken = "test-bootstrap-".repeat(4),
    secret = "test-domain-secret-".repeat(4);
  let app, admin;
  async function start(origin) {
    const f = await buildManagedApp({
      databasePath,
      config: fixture(),
      origin,
      secret,
      bootstrapToken,
      jev: async () => {
        throw Error("No Jev call expected");
      },
    });
    app = f.app;
    admin = f.administration;
  }
  try {
    await start(old);
    await context.route("https://*.example.com/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      const r = await app.inject({
        url: u.pathname + u.search,
        method: req.method(),
        headers: { ...req.headers(), host: u.host },
        payload: req.postData() ?? undefined,
      });
      await route.fulfill({
        status: r.statusCode,
        headers: r.headers,
        body: r.body,
      });
    });
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
    await page.goto(old + "/admin");
    await page.getByLabel("表示名", { exact: true }).fill("Owner");
    await page
      .getByLabel("メールアドレス", { exact: true })
      .fill("owner@example.com");
    await page.getByLabel("初回登録用の管理トークン").fill(bootstrapToken);
    await page.getByRole("button", { name: "パスキーを登録する" }).click();
    await expect(
      page.getByRole("heading", { name: "こんにちは、Ownerさん。" }),
    ).toBeVisible();
    const user = await admin.repo.one("SELECT id,email FROM admin_users");
    const prior = await admin.repo.one("SELECT id FROM admin_credentials");
    const sites = await admin.repo.all(
      "SELECT id,body FROM admin_sites ORDER BY id",
    );
    const token = randomToken(),
      now = Date.now();
    await admin.repo.run(
      "INSERT INTO admin_invitations(token_hash,kind,email,target_user,created_by,created_at,expires_at) VALUES(?,'recovery',?,?,?,?,?)",
      await hash(token),
      user.email,
      user.id,
      user.id,
      now,
      now + 300000,
    );
    await app.close();
    app = null;
    await start(next);
    await page.goto(next + "/admin/recover#token=" + token);
    await expect(
      page.getByRole("heading", { name: "パスキーが使えないとき" }),
    ).toBeVisible();
    await page.getByLabel("メールアドレス", { exact: true }).fill(user.email);
    await page.getByRole("button", { name: "パスキーを登録する" }).click();
    await expect(
      page.getByRole("heading", { name: "こんにちは、Ownerさん。" }),
    ).toBeVisible();
    expect((await admin.repo.one("SELECT id FROM admin_users")).id).toBe(
      user.id,
    );
    expect(
      await admin.repo.all("SELECT id,body FROM admin_sites ORDER BY id"),
    ).toEqual(sites);
    expect(
      (await admin.repo.one("SELECT count(*) AS n FROM admin_credentials")).n,
    ).toBe(1);
    expect(
      (await admin.repo.one("SELECT id FROM admin_credentials")).id,
    ).not.toBe(prior.id);
    expect(
      (
        await admin.repo.one(
          "SELECT used FROM admin_invitations WHERE kind='recovery'",
        )
      ).used,
    ).toBe(1);
    const status = await page.evaluate(
      async () => await (await fetch("/auth/status")).json(),
    );
    expect(status.rpID).toBe("new.example.com");
    expect(status.initialized).toBe(true);
    await page.getByRole("button", { name: "ログアウト", exact: true }).click();
    await page.getByLabel("メールアドレス", { exact: true }).fill(user.email);
    await page.getByRole("button", { name: "パスキーでログイン" }).click();
    await expect(
      page.getByRole("heading", { name: "こんにちは、Ownerさん。" }),
    ).toBeVisible();
  } finally {
    await context.unrouteAll({ behavior: "wait" });
    await app?.close();
    await rm(folder, { recursive: true, force: true });
  }
});
