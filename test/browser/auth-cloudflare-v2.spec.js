import { test, expect } from "@playwright/test";
import { cloudflareFixture, adminToken } from "../cloudflare-fixture.js";
let f, authenticator;
async function virtual(page) {
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
async function wire(context) {
  await context.route("https://api.example.com/**", async (route) => {
    const request = route.request(),
      r = await f.mf.dispatchFetch(request.url(), {
        method: request.method(),
        headers: request.headers(),
        ...(request.postData() ? { body: request.postData() } : {}),
      });
    await route.fulfill({
      status: r.status,
      headers: Object.fromEntries(r.headers),
      body: Buffer.from(await r.arrayBuffer()),
    });
  });
}
async function setup(page) {
  await page.goto("https://api.example.com/admin");
  await page.getByLabel("表示名", { exact: true }).fill("Cloudflare Owner");
  await page
    .getByLabel("メールアドレス", { exact: true })
    .fill("owner@example.com");
  await page.getByLabel("初回登録用の管理トークン").fill(adminToken);
  await page.getByRole("button", { name: "パスキーを登録する" }).click();
  await expect(
    page.getByRole("heading", { name: "こんにちは、Cloudflare Ownerさん。" }),
  ).toBeVisible();
}
test.beforeEach(async ({ page, context }) => {
  f = await cloudflareFixture({ passkey: true });
  await wire(context);
  authenticator = await virtual(page);
});
test.afterEach(async () => f.mf.dispose());
test("workerd verifies real WebAuthn registration and login; challenge replay and missing user verification rejected", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  const exercise = async (uv = "required") =>
    page.evaluate(async (uv) => {
      const options = await (
        await fetch("/auth/login/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "owner@example.com" }),
        })
      ).json();
      const challengeId = options.challengeId,
        p = options.options;
      p.challenge = Uint8Array.from(
        atob(p.challenge.replaceAll("-", "+").replaceAll("_", "/")),
        (c) => c.charCodeAt(0),
      );
      p.userVerification = uv;
      const response = (
        await navigator.credentials.get({ publicKey: p })
      ).toJSON();
      const verify = () =>
        fetch("/auth/login/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeId, response }),
        });
      const first = await verify(),
        second = await verify();
      return { first: first.status, second: second.status };
    }, uv);
  const signed = await exercise();
  expect(signed).toEqual({ first: 200, second: 400 });
  await authenticator.cdp.send("WebAuthn.setUserVerified", {
    authenticatorId: authenticator.authenticatorId,
    isUserVerified: false,
  });
  expect(await exercise("discouraged")).toEqual({ first: 400, second: 400 });
  expect(f.calls()).toBe(0);
});
test("workerd atomic first setup prevents replacing Superuser; existing app_config is locked after cutover", async ({
  page,
}) => {
  await setup(page);
  const row = await f.db.prepare("SELECT global_role FROM admin_users").first();
  expect(row.global_role).toBe("superuser");
  const denied = await page.evaluate(
    async (token) =>
      (
        await fetch("/auth/setup/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "other@example.com",
            displayName: "Other",
            bootstrapToken: token,
          }),
        })
      ).status,
    adminToken,
  );
  expect(denied).toBe(409);
  await expect(
    f.db
      .prepare("UPDATE app_config SET revision=? WHERE id=1")
      .bind("legacy-overwrite")
      .run(),
  ).rejects.toThrow(/legacy_config_locked/);
  expect(f.calls()).toBe(0);
});
