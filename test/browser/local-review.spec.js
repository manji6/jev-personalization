import { test, expect } from "@playwright/test";
import { createServer } from "node:net";
import { buildManagedApp } from "../../src/app.js";
import { fixture } from "../helpers.js";
test("localhost review uses real HTTP, secure cookies and passkeys without public deployment", async ({
  page,
  context,
}) => {
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  const origin = `http://localhost:${port}`,
    config = fixture();
  config.sites[0].origins = [origin];
  config.sites[0].name = "Local Review";
  const { app } = await buildManagedApp({
    databasePath: ":memory:",
    config,
    origin,
    secret: "local-test-auth-secret-".repeat(3),
    bootstrapToken: "local-test-bootstrap-".repeat(3),
    jev: async () => {
      throw Error("Not used");
    },
  });
  try {
    await app.listen({ port, host: "127.0.0.1" });
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
    await page.goto(origin + "/admin");
    await page.getByLabel("表示名", { exact: true }).fill("Local Owner");
    await page
      .getByLabel("メールアドレス", { exact: true })
      .fill("local@example.com");
    await page
      .getByLabel("初回登録用の管理トークン")
      .fill("local-test-bootstrap-".repeat(3));
    await page.getByRole("button", { name: "パスキーを登録する" }).click();
    await expect(
      page.getByRole("heading", { name: "こんにちは、Local Ownerさん。" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "こんにちは、Local Ownerさん。" }),
    ).toBeVisible();
    const session = (await context.cookies()).find(
      (c) => c.name === "__Host-jevsense_session",
    );
    expect(session.httpOnly).toBe(true);
    expect(session.secure).toBe(true);
  } finally {
    await page.close();
    await app.close();
  }
});
