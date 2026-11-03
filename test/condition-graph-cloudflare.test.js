import test from "node:test";
import assert from "node:assert/strict";
import { cloudflareFixture } from "./cloudflare-fixture.js";
import { fixture } from "./helpers.js";
import { mixedGraph } from "./graph-fixtures.js";
import { urlPolicyRevision } from "../src/context-policy.js";
import { randomToken, hash, SESSION_COOKIE } from "../src/admin/crypto.js";

test("workerd evaluates mixed graph with one sparse model request; protected sample API uses the same logic without usage or writes", async (t) => {
  const config = fixture(),
    site = config.sites[0];
  site.campaigns[0].conditionGraph = mixedGraph();
  site.campaigns[0].minimumHistory = 0;
  const f = await cloudflareFixture({
    config,
    passkey: true,
    siteKeys: true,
    answers: { c0q1: { type: "noul", noul: 0.9 } },
  });
  t.after(() => f.mf.dispose());
  await f.db
    .prepare("UPDATE admin_settings SET initialized=1 WHERE id=1")
    .run();
  const token = randomToken(),
    csrf = randomToken(),
    id = crypto.randomUUID(),
    now = Date.now();
  await f.db
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES(?,?,?,'member','active',?)",
    )
    .bind(id, "graph@example.com", "Graph", now)
    .run();
  await f.db
    .prepare(
      "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,'demo','editor')",
    )
    .bind(id)
    .run();
  await f.db
    .prepare(
      "INSERT INTO admin_sessions(token_hash,user_id,user_version,csrf,created_at,last_seen,expires_at,authenticated_at) VALUES(?,?,1,?,?,?,?,?)",
    )
    .bind(await hash(token), id, csrf, now, now, now + 3600000, now)
    .run();
  const headers = {
    Origin: "https://api.example.com",
    Cookie: `${SESSION_COOKIE}=${token}`,
    "X-JevSense-CSRF": csrf,
    "Content-Type": "application/json",
  };
  const body = {
    graph: mixedGraph(),
    currentUrl: "https://www.example.com/products/a",
    entryUrl: "https://www.example.com/products/a?cid=runner",
    threshold: 0.7,
    probabilities: { comparison: 0.9, interest: null },
  };
  const request = (body, h = headers) =>
    f.dispatch("/admin/api/v2/sites/demo/condition-test", {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });
  let response = await request(body);
  assert.equal(response.status, 200, await response.clone().text());
  let result = await response.json();
  assert.equal(result.value, true);
  assert.deepEqual(result.requiredJev, ["comparison"]);
  assert.equal(f.calls(), 0);
  assert.equal(
    (await request(body, { ...headers, "X-JevSense-CSRF": "wrong" })).status,
    403,
  );
  assert.equal(
    (await request({ ...body, currentUrl: "https://evil.example/products/a" }))
      .status,
    400,
  );
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM site_jev_calls").first()).n,
    0,
  );
  const input = {
    siteId: "demo",
    protocolVersion: 2,
    currentPage: { path: "/products/a", url: body.currentUrl, name: "Polo" },
    entryPage: { path: "/products/a", url: body.entryUrl, name: "Entry" },
    metadataRevision: "legacy",
    urlPolicyRevision: await urlPolicyRevision(site),
    visits: [],
    actions: [],
    facts: {},
    delivery: {},
  };
  response = await f.decision(input);
  assert.equal(response.status, 200, await response.clone().text());
  result = await response.json();
  assert.equal(result.decision, "show");
  assert.equal(result.algorithmVersion, "condition-graph-v1");
  assert.equal(f.calls(), 1);
  assert.deepEqual(Object.keys(f.sent().questions), ["c0q1"]);
  // Reuse one Jev node in multiple branches: only one question binding remains.
  const g = mixedGraph();
  g.nodes = g.nodes.filter((n) => !["comparison", "and"].includes(n.id));
  g.edges = g.edges.filter((e) => ["a", "b"].includes(e.id));
  g.edges.push({ id: "final", from: "or", to: "result" });
  site.campaigns[0].conditionGraph = g;
  await f.db
    .prepare(
      "UPDATE admin_sites SET body=?,revision='graph-url' WHERE id='demo'",
    )
    .bind(JSON.stringify(site))
    .run();
  await f.db
    .prepare("DELETE FROM site_jev_credentials WHERE site_id='demo'")
    .run();
  response = await f.decision(input);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).decision, "show");
  assert.equal(f.calls(), 1);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM site_jev_calls").first()).n,
    1,
  );
  await f.db
    .prepare("UPDATE admin_memberships SET role='viewer' WHERE user_id=?")
    .bind(id)
    .run();
  assert.equal((await request(body)).status, 403);
});
