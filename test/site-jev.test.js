import test from "node:test";
import assert from "node:assert/strict";
import { buildManagedApp } from "../src/app.js";
import { createSiteJev } from "../src/site-jev.js";
import { createJev } from "../src/jev.js";
import { issueDebugSession, DEBUG_HEADER } from "../src/debug-auth.js";
import { fixture, input } from "./helpers.js";
import { hash, randomToken, SESSION_COOKIE } from "../src/admin/crypto.js";
const origin = "https://admin.example.com";
const ring1 = {
  active: "v1",
  keys: { v1: Buffer.alloc(32, 17).toString("base64url") },
};
const path = "/admin/api/v2/sites/demo/jev";
async function setup(t, options = {}) {
  const config = fixture();
  config.sites.push({ ...structuredClone(config.sites[0]), id: "other" });
  const sent = [];
  const f = await buildManagedApp({
    databasePath: ":memory:",
    config,
    origin,
    secret: "test-auth-".repeat(5),
    bootstrapToken: "test-boot-".repeat(5),
    jevKeyring: JSON.stringify(ring1),
    defaultJevKey: "instance-test-key",
    jevFetch: async (url, init) => {
      sent.push({
        url,
        key: init.headers.Authorization,
        body: JSON.parse(init.body),
      });
      return Response.json({
        model: "actual-test-model",
        answers: { c0q0: { noul: 0.95 } },
      });
    },
    ...options,
  });
  t.after(() => f.app.close());
  async function user(role = "admin", site = "demo") {
    const id = crypto.randomUUID(),
      token = randomToken(),
      csrf = randomToken(),
      now = Date.now();
    await f.administration.repo.run(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES(?,?,?,?,?,?)",
      id,
      id + "@example.com",
      "Synthetic",
      role === "superuser" ? role : "member",
      "active",
      now,
    );
    if (role !== "superuser")
      await f.administration.repo.run(
        "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,?,?)",
        id,
        site,
        role,
      );
    await f.administration.repo.run(
      "INSERT INTO admin_sessions(token_hash,user_id,user_version,csrf,created_at,last_seen,expires_at,authenticated_at) VALUES(?,?,1,?,?,?,?,?)",
      await hash(token),
      id,
      csrf,
      now,
      now,
      now + 3600000,
      now,
    );
    return { id, token, csrf };
  }
  async function request(
    u,
    url = path,
    method = "GET",
    payload,
    revision,
    extra = {},
  ) {
    return f.app.inject({
      url,
      method,
      headers: {
        host: "admin.example.com",
        origin,
        ...(u
          ? {
              cookie: `${SESSION_COOKIE}=${u.token}`,
              "X-JevSense-CSRF": u.csrf,
            }
          : {}),
        ...(revision ? { "If-Match": revision } : {}),
        ...extra,
      },
      payload,
    });
  }
  const decision = (siteId = "demo", value = input()) =>
    f.app.inject({
      url: "/v1/decision?siteId=" + siteId,
      method: "POST",
      headers: { host: "admin.example.com", origin: "https://www.example.com" },
      payload: { ...value, siteId },
    });
  return { ...f, user, request, decision, sent, repo: f.administration.repo };
}
test("site keys are encrypted outside site config; actual decisions use only that site's key and keep independent usage", async (t) => {
  const f = await setup(t),
    a = await f.user(),
    b = await f.user("admin", "other");
  for (const [u, p, key] of [
    [a, path, "site-a-private-test-key"],
    [b, path.replace("demo", "other"), "site-b-private-test-key"],
  ]) {
    const saved = await f.request(
      u,
      p,
      "PUT",
      { mode: "site", apiKey: key },
      "none",
    );
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.body.includes(key), false);
  }
  const row = await f.repo.one(
    "SELECT * FROM site_jev_credentials WHERE site_id='demo'",
  );
  assert.notEqual(row.ciphertext, "site-a-private-test-key");
  assert.equal(JSON.stringify(row).includes("site-a-private-test-key"), false);
  assert.equal((await f.decision()).statusCode, 200);
  assert.equal((await f.decision("other")).statusCode, 200);
  assert.deepEqual(
    f.sent.map((v) => v.key),
    ["Bearer site-a-private-test-key", "Bearer site-b-private-test-key"],
  );
  const data = (await f.request(a, path + "/usage")).json();
  assert.deepEqual(data.totals, {
    started: 1,
    succeeded: 1,
    failed: 0,
    pending: 0,
  });
  assert.equal(data.recent[0].actualModel, "actual-test-model");
  assert.equal(data.recent[0].keySource, "site");
  assert.equal(
    (await f.request(a, "/admin/api/v2/sites/demo")).body.includes(
      row.ciphertext,
    ),
    false,
  );
  const publicSite = await f.app.inject({
    url: "/v1/sites/demo",
    headers: { origin: "https://www.example.com" },
  });
  assert.equal(publicSite.body.includes("ciphertext"), false);
  const logs = JSON.stringify(await f.repo.all("SELECT * FROM site_jev_calls"));
  for (const value of [
    "site-a-private-test-key",
    "site-b-private-test-key",
    "Authorization",
    "visibleMs",
    "https://www.example.com",
  ])
    assert.equal(logs.includes(value), false, value);
});
test("site admin and Superuser only: cross-site, viewer/editor, CSRF, recent authentication and concurrent CAS are enforced", async (t) => {
  const f = await setup(t),
    a = await f.user(),
    su = await f.user("superuser");
  assert.equal((await f.request(null)).statusCode, 401);
  for (const u of [
    await f.user("editor"),
    await f.user("viewer"),
    await f.user("admin", "other"),
  ]) {
    for (const [p, m, b] of [
      [path, "GET"],
      [path + "/usage", "GET"],
      [path, "PUT", { mode: "disabled" }],
    ])
      assert.equal((await f.request(u, p, m, b, "none")).statusCode, 403);
  }
  assert.equal(
    (
      await f.request(a, path, "PUT", { mode: "disabled" }, "none", {
        "X-JevSense-CSRF": "wrong",
      })
    ).statusCode,
    403,
  );
  await f.repo.run(
    "UPDATE admin_sessions SET authenticated_at=? WHERE user_id=?",
    Date.now() - 360000,
    a.id,
  );
  assert.equal(
    (await f.request(a, path, "PUT", { mode: "disabled" }, "none")).statusCode,
    428,
  );
  await f.repo.run(
    "UPDATE admin_sessions SET authenticated_at=? WHERE user_id=?",
    Date.now(),
    a.id,
  );
  const results = await Promise.all([
    f.request(
      a,
      path,
      "PUT",
      { mode: "site", apiKey: "new-private-key-A" },
      "none",
    ),
    f.request(
      su,
      path,
      "PUT",
      { mode: "site", apiKey: "new-private-key-B" },
      "none",
    ),
  ]);
  assert.deepEqual(results.map((v) => v.statusCode).sort(), [200, 409]);
  assert.equal(
    (
      await f.repo.one(
        "SELECT count(*) AS n FROM admin_audit WHERE action='site.jev-key.update'",
      )
    ).n,
    1,
  );
  const current = (await f.request(a)).json();
  assert.equal(
    (
      await f.request(
        a,
        path,
        "PUT",
        { mode: "instance", apiKey: "forbidden-key" },
        current.revision,
      )
    ).statusCode,
    400,
  );
  assert.equal((await f.request(a, path + "/usage?days=999")).statusCode, 400);
});
test("missing/corrupt encryption fails closed without shared-key fallback; disabled and short visits do not count", async (t) => {
  const f = await setup(t),
    a = await f.user();
  let r = await f.request(
    a,
    path,
    "PUT",
    { mode: "site", apiKey: "private-site-test" },
    "none",
  );
  assert.equal(r.statusCode, 200);
  await f.repo.run(
    "UPDATE site_jev_credentials SET ciphertext='broken' WHERE site_id='demo'",
  );
  const broken = await f.decision();
  assert.equal(broken.statusCode, 503);
  assert.equal(f.sent.length, 0);
  r = await f.request(a, path, "PUT", { mode: "disabled" }, r.json().revision);
  assert.equal(r.statusCode, 200);
  assert.equal((await f.decision()).statusCode, 503);
  assert.equal(f.sent.length, 0);
  const raw = await f.repo.one(
    "SELECT * FROM site_jev_credentials WHERE site_id='demo'",
  );
  assert.equal(raw.ciphertext, null);
  assert.equal(
    (await f.request(a, path, "PUT", { mode: "instance" }, r.json().revision))
      .statusCode,
    400,
  );
  assert.equal((await f.decision()).statusCode, 503);
  r = await f.request(
    a,
    path,
    "PUT",
    { mode: "site", apiKey: "replacement-site-test-key" },
    r.json().revision,
  );
  assert.equal(r.statusCode, 200);
  const brief = input();
  brief.visits = brief.visits.map((v) => ({ ...v, visibleMs: 0 }));
  await f.decision("demo", brief);
  assert.equal(f.sent.length, 0);
  await f.decision();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].key, "Bearer replacement-site-test-key");
  assert.equal((await f.request(a, path + "/usage")).json().totals.started, 1);
  const noRoot = await setup(t, { jevKeyring: undefined });
  const owner = await noRoot.user();
  assert.equal(
    (
      await noRoot.request(
        owner,
        path,
        "PUT",
        { mode: "site", apiKey: "unpersisted-test-key" },
        "none",
      )
    ).statusCode,
    503,
  );
  assert.equal(
    (await noRoot.repo.one("SELECT count(*) AS n FROM site_jev_credentials")).n,
    0,
  );
});
test("AAD prevents ciphertext swapping across sites/revisions; keyring rotation retains old-key reads and re-encrypts on save", async (t) => {
  const f = await setup(t),
    a = await f.user();
  await f.request(
    a,
    path,
    "PUT",
    { mode: "site", apiKey: "old-root-private-key" },
    "none",
  );
  const original = await f.repo.one(
    "SELECT * FROM site_jev_credentials WHERE site_id='demo'",
  );
  await f.repo.run(
    "INSERT INTO site_jev_credentials(site_id,mode,key_id,iv,ciphertext,revision,updated_at) VALUES('other','site',?,?,?,?,?)",
    original.key_id,
    original.iv,
    original.ciphertext,
    original.revision,
    Date.now(),
  );
  const next = {
      active: "v2",
      keys: { ...ring1.keys, v2: Buffer.alloc(32, 29).toString("base64url") },
    },
    sent = [];
  const manager = createSiteJev({
    repo: f.repo,
    keyring: JSON.stringify(next),
    fetchImpl: async (_, init) => {
      sent.push(init.headers.Authorization);
      return Response.json({ model: "rotation-test", answers: {} });
    },
  });
  await assert.rejects(() => manager.prepare("other", "jev-test"));
  const before = await manager.prepare("demo", "jev-test");
  await before({ state: {}, questions: {} });
  await manager.save("demo", { mode: "site" }, original.revision, a.id);
  const updated = await f.repo.one(
    "SELECT * FROM site_jev_credentials WHERE site_id='demo'",
  );
  assert.equal(updated.key_id, "v2");
  assert.notEqual(updated.iv, original.iv);
  assert.notEqual(updated.ciphertext, original.ciphertext);
  const retired = createSiteJev({
    repo: f.repo,
    keyring: JSON.stringify({ active: "v2", keys: { v2: next.keys.v2 } }),
  });
  await retired.prepare("demo", "jev-test");
  await f.repo.run(
    "UPDATE site_jev_credentials SET revision='tampered' WHERE site_id='demo'",
  );
  await assert.rejects(() => retired.prepare("demo", "jev-test"));
  assert.deepEqual(sent, ["Bearer old-root-private-key"]);
});
test("completion loss stays unconfirmed; failed start persistence prevents HTTP; retention and counts survive manager reload", async (t) => {
  const f = await setup(t),
    repo = f.repo;
  const administrator = await f.user();
  await f.request(
    administrator,
    path,
    "PUT",
    { mode: "site", apiKey: "test-key-value" },
    "none",
  );
  let calls = 0;
  const brokenRepo = {
    one: repo.one.bind(repo),
    all: repo.all.bind(repo),
    run: (sql, ...args) => {
      if (sql.startsWith("UPDATE site_jev_calls"))
        throw Error("synthetic DB completion failure");
      return repo.run(sql, ...args);
    },
  };
  const fetchImpl = async () => {
    calls++;
    return Response.json({ model: "mock-model", answers: {} });
  };
  const manager = createSiteJev({
    repo: brokenRepo,
    keyring: JSON.stringify(ring1),
    fetchImpl,
  });
  await (
    await manager.prepare("demo", "jev-test")
  )({ state: {}, questions: {} });
  const fresh = createSiteJev({
    repo,
    keyring: JSON.stringify(ring1),
    fetchImpl,
  });
  assert.deepEqual((await fresh.usage("demo")).totals, {
    started: 1,
    succeeded: 0,
    failed: 0,
    pending: 1,
  });
  const noWrite = createSiteJev({
    repo: {
      ...brokenRepo,
      run: (sql, ...args) => {
        if (sql.startsWith("INSERT INTO site_jev_calls"))
          throw Error("synthetic DB failure");
        return repo.run(sql, ...args);
      },
    },
    keyring: JSON.stringify(ring1),
    fetchImpl,
  });
  await assert.rejects(async () => {
    await (
      await noWrite.prepare("demo", "jev-test")
    )({ state: {}, questions: {} });
  });
  assert.equal(calls, 1);
  await repo.run(
    "UPDATE site_jev_calls SET started_at=?",
    Date.now() - 91 * 86400000,
  );
  assert.equal((await fresh.usage("demo")).totals.started, 0);
  assert.equal(
    (await repo.one("SELECT count(*) AS n FROM site_jev_calls")).n,
    0,
  );
  const owner = await f.user();
  f.db.raw.exec("DROP TABLE site_jev_calls");
  const debug = await issueDebugSession(
    "test-auth-".repeat(5),
    fixture().sites[0],
    "https://www.example.com/products/polo",
    Date.now(),
    { actor: owner.id, version: 1 },
  );
  const blocked = await f.app.inject({
    url: "/v1/decision?siteId=demo",
    method: "POST",
    headers: {
      host: "admin.example.com",
      origin: "https://www.example.com",
      [DEBUG_HEADER]: debug.token,
    },
    payload: input(),
  });
  assert.equal(blocked.statusCode, 502);
  assert.equal(blocked.json().debug.model.called, false);
  assert.equal(f.sent.length, 0);
});
test("adapter records HTTP/network/timeout/format outcomes without upstream bodies, state or keys", async () => {
  const cases = [
    [
      "http_error",
      async () => new Response("sensitive upstream body", { status: 401 }),
      401,
    ],
    ["invalid_response", async () => new Response("bad json"), 200],
    [
      "network_error",
      async () => {
        throw Error("sensitive-network-body");
      },
      null,
    ],
    [
      "timeout",
      async (_, init) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(Response.json({ model: "late", answers: {} })),
            100,
          );
          init.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(init.signal.reason);
          });
        }),
      null,
    ],
    [
      "invalid_response",
      async () => Response.json({ model: "private-api-key-test", answers: {} }),
      200,
    ],
  ];
  for (const [outcome, fetchImpl, status] of cases) {
    let complete;
    await assert.rejects(
      () =>
        createJev({
          apiKey: "private-api-key-test",
          model: "jev-test",
          timeoutMs: 10,
          fetchImpl,
          onComplete: (v) => {
            complete = v;
          },
        })({ state: { private: "not-a-log" }, questions: {} }),
      (e) => !e.message.includes("sensitive"),
    );
    assert.equal(complete.outcome, outcome);
    assert.equal(complete.status, status);
    assert.equal(complete.model, null);
    assert.equal(JSON.stringify(complete).includes("private"), false);
  }
});

