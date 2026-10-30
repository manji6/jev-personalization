import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { fixture, input } from "./helpers.js";
export const adminToken = "cloudflare-test-token-".repeat(3);
const createRuntime = (options) =>
  new Miniflare(convertV4MiniflareOptions(options));
export async function cloudflareFixture(options = {}) {
  let calls = 0,
    sent;
  const mf = createRuntime({
    name: "jev-test",
    modules: true,
    scriptPath: "dist/worker/index.js",
    compatibilityDate: "2026-10-30",
    d1Databases: ["DB"],
    durableObjects: {
      MODEL_BUDGET: {
        className: "ModelBudget",
        useSQLite: true,
        unsafeUniqueKey: "jev-budget-test",
      },
    },
    ratelimits: {
      RATE_LIMITER: { namespace_id: "1001", simple: { limit: 60, period: 60 } },
    },
    assets: {
      directory: "dist/assets",
      binding: "ASSETS",
      run_worker_first: true,
      routerConfig: { has_user_worker: true },
      assetConfig: { html_handling: "none", not_found_handling: "none" },
    },
    bindings: {
      ADMIN_TOKEN: adminToken,
      JEV_API_KEY: "fake-test-only",
      DAILY_REQUEST_BUDGET: options.budget ?? "1000",
      MAX_CONCURRENT: "10",
    },
    outboundService: async (request) => {
      calls++;
      assert.equal(request.url, "https://api.typesafe.ai/v1/systemone");
      sent = await request.json();
      if (options.error) return new Response("private error", { status: 401 });
      return Response.json({
        model: "mock-jev",
        answers: { c0q0: { type: "noul", noul: 0.95 } },
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    },
  });
  const db = await mf.getD1Database("DB");
  await db.exec(
    (await readFile("migrations/0001_config.sql", "utf8"))
      .replace(/^--.*$/gm, "")
      .trim(),
  );
  const config = fixture();
  await db
    .prepare("UPDATE app_config SET body = ?, revision = ? WHERE id = 1")
    .bind(JSON.stringify(config), "test-initial")
    .run();
  const dispatch = (path, init = {}) =>
    mf.dispatchFetch("https://api.example.com" + path, init);
  const decision = (value = input(), extra = {}) =>
    dispatch("/v1/decision?siteId=demo", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.example.com",
        ...extra,
      },
      body: JSON.stringify(value),
    });
  return { mf, db, dispatch, decision, calls: () => calls, sent: () => sent };
}
