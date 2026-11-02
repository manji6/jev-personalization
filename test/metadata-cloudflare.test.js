import test from "node:test";
import assert from "node:assert/strict";
import { cloudflareFixture } from "./cloudflare-fixture.js";
import { hash, randomToken, SESSION_COOKIE } from "../src/admin/crypto.js";
import { standardMetadata } from "../src/metadata-policy.js";
test("workerd/D1 publish extraction policy, reject stale decision revision and redeem a scoped inspection once", async (t) => {
  const f = await cloudflareFixture({ passkey: true });
  t.after(() => f.mf.dispose());
  const now = Date.now(),
    id = crypto.randomUUID(),
    token = randomToken(),
    csrf = randomToken();
  await f.db
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES(?,?,?,'member','active',?)",
    )
    .bind(id, "owner@example.com", "Owner", now)
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
  await f.db.prepare("UPDATE admin_settings SET initialized=1").run();
  const headers = {
    Origin: "https://api.example.com",
    Cookie: `${SESSION_COOKIE}=${token}`,
    "X-JevSense-CSRF": csrf,
    "Content-Type": "application/json",
  };
  const path = "/admin/api/v2/sites/demo",
    value = await (await f.dispatch(path, { headers })).json();
  let r = await f.dispatch(path + "/settings", {
    method: "PUT",
    headers: { ...headers, "If-Match": value.revision },
    body: JSON.stringify({
      settings: { metadataExtraction: standardMetadata() },
    }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  r = await f.dispatch("/v1/sites/demo", {
    headers: { Origin: "https://www.example.com" },
  });
  assert.equal(r.status, 200);
  const config = await r.json();
  assert.equal(config.metadataExtraction.mode, "standard");
  const decision = await (await f.decision()).json();
  assert.equal(decision.reason, "metadata_revision_changed");
  assert.equal(f.calls(), 0);
  const nonce = randomToken();
  r = await f.dispatch(path + "/metadata-inspection", {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: "https://www.example.com/products/a",
      nonce,
      policy: standardMetadata(),
    }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const ticket = await r.json();
  const redeem = () =>
    f.dispatch("/v1/metadata/redeem?siteId=demo", {
      method: "POST",
      headers: {
        Origin: "https://www.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: ticket.token, nonce, path: "/products/a" }),
    });
  r = await redeem();
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(
    r.headers.get("access-control-allow-origin"),
    "https://www.example.com",
  );
  assert.equal((await r.json()).policy.mode, "standard");
  assert.equal((await redeem()).status, 410);
  assert.equal(f.calls(), 0);
});