test("Node keyring file and encrypted credentials remain usable after the SQLite app is reopened", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "jevsense-site-key-test-"));
  const keyringPath = join(directory, "keyring.json"),
    databasePath = join(directory, "admin.sqlite");
  await writeFile(keyringPath, JSON.stringify(ring1), { mode: 0o600 });
  const first = await setup(t, {
    databasePath,
    jevKeyring: null,
    jevKeyringPath: keyringPath,
  });
  const user = await first.user();
  const saved = await first.request(
    user,
    path,
    "PUT",
    { mode: "site", apiKey: "disk-persistence-test-key" },
    "none",
  );
  assert.equal(saved.statusCode, 200);
  await first.decision();
  await first.app.close();
  const second = await setup(t, {
    databasePath,
    jevKeyring: null,
    jevKeyringPath: keyringPath,
  });
  await second.decision();
  assert.equal(second.sent[0].key, "Bearer disk-persistence-test-key");
  assert.equal(
    (await second.request(user, path + "/usage")).json().totals.started,
    2,
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
});

test("new and legacy shared-key sites hold without dispatch, while readiness is visible without exposing credential details", async (t) => {
  const f = await setup(t),
    owner = await f.user(),
    viewer = await f.user("viewer"),
    other = await f.user("admin", "other");
  let status = (await f.request(owner)).json();
  assert.equal(status.mode, "unconfigured");
  assert.equal(status.configurationState, "missing_key");
  assert.equal(status.instanceKeyConfigured, undefined);
  assert.equal((await f.decision()).statusCode, 503);
  assert.equal(f.sent.length, 0);
  let value = (await f.request(viewer, "/admin/api/v2/sites/demo")).json();
  assert.equal(value.readiness.jev, "missing_key");
  assert.equal(
    JSON.stringify(value.readiness).includes("instance-test-key"),
    false,
  );
  assert.equal((await f.request(viewer)).statusCode, 403);
  assert.equal(
    (await f.request(other, "/admin/api/v2/sites/demo")).statusCode,
    403,
  );
  await f.repo.run(
    "INSERT INTO site_jev_credentials(site_id,mode,revision,updated_at) VALUES('demo','instance','old-instance',?)",
    Date.now(),
  );
  status = (await f.request(owner)).json();
  assert.equal(status.mode, "unconfigured");
  assert.equal(status.revision, "old-instance");
  assert.equal((await f.decision()).statusCode, 503);
  assert.equal(f.sent.length, 0);
  const saved = await f.request(
    owner,
    path,
    "PUT",
    { mode: "site", apiKey: "demo-site-private-key" },
    "old-instance",
  );
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().configurationState, "ready");
  assert.equal((await f.decision()).statusCode, 200);
  assert.equal((await f.decision("other")).statusCode, 503);
  assert.deepEqual(
    f.sent.map((s) => s.key),
    ["Bearer demo-site-private-key"],
  );
  assert.equal(
    (await f.request(viewer, "/admin/api/v2/sites/demo")).json().readiness.jev,
    "ready",
  );
});
