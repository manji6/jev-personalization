import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
const origin = "https://help.example.com",
  base = "/jev-personalization/";
test.beforeEach(async ({ page }) => {
  await page.route(origin + "/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith(base))
      return route.fulfill({ status: 404, body: "Not found" });
    let part = decodeURIComponent(url.pathname.slice(base.length));
    if (!part || part.endsWith("/")) part += "index.html";
    else if (!extname(part)) part += ".html";
    if (part.includes("..")) return route.fulfill({ status: 404 });
    try {
      const body = await readFile(join("help/.vitepress/dist", part));
      const types = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".json": "application/json",
      };
      await route.fulfill({
        status: 200,
        contentType: types[extname(part)] || "application/octet-stream",
        body,
      });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
});
test("Help home and setup navigation render from static files with the GitHub Pages base path", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + base);
  await expect(page).toHaveTitle(/JevSense/);
  await expect(
    page.getByRole("link", { name: "はじめて使う", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "はじめて使う", exact: true }).click();
  await expect(page).toHaveURL(/getting-started\/quickstart/);
  await expect(
    page.getByRole("heading", { name: "最初に読む・ローカルで体験する" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("Japanese local search finds the account guide without a search service", async ({
  page,
}) => {
  await page.goto(origin + base);
  await page.getByRole("button", { name: "ヘルプを検索", exact: true }).click();
  const input = page.locator("#localsearch-input");
  await input.fill("パスキー");
  await expect(page.locator(".VPLocalSearchBox")).toContainText("アカウント");
  await expect(page.locator(".VPLocalSearchBox a").first()).toBeVisible();
});
test("Help mobile layout and sidebar stay within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + base + "guides/campaigns");
  await expect(
    page.getByRole("heading", { name: /施策を作成・配信する/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await expect(page.locator(".VPSidebar")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
