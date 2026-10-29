import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { buildApp } from "../src/server.js";
import { fixture, input } from "./helpers.js";
import { createJev } from "../src/jev.js";
const token = "test-token-".repeat(4);
async function setup(jev) {
  const store = new Store(
    join(await mkdtemp(join(tmpdir(), "jev-test-")), "config.json"),
  );
  await store.save(fixture());
  return { store, app: await buildApp({ store, adminToken: token, jev }) };
}
const request = () => ({
  method: "POST",
  url: "/v1/decision?siteId=demo",
  headers: { origin: "https://www.example.com" },
  payload: input(),
});
test("HTTP pipeline sends bounded state and returns safe registered content", async (t) => {
  let calls = 0;
  const { app } = await setup(async (p) => {
    calls++;
    assert.equal(p.state.browsing_history_oldest_first.length, 2);
    return { model: "test", answers: { c0q0: { noul: 0.9 } } };
  });
  t.after(() => app.close());
  const r = await app.inject(request());
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().decision, "show");
  assert.equal(
    r.headers["access-control-allow-origin"],
    "https://www.example.com",
  );
  assert.equal(calls, 1);
  const q = request();
  q.payload.visits[0].visibleMs = 0;
  assert.equal((await app.inject(q)).json().reason, "insufficient_observation");
  assert.equal(calls, 1);
});
test("origin, preflight, body limit, management authorization and invalid schema", async (t) => {
  const { app } = await setup(async () => {
    throw Error();
  });
  t.after(() => app.close());
  const q = request();
  q.headers.origin = "https://evil.example";
  assert.equal((await app.inject(q)).statusCode, 403);
  assert.equal(
    (
      await app.inject({
        method: "OPTIONS",
        url: "/v1/decision?siteId=demo",
        headers: { origin: "https://www.example.com" },
      })
    ).statusCode,
    204,
  );
  assert.equal((await app.inject("/admin/api/config")).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: q.url,
        headers: { "content-type": "application/json" },
        payload: "x".repeat(66000),
      })
    ).statusCode,
    413,
  );
  q.headers.origin = "https://www.example.com";
  q.payload.visitorId = "no";
  assert.equal((await app.inject(q)).statusCode, 400);
});
test("upstream error and malformed probabilities hold, never no", async (t) => {
  for (const jev of [
    async () => {
      throw Error("private");
    },
    async () => ({ model: "test", answers: { c0q0: { noul: 2 } } }),
  ]) {
    const { app } = await setup(jev);
    t.after(() => app.close());
    const r = await app.inject(request());
    assert.equal(r.statusCode, 502);
    assert.equal(r.json().reason, "model_error");
    assert.ok(!r.body.includes("private"));
  }
});
test("atomic config updates survive reload; stale writers rejected", async (t) => {
  const { app, store } = await setup(async () => {});
  t.after(() => app.close());
  const headers = { authorization: `Bearer ${token}` };
  const current = (
    await app.inject({ url: "/admin/api/config", headers })
  ).json();
  const next = current.config;
  next.sites[0].campaigns[0].enabled = false;
  const q = {
    method: "PUT",
    url: "/admin/api/config",
    headers: { ...headers, "if-match": current.revision },
    payload: next,
  };
  assert.equal((await app.inject(q)).statusCode, 200);
  assert.equal((await app.inject(q)).statusCode, 409);
  const loaded = await new Store(store.path).load();
  assert.equal(loaded.get().sites[0].campaigns[0].enabled, false);
  assert.ok(!(await readFile(store.path, "utf8")).includes("visits"));
});
test("Jev adapter uses configured key, rejects redirects/errors and malformed response", async () => {
  let sent;
  const call = createJev({
    apiKey: "fake",
    fetchImpl: async (u, o) => {
      sent = o;
      return new Response(JSON.stringify({ model: "pinned", answers: {} }));
    },
  });
  await call({ state: {}, questions: {} });
  assert.equal(sent.headers.Authorization, "Bearer fake");
  assert.equal(sent.redirect, "error");
  assert.equal(JSON.parse(sent.body).model, "jev-1.14.0");
  await assert.rejects(
    createJev({
      apiKey: "fake",
      fetchImpl: async () => new Response("bad", { status: 429 }),
    })({}),
  );
});
test("concurrency and process cost budget hold requests before calling model", async (t) => {
  const store = new Store(
    join(await mkdtemp(join(tmpdir(), "jev-budget-")), "config.json"),
  );
  await store.save(fixture());
  let release,
    calls = 0;
  const app = await buildApp({
    store,
    adminToken: token,
    maxConcurrent: 1,
    dailyRequestBudget: 1,
    jev: async () => {
      calls++;
      await new Promise((r) => (release = r));
      return { model: "test", answers: { c0q0: { noul: 0.9 } } };
    },
  });
  t.after(() => app.close());
  const first = app.inject(request());
  await new Promise((r) => setTimeout(r, 30));
  const blocked = await app.inject(request());
  assert.equal(blocked.statusCode, 503);
  assert.equal(calls, 1);
  release();
  assert.equal((await first).statusCode, 200);
  assert.equal((await app.inject(request())).json().reason, "budget_exhausted");
});
test("per-IP request throttling returns 429", async (t) => {
  const { app } = await setup(async () => {});
  t.after(() => app.close());
  let response;
  for (let i = 0; i < 61; i++) response = await app.inject("/health");
  assert.equal(response.statusCode, 429);
});
test("parallel saves reject a competing stale revision inside write queue", async () => {
  const store = new Store(
    join(await mkdtemp(join(tmpdir(), "jev-race-")), "config.json"),
  );
  await store.save(fixture());
  const revision = store.revision();
  const a = fixture(),
    b = fixture();
  a.sites[0].minVisibleMs = 10000;
  b.sites[0].minVisibleMs = 20000;
  const result = await Promise.allSettled([
    store.save(a, revision),
    store.save(b, revision),
  ]);
  assert.equal(result[0].status, "fulfilled");
  assert.equal(result[1].status, "rejected");
  assert.equal(store.get().sites[0].minVisibleMs, 10000);
});
