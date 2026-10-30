import { test, expect } from "@playwright/test";
import { cloudflareFixture, adminToken } from "../cloudflare-fixture.js";

test("Cloudflare assets and management UI persist edited content through D1", async ({
  page,
}) => {
  const fixture = await cloudflareFixture();
  try {
    await page.route("https://api.example.com/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const response = await fixture.dispatch(url.pathname + url.search, {
        method: req.method(),
        headers: req.headers(),
        body: req.postData() ?? undefined,
      });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    await page.goto("https://api.example.com/admin");
    await page.locator("#token").fill(adminToken);
    await page.getByRole("button", { name: "設定を読み込む" }).click();
    await expect(page.locator("#connectionLabel")).toHaveText("接続済み");
    await page.locator("#title").fill("Cloudflareで配信するガイド");
    await expect(page.locator("#previewTitle")).toHaveText(
      "Cloudflareで配信するガイド",
    );
    await page
      .getByRole("button", { name: "編集を設定に反映", exact: true })
      .click();
    await page
      .getByRole("button", { name: "確認した設定を保存して配信に反映" })
      .click();
    await expect(page.locator("#saveState")).toHaveText("設定を保存しました");
    await page.getByRole("button", { name: "設定を読み込む" }).click();
    await expect(page.locator("#title")).toHaveValue(
      "Cloudflareで配信するガイド",
    );
    expect(fixture.calls()).toBe(0);
  } finally {
    await fixture.mf.dispose();
  }
});
