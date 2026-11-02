import test from "node:test";
import assert from "node:assert/strict";
import { buildManagedApp } from "../src/app.js";
import { fixture, input } from "./helpers.js";
import { hash, randomToken, SESSION_COOKIE } from "../src/admin/crypto.js";
import {
  standardMetadata,
  defaultMetadataRules,
  metadataRevision,
} from "../src/metadata-policy.js";
const origin = "https://admin.example.com",
  siteOrigin = "https://www.example.com";
async function setup(t) {
  let calls = 0;
  const f = await buildManagedApp({
    databasePath: ":memory:",
    config: fixture(),
    origin,
    secret: "test-secret-".repeat(4),
    bootstrapToken: "boot-".repeat(10),
    jev: async () => {
      calls++;
      return { model: "mock", answers: { c0q0: { noul: 0.95 } } };
    },
  });
  t.after(() => f.app.close());
  const id = crypto.randomUUID(),
    token = randomToken(),
    csrf = randomToken(),
    now = Date.now();
  await f.administration.repo.run(
    "UPDATE admin_settings SET initialized=1 WHERE id=1",
  );
  await f.administration.repo.run(
    "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES(?,?,?,'member','active',?)",
    id,
    "test@example.com",
    "Owner",
    now,
  );
  await f.administration.repo.run(
    "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,'demo','admin')",
    id,
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
  const dispatch = (path, method = "GET", payload, headers = {}) =>
    f.app.inject({
      url: path,
      method,
      headers: {
        host: "admin.example.com",
        origin,
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${token}`,
        "X-JevSense-CSRF": csrf,
        ...headers,
      },
      payload,
    });
  return {
    ...f,
    id,
    token,
    csrf,
    dispatch,
    calls: () => calls,
    repo: f.administration.repo,
  };
}
const policy = () => ({ mode: "custom", rules: defaultMetadataRules() });
const target = () => ({
  url: siteOrigin + "/products/a?variant=blue#size",
  nonce: randomToken(),
  policy: policy(),
});
const redeem = (f, ticket, nonce, headers = {}) =>
  f.dispatch(
    "/v1/metadata/redeem?siteId=demo",
    "POST",
    { token: ticket.token, nonce, path: "/products/a" },
    { origin: siteOrigin, cookie: "", ...headers },
  );
test("site policy save uses admin permissions, CAS and strict validation; public config has no secrets; old SDK requests hold before Jev", async (t) => {
  const f = await setup(t),
    path = "/admin/api/v2/sites/demo";
  let value = (await f.dispatch(path)).json();
  assert.equal(value.site.metadataExtraction, undefined);
  let r = await f.dispatch(
    path + "/settings",
    "PUT",
    { settings: { metadataExtraction: standardMetadata() } },
    { "If-Match": value.revision },
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (
      await f.dispatch(
        path + "/settings",
        "PUT",
        { settings: { metadataExtraction: policy() } },
        { "If-Match": value.revision },
      )
    ).statusCode,
    409,
  );
  const pub = await f.dispatch("/v1/sites/demo", "GET", undefined, {
    origin: siteOrigin,
  });
  assert.equal(pub.statusCode, 200, pub.body);
  const p = pub.json();
  assert.equal(p.metadataRevision, await metadataRevision(standardMetadata()));
  assert.deepEqual(p.metadataExtraction, standardMetadata());
  assert.equal(p.origins, undefined);
  assert.equal(p.campaigns, undefined);
  r = await f.dispatch("/v1/decision?siteId=demo", "POST", input(), {
    origin: siteOrigin,
  });
  assert.equal(r.json().reason, "metadata_revision_changed");
  assert.equal(f.calls(), 0);
  r = await f.dispatch(
    "/v1/decision?siteId=demo",
    "POST",
    { ...input(), metadataRevision: p.metadataRevision },
    { origin: siteOrigin },
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(f.calls(), 1);
  await f.repo.run(
    "UPDATE admin_memberships SET role='editor' WHERE user_id=?",
    f.id,
  );
  value = (await f.dispatch(path)).json();
  assert.equal(
    (
      await f.dispatch(
        path + "/settings",
        "PUT",
        { settings: { metadataExtraction: policy() } },
        { "If-Match": value.revision },
      )
    ).statusCode,
    403,
  );
});
test("inspection is admin-only, CSRF-protected and bound to site URL, nonce, origin, one redemption and no model/history logs", async (t) => {
  const f = await setup(t),
    body = target(),
    path = "/admin/api/v2/sites/demo/metadata-inspection";
  assert.equal(
    (await f.dispatch(path, "POST", body, { "X-JevSense-CSRF": "" }))
      .statusCode,
    403,
  );
  for (const url of [
    "https://evil.example/products/a",
    siteOrigin + "/checkout",
    "http://www.example.com/products/a",
    "https://user:secret@www.example.com/products/a",
  ])
    assert.equal(
      (await f.dispatch(path, "POST", { ...body, url })).statusCode,
      400,
    );
  await f.repo.run(
    "UPDATE admin_memberships SET role='editor' WHERE user_id=?",
    f.id,
  );
  assert.equal((await f.dispatch(path, "POST", body)).statusCode, 403);
  await f.repo.run(
    "UPDATE admin_memberships SET role='admin' WHERE user_id=?",
    f.id,
  );
  const r = await f.dispatch(path, "POST", body);
  assert.equal(r.statusCode, 200, r.body);
  const ticket = r.json();
  assert.equal(ticket.url, body.url);
  assert.ok(ticket.expiresAt > Date.now());
  assert.equal((await redeem(f, ticket, randomToken())).statusCode, 410);
  assert.equal(
    (await redeem(f, ticket, body.nonce, { origin: "https://evil.example" }))
      .statusCode,
    403,
  );
  const accepted = await redeem(f, ticket, body.nonce);
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(accepted.json().policy, body.policy);
  assert.equal(accepted.headers["access-control-allow-origin"], siteOrigin);
  assert.equal((await redeem(f, ticket, body.nonce)).statusCode, 410);
  assert.equal(f.calls(), 0);
  const row = await f.repo.one("SELECT * FROM admin_metadata_tickets");
  assert.equal(JSON.stringify(row).includes(ticket.token), false);
  assert.equal("result" in row, false);
  assert.equal(row.path, "/products/a");
});
test("inspection rejects expiration, logout, role revocation, permission/path changes and metadata disablement", async (t) => {
  const f = await setup(t),
    path = "/admin/api/v2/sites/demo/metadata-inspection";
  for (const change of ["expire", "role", "disabled", "path", "logout"]) {
    const body = target(),
      r = await f.dispatch(path, "POST", body);
    assert.equal(r.statusCode, 200, r.body);
    const ticket = r.json();
    if (change === "expire")
      await f.repo.run("UPDATE admin_metadata_tickets SET expires_at=0");
    if (change === "role")
      await f.repo.run(
        "UPDATE admin_memberships SET role='viewer' WHERE user_id=?",
        f.id,
      );
    if (change === "logout")
      await f.repo.run("DELETE FROM admin_sessions WHERE user_id=?", f.id);
    if (change === "disabled" || change === "path") {
      const { site } = await f.repo.site("demo");
      if (change === "disabled") site.metadataEnabled = false;
      else site.allowedPathPrefixes = ["/guides/"];
      await f.repo.run(
        "UPDATE admin_sites SET body=? WHERE id=?",
        JSON.stringify(site),
        "demo",
      );
    }
    const redeemResult = await redeem(f, ticket, body.nonce);
    assert.ok(
      [400, 409, 410].includes(redeemResult.statusCode),
      redeemResult.body,
    );
    if (change === "role")
      await f.repo.run(
        "UPDATE admin_memberships SET role='admin' WHERE user_id=?",
        f.id,
      );
    if (change === "disabled" || change === "path") {
      const site = fixture().sites[0];
      await f.repo.run(
        "UPDATE admin_sites SET body=? WHERE id=?",
        JSON.stringify(site),
        "demo",
      );
    }
  }
  assert.equal(f.calls(), 0);
});

test("concurrent inspection redemption permits exactly one response and does not mutate the saved site", async (t) => {
  const f = await setup(t),
    body = target(),
    before = (await f.repo.site("demo")).site;
  const r = await f.dispatch(
    "/admin/api/v2/sites/demo/metadata-inspection",
    "POST",
    body,
  );
  assert.equal(r.statusCode, 200, r.body);
  const results = await Promise.all([
    redeem(f, r.json(), body.nonce),
    redeem(f, r.json(), body.nonce),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 410]);
  assert.deepEqual((await f.repo.site("demo")).site, before);
  assert.equal(f.calls(), 0);
});
