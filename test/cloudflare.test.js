import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const createRuntime = (options) =>
  new Miniflare(convertV4MiniflareOptions(options));
import { input } from "./helpers.js";
import { cloudflareFixture, adminToken } from "./cloudflare-fixture.js";
async function setup(t, options) {
  const f = await cloudflareFixture(options);
  t.after(() => f.mf.dispose());
  return f;
}
test("Workers serves assets with security headers, SDK and correct unknown API handling", async (t) => {
  const { dispatch } = await setup(t);
  const page = await dispatch("/admin");
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("Content-Security-Policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(await page.text(), /誰に届けますか/);
  const sdk = await dispatch("/sdk.js");
  assert.equal(sdk.status, 200);
  assert.match(sdk.headers.get("Content-Type"), /javascript/);
  assert.equal((await dispatch("/admin/api/missing")).status, 401);
  assert.equal((await dispatch("/missing")).status, 404);
  assert.equal((await dispatch("/admin.html")).status, 404);
});
test("D1 configuration persistence, auth, primary reads and atomic concurrent edits", async (t) => {
  const { dispatch, db } = await setup(t);
  const headers = { Authorization: `Bearer ${adminToken}` };
  const initial = await (
    await dispatch("/admin/api/config", { headers })
  ).json();
  assert.equal(initial.revision, "test-initial");
  const a = structuredClone(initial.config),
    b = structuredClone(initial.config);
  a.sites[0].minVisibleMs = 10000;
  b.sites[0].minVisibleMs = 20000;
  const save = (config) =>
    dispatch("/admin/api/config", {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "If-Match": initial.revision,
      },
      body: JSON.stringify(config),
    });
  const responses = await Promise.all([save(a), save(b)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const row = await db
    .prepare("SELECT body FROM app_config WHERE id = 1")
    .first();
  const loaded = await (
    await dispatch("/admin/api/config", { headers })
  ).json();
  assert.deepEqual(loaded.config, JSON.parse(row.body));
  // Reapplying initialization is non-destructive.
  await db.exec(
    (await readFile("migrations/0001_config.sql", "utf8"))
      .replace(/^--.*$/gm, "")
      .trim(),
  );
  assert.deepEqual(
    (await (await dispatch("/admin/api/config", { headers })).json()).config,
    loaded.config,
  );
  assert.equal(
    (
      await dispatch("/admin/api/config", {
        headers: { ...headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
});
test("Workers decision uses real D1, filters state, composes response and enforces CORS", async (t) => {
  const { decision, dispatch, calls, sent, db } = await setup(t);
  const preflight = await dispatch("/v1/decision?siteId=demo", {
    method: "OPTIONS",
    headers: {
      Origin: "https://www.example.com",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  const publicConfig = await dispatch("/v1/sites/demo", {
    headers: { Origin: "https://www.example.com" },
  });
  assert.equal((await publicConfig.json()).minVisibleMs, 5000);
  const result = await decision();
  assert.equal(result.status, 200);
  assert.equal((await result.json()).decision, "show");
  assert.equal(calls(), 1);
  assert.equal(sent().model, "jev-1.14.0");
  assert.equal(sent().state.browsing_history_oldest_first.length, 2);
  const brief = input();
  brief.visits[0].visibleMs = 1;
  assert.equal(
    (await (await decision(brief)).json()).reason,
    "insufficient_observation",
  );
  assert.equal(calls(), 1);
  assert.equal(
    (await decision(input(), { Origin: "https://evil.example" })).status,
    403,
  );
  const extra = input();
  extra.visitorId = "forbidden";
  assert.equal((await decision(extra)).status, 400);
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();
  assert.ok(
    !tables.results.some((row) => /visits|sessions|viewers/.test(row.name)),
  );
});
test("Workers bounds JSON bodies before parsing and protects management endpoints", async (t) => {
  const { dispatch } = await setup(t);
  const headers = {
    Origin: "https://www.example.com",
    "Content-Type": "application/json",
  };
  const oversized = await dispatch("/v1/decision?siteId=demo", {
    method: "POST",
    headers,
    body: "x".repeat(66000),
  });
  assert.equal(oversized.status, 413);
  assert.equal(
    (
      await dispatch("/v1/decision?siteId=demo", {
        method: "POST",
        headers,
        body: "{bad",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await dispatch("/v1/decision?siteId=demo", {
        method: "POST",
        headers: { Origin: headers.Origin },
        body: "{}",
      })
    ).status,
    415,
  );
  const draft = await dispatch("/admin/api/draft", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "関心のある人にガイドを届けたい",
      subject: "導入方法",
    }),
  });
  assert.equal((await draft.json()).requiresReview, true);
});
test("shared daily budget is enforced before paid requests and failed model calls hold", async (t) => {
  const { decision, calls } = await setup(t, { budget: "1", error: true });
  const first = await decision();
  assert.equal(first.status, 502);
  assert.equal((await first.json()).reason, "model_error");
  assert.equal(
    first.headers.get("Access-Control-Allow-Origin"),
    "https://www.example.com",
  );
  const second = await decision();
  assert.equal(second.status, 503);
  assert.equal((await second.json()).reason, "budget_exhausted");
  assert.equal(calls(), 1);
});
test("Durable Object serializes concurrency and retains day budget across restarts", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "jev-cf-persist-"));
  const options = {
    name: "jev-test-budget",
    modules: true,
    scriptPath: "dist/worker/index.js",
    compatibilityDate: "2026-10-30",
    durableObjects: {
      MODEL_BUDGET: {
        className: "ModelBudget",
        useSQLite: true,
        unsafeUniqueKey: "jev-budget-test",
      },
    },
    resourcePersistencePath: path,
  };
  let mf = createRuntime(options);
  const stub = async () => {
    const ns = await mf.getDurableObjectNamespace("MODEL_BUDGET");
    return ns.get(ns.idFromName("quota-test"));
  };
  let budget = await stub();
  const permits = await Promise.all([
    budget.acquire({ dailyLimit: 2, maxConcurrent: 1 }),
    budget.acquire({ dailyLimit: 2, maxConcurrent: 1 }),
  ]);
  assert.equal(permits.filter((p) => p.token).length, 1);
  assert.equal(permits.filter((p) => p.reason === "busy").length, 1);
  await budget.release(permits.find((p) => p.token).token);
  await budget.acquire({ dailyLimit: 2, maxConcurrent: 1 });
  await mf.dispose();
  mf = createRuntime(options);
  t.after(() => mf.dispose());
  budget = await stub();
  assert.equal(
    (await budget.acquire({ dailyLimit: 2, maxConcurrent: 1 })).reason,
    "budget_exhausted",
  );
});

test("setup configures D1 locally and deploy refuses an unconfigured database", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-cf-setup-"));
  const config = JSON.parse(await readFile("wrangler.json", "utf8"));
  delete config.d1_databases[0].database_id;
  await writeFile(join(dir, "wrangler.json"), JSON.stringify(config));
  const script = (name, args = []) =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)), ...args],
      { cwd: dir, encoding: "utf8" },
    );
  const blocked = script("deploy-cloudflare.js");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /cf:configure/);
  const invalid = script("configure-cloudflare.js", ["not-a-uuid"]);
  assert.notEqual(invalid.status, 0);
  const configured = script("configure-cloudflare.js", [
    "123e4567-e89b-12d3-a456-426614174000",
    "jev-test-install",
  ]);
  assert.equal(configured.status, 0, configured.stderr);
  const result = JSON.parse(await readFile(join(dir, "wrangler.json"), "utf8"));
  assert.equal(result.name, "jev-test-install");
  assert.equal(
    result.d1_databases[0].database_id,
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assert.ok(!JSON.stringify(result).includes("ADMIN_TOKEN"));
});

test("Workers issues scoped debug authorization and returns trace only on authorized decisions", async (t) => {
  const { dispatch, decision, calls, sent } = await setup(t);
  const launch = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      siteId: "demo",
      url: "https://www.example.com/guides/a?omit=x#omit",
    }),
  };
  assert.equal(
    (
      await dispatch("/admin/api/debug-session", {
        ...launch,
        headers: { "Content-Type": "application/json" },
      })
    ).status,
    401,
  );
  const issued = await dispatch("/admin/api/debug-session", launch);
  assert.equal(issued.status, 200);
  const session = await issued.json();
  assert.equal(session.url, "https://www.example.com/guides/a");
  const verify = await dispatch("/v1/debug-session?siteId=demo", {
    headers: {
      Origin: "https://www.example.com",
      "X-JevSense-Debug": session.token,
    },
  });
  assert.equal(verify.status, 200);
  const result = await decision(input(), { "X-JevSense-Debug": session.token });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.deepEqual(body.debug.model.state, sent().state);
  assert.deepEqual(body.debug.model.questions, sent().questions);
  assert.equal(body.debug.model.actualModel, "mock-jev");
  assert.equal(body.debug.campaigns[0].questions[0].probability, 0.95);
  assert.equal((await (await decision()).json()).debug, undefined);
  const before = calls();
  assert.equal(
    (await decision(input(), { "X-JevSense-Debug": session.token + "x" }))
      .status,
    401,
  );
  assert.equal(calls(), before);
  const brief = input();
  brief.visits[0].visibleMs = 0;
  const hold = await (
    await decision(brief, { "X-JevSense-Debug": session.token })
  ).json();
  assert.equal(hold.debug.model.called, false);
  assert.equal(hold.reason, "insufficient_observation");
});
