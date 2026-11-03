import test from "node:test";
import assert from "node:assert/strict";
import { cloudflareFixture } from "./cloudflare-fixture.js";
import { randomToken, hash, SESSION_COOKIE } from "../src/admin/crypto.js";
test("workerd uses the site's encrypted key, persists D1 usage across requests, and denies other roles", async (t) => {
  const used = [];
  const f = await cloudflareFixture({
    passkey: true,
    bindings: {
      JEV_KEYRING: JSON.stringify({
        active: "v1",
        keys: { v1: Buffer.alloc(32, 19).toString("base64url") },
      }),
    },
    onCall: (key) => used.push(key),
  });
  t.after(() => f.mf.dispose());
  const id = crypto.randomUUID(),
    token = randomToken(),
    csrf = randomToken(),
    now = Date.now();
  await f.db
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES(?,?,?,'member','active',?)",
    )
    .bind(id, "test@example.com", "Owner", now)
    .run();
  await f.db
    .prepare(
      "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,'demo','admin')",
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
  const path = "/admin/api/v2/sites/demo/jev";
  const save = await f.dispatch(path, {
    method: "PUT",
    headers: { ...headers, "If-Match": "none" },
    body: JSON.stringify({
      mode: "site",
      apiKey: "synthetic-workerd-site-key",
    }),
  });
  assert.equal(save.status, 200, await save.clone().text());
  const decision = await f.decision();
  assert.equal(decision.status, 200, await decision.clone().text());
  assert.deepEqual(used, ["Bearer synthetic-workerd-site-key"]);
  const report = await (await f.dispatch(path + "/usage", { headers })).json();
  assert.equal(report.totals.started, 1);
  assert.equal(report.totals.succeeded, 1);
  assert.equal(report.recent[0].actualModel, "mock-jev");
  const row = await f.db
    .prepare("SELECT * FROM site_jev_credentials WHERE site_id='demo'")
    .first();
  assert.equal(
    JSON.stringify(row).includes("synthetic-workerd-site-key"),
    false,
  );
  await f.db
    .prepare("UPDATE admin_memberships SET role='editor' WHERE user_id=?")
    .bind(id)
    .run();
  assert.equal((await f.dispatch(path, { headers })).status, 403);
  assert.equal((await f.dispatch(path + "/usage", { headers })).status, 403);
  await f.db
    .prepare(
      "UPDATE site_jev_credentials SET ciphertext='corrupt' WHERE site_id='demo'",
    )
    .run();
  assert.equal((await f.decision()).status, 503);
  assert.equal(f.calls(), 1);
});

test("workerd rejects retired global credentials for absent and old instance-mode sites before budget or HTTP dispatch", async (t) => {
  const f = await cloudflareFixture({ passkey: true });
  t.after(() => f.mf.dispose());
  let response = await f.decision();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "model_not_configured");
  await f.db
    .prepare(
      "INSERT INTO site_jev_credentials(site_id,mode,revision,updated_at) VALUES('demo','instance','retired',?)",
    )
    .bind(Date.now())
    .run();
  response = await f.decision();
  assert.equal(response.status, 503);
  assert.equal(f.calls(), 0);
  assert.equal(
    (await f.db.prepare("SELECT count(*) AS n FROM site_jev_calls").first()).n,
    0,
  );
});
