import test from "node:test";
import assert from "node:assert/strict";
import { cloudflareFixture } from "./cloudflare-fixture.js";
import { randomToken, hash, SESSION_COOKIE } from "../src/admin/crypto.js";
const origin = "https://api.example.com";
test("workerd administration runs D1 migration, protects management APIs, applies sessions and site CAS", async (t) => {
  const f = await cloudflareFixture({ passkey: true });
  t.after(() => f.mf.dispose());
  assert.equal((await f.dispatch("/auth/status")).status, 200);
  assert.equal((await f.dispatch("/control.js")).status, 200);
  assert.equal(
    (
      await f.dispatch("/admin/api/config", {
        headers: { Authorization: "Bearer cloudflare-test-token-".repeat(3) },
      })
    ).status,
    401,
  );
  const token = randomToken(),
    csrf = randomToken(),
    user = crypto.randomUUID(),
    now = Date.now();
  await f.db
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES(?,?,?,'superuser','active',?)",
    )
    .bind(user, "synthetic@example.com", "D1 Test", now)
    .run();
  await f.db
    .prepare(
      "INSERT INTO admin_sessions(token_hash,user_id,user_version,csrf,created_at,last_seen,expires_at,authenticated_at) VALUES(?,?,1,?,?,?,?,?)",
    )
    .bind(await hash(token), user, csrf, now, now, now + 3600000, now)
    .run();
  const headers = {
    Cookie: `${SESSION_COOKIE}=${token}`,
    Origin: origin,
    "X-JevSense-CSRF": csrf,
    "Content-Type": "application/json",
  };
  const current = await (
    await f.dispatch("/admin/api/v2/sites/demo", { headers })
  ).json();
  assert.equal(current.role, "superuser");
  const saved = await f.dispatch("/admin/api/v2/sites/demo/settings", {
    method: "PUT",
    headers: { ...headers, "If-Match": current.revision },
    body: JSON.stringify({ settings: { name: "Managed in D1" } }),
  });
  assert.equal(saved.status, 200, await saved.text());
  const draft = structuredClone(current.site.campaigns[0]);
  draft.content.title = "D1 draft";
  const fresh = await (
    await f.dispatch("/admin/api/v2/sites/demo", { headers })
  ).json();
  const url = "/admin/api/v2/sites/demo/campaigns/" + draft.id;
  const savedDraft = await f.dispatch(url + "/draft", {
    method: "PUT",
    headers: { ...headers, "If-Match": fresh.revision },
    body: JSON.stringify(draft),
  });
  assert.equal(savedDraft.status, 200);
  const revision = (await savedDraft.json()).revision;
  const published = await f.dispatch(url + "/publish", {
    method: "POST",
    headers: { ...headers, "If-Match": revision },
    body: "{}",
  });
  assert.equal(published.status, 200, await published.text());
  const issued = await f.dispatch(url + "/preview", {
    method: "POST",
    headers,
    body: JSON.stringify({ url: "https://www.example.com/products/polo" }),
  });
  assert.equal(issued.status, 200);
  const ticket = (await issued.json()).token;
  const redeem = () =>
    f.dispatch("/v1/preview/redeem?siteId=demo", {
      method: "POST",
      headers: {
        Origin: "https://www.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: ticket,
        path: "/products/polo",
        nonce: "a".repeat(43),
      }),
    });
  const results = await Promise.all([redeem(), redeem()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 410]);
  assert.equal(f.calls(), 0);
  const codes = await f.dispatch("/admin/api/v2/recovery-codes", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(codes.status, 200);
  assert.equal((await codes.json()).codes.length, 8);
});
test("completed cutover fails closed if AUTH_MODE is accidentally removed", async (t) => {
  const f = await cloudflareFixture();
  t.after(() => f.mf.dispose());
  const { readFile } = await import("node:fs/promises");
  await f.db.exec(
    (await readFile("migrations/0002_administration.sql", "utf8"))
      .replace(/^--.*$/gm, "")
      .trim(),
  );
  await f.db.prepare("UPDATE admin_settings SET initialized=1").run();
  const response = await f.dispatch("/admin/api/config", {
    headers: { Authorization: "Bearer cloudflare-test-token-".repeat(3) },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "passkey_mode_required");
  assert.equal((await f.decision()).status, 503);
  assert.equal(f.calls(), 0);
});
