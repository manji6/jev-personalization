import { test, expect } from "@playwright/test";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { cloudflareFixture } from "../cloudflare-fixture.js";
import { fixture } from "../helpers.js";
test("Access owner registers passkey without shared token, sees Preview banner and previews on a protected page", async ({
  page,
  context,
}) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "browser" };
  const aud = "a".repeat(64);
  const token = await new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "browser" })
    .setIssuer("https://preview-test.cloudflareaccess.com")
    .setAudience(aud)
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const config = fixture(),
    site = config.sites[0];
  site.id = "preview-demo";
  site.origins = ["https://api.example.com"];
  site.allowedPathPrefixes = ["/demo"];
  site.excludedPathPrefixes = [];
  site.campaigns[0].enabled = false;
  const runtime = await cloudflareFixture({
    passkey: true,
    config,
    jwks: { keys: [jwk] },
    bindings: {
      DEPLOYMENT_TIER: "preview",
      PREVIEW_ACCESS_DOMAIN: "preview-test.cloudflareaccess.com",
      PREVIEW_ACCESS_AUD: aud,
      PREVIEW_MODEL_MODE: "stub",
      RELEASE_SHA: "b".repeat(40),
    },
  });
  try {
    await context.addCookies([
      {
        name: "CF_Authorization",
        value: "synthetic-access-cookie",
        domain: "api.example.com",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    await context.route("https://api.example.com/**", async (route) => {
      const req = route.request();
      if (!req.headers().cookie?.includes("CF_Authorization="))
        return route.fulfill({
          status: 403,
          json: { error: "test_access_cookie_missing" },
        });
      const r = await runtime.mf.dispatchFetch(req.url(), {
        method: req.method(),
        headers: { ...req.headers(), "Cf-Access-Jwt-Assertion": token },
        ...(req.postData() ? { body: req.postData() } : {}),
      });
      await route.fulfill({
        status: r.status,
        headers: Object.fromEntries(r.headers),
        body: Buffer.from(await r.arrayBuffer()),
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
    await page.goto("https://api.example.com/admin");
    await expect(page.locator("#deploymentNotice")).toContainText("PREVIEW");
    await expect(page.getByLabel("初回登録用の管理トークン")).toHaveCount(0);
    await expect(
      page.getByLabel("メールアドレス", { exact: true }),
    ).toHaveValue("owner@example.com");
    await page.getByLabel("表示名", { exact: true }).fill("Preview Owner");
    await page.getByRole("button", { name: "パスキーを登録する" }).click();
    await expect(
      page.getByRole("heading", { name: "こんにちは、Preview Ownerさん。" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "プレビュー", exact: true }).click();
    await page
      .getByLabel("確認するページURL", { exact: true })
      .fill("https://api.example.com/demo");
    const opening = page.waitForEvent("popup");
    await page.getByRole("button", { name: "ページを開いて確認" }).click();
    const popup = await opening;
    await expect(popup.locator("[data-jev-offer] .frame")).toBeVisible();
    expect(runtime.calls()).toBe(0);
    expect(
      await popup.evaluate(() => sessionStorage.getItem("jev:v1:preview-demo")),
    ).toBeNull();
    await popup.close();
  } finally {
    await context.unrouteAll({ behavior: "wait" });
    await runtime.mf.dispose();
  }
});
