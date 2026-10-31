import test from "node:test";
import assert from "node:assert/strict";
import { buildManagedApp } from "../src/app.js";
import { fixture, input } from "./helpers.js";
import { hash, randomToken, SESSION_COOKIE } from "../src/admin/crypto.js";
import { guidedQuestions } from "../src/questions.js";
const origin = "https://admin.example.com",
  secret = "test-only-secret-".repeat(4),
  bootstrap = "test-bootstrap-".repeat(4);
export async function managedFixture() {
  let calls = 0,
    model;
  const value = await buildManagedApp({
    databasePath: ":memory:",
    config: fixture(),
    origin,
    secret,
    bootstrapToken: bootstrap,
    jev: async (p, m) => {
      calls++;
      model = m;
      return { model: m, answers: { c0q0: { noul: 0.95 } } };
    },
  });
  const { app, administration: admin } = value;
  async function addUser(
    role = "superuser",
    siteId = "demo",
    membership = "admin",
  ) {
    const id = crypto.randomUUID(),
      token = randomToken(),
      csrf = randomToken(),
      now = Date.now();
    await admin.repo.run(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES(?,?,?,?,?,?)",
      id,
      id + "@example.com",
      "Test User",
      role,
      "active",
      now,
    );
    if (role !== "superuser")
      await admin.repo.run(
        "INSERT INTO admin_memberships(user_id,site_id,role) VALUES(?,?,?)",
        id,
        siteId,
        membership,
      );
    await admin.repo.run(
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
  const dispatch = async (path, method = "GET", payload, user, extra = {}) =>
    app.inject({
      url: path,
      method,
      headers: {
        host: "admin.example.com",
        origin,
        ...(user
          ? {
              cookie: `${SESSION_COOKIE}=${user.token}`,
              "X-JevSense-CSRF": user.csrf,
            }
          : {}),
        ...extra,
      },
      payload,
    });
  return {
    ...value,
    addUser,
    dispatch,
    calls: () => calls,
    model: () => model,
  };
}
// No production key or AI call is used by these authorization and transaction tests.
test("management requires cookie and exact Origin; shared token and old endpoints cannot bypass v2", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  assert.equal((await f.dispatch("/admin/api/v2/sites/demo")).statusCode, 401);
  assert.equal(
    (
      await f.dispatch("/admin/api/config", "PUT", fixture(), null, {
        authorization: "Bearer " + bootstrap,
      })
    ).statusCode,
    401,
  );
  const user = await f.addUser();
  assert.equal(
    (
      await f.dispatch(
        "/admin/api/v2/profile",
        "PUT",
        { displayName: "New" },
        user,
        { origin: "https://evil.example" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.dispatch(
        "/admin/api/v2/profile",
        "PUT",
        { displayName: "New" },
        user,
        { "X-JevSense-CSRF": "bad" },
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.dispatch(
        "/admin/api/v2/profile",
        "PUT",
        { displayName: "New" },
        user,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.dispatch("/auth/session", "GET", undefined, user)).json().user
      .displayName,
    "New",
  );
  const html = await f.dispatch("/admin");
  assert.equal(html.statusCode, 200);
  assert.match(html.body, /control.js/);
  assert.match(
    html.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  assert.equal(
    (await f.dispatch("/control.js")).headers["content-type"],
    "application/javascript; charset=utf-8",
  );
});
test("site membership and global role are checked on backend and revocation is immediate", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  const viewer = await f.addUser("member", "demo", "viewer"),
    editor = await f.addUser("member", "demo", "editor");
  assert.equal(
    (await f.dispatch("/admin/api/v2/sites/demo", "GET", undefined, viewer))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.dispatch("/admin/api/v2/sites/other", "GET", undefined, viewer))
      .statusCode,
    403,
  );
  assert.equal(
    (await f.dispatch("/admin/api/v2/users", "GET", undefined, editor))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await f.dispatch(
        "/admin/api/v2/sites/demo/settings",
        "PUT",
        { settings: { name: "No" } },
        editor,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await f.dispatch(
        "/admin/api/v2/sites/demo/campaigns/guide/draft",
        "PUT",
        fixture().sites[0].campaigns[0],
        viewer,
      )
    ).statusCode,
    403,
  );
  await f.administration.repo.run(
    "DELETE FROM admin_memberships WHERE user_id=?",
    editor.id,
  );
  assert.equal(
    (await f.dispatch("/admin/api/v2/sites/demo", "GET", undefined, editor))
      .statusCode,
    403,
  );
  await f.administration.repo.run(
    "UPDATE admin_users SET status='disabled' WHERE id=?",
    viewer.id,
  );
  assert.equal(
    (await f.dispatch("/auth/session", "GET", undefined, viewer)).statusCode,
    401,
  );
});
test("drafts preserve published delivery, deterministic questions compile only on publish, stale writes conflict", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  const user = await f.addUser();
  await f.administration.repo.run("UPDATE admin_settings SET initialized=1");
  const before = (
    await f.dispatch("/admin/api/v2/sites/demo", "GET", undefined, user)
  ).json();
  const campaign = structuredClone(before.site.campaigns[0]);
  campaign.name = "Offer";
  campaign.content.title = "Updated";
  campaign.judgment = {
    offer: "吸汗速乾ポロシャツの特集",
    conditions: ["吸汗速乾機能に関心がある", "ポロシャツを比較している"],
  };
  const path = `/admin/api/v2/sites/demo/campaigns/${campaign.id}`;
  const saved = await f.dispatch(path + "/draft", "PUT", campaign, user, {
    "If-Match": before.revision,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.notEqual(
    (await f.administration.repo.publicConfig()).sites[0].campaigns[0].content
      .title,
    "Updated",
  );
  assert.equal(
    (
      await f.dispatch(path + "/draft", "PUT", campaign, user, {
        "If-Match": before.revision,
      })
    ).statusCode,
    409,
  );
  const published = await f.dispatch(path + "/publish", "POST", {}, user, {
    "If-Match": saved.json().revision,
  });
  assert.equal(published.statusCode, 200, published.body);
  const after = (await f.administration.repo.publicConfig()).sites[0]
    .campaigns[0];
  assert.equal(after.content.title, "Updated");
  assert.equal(after.enabled, true);
  assert.deepEqual(after.questions, guidedQuestions(campaign.judgment));
  assert.equal(f.calls(), 0);
  assert.equal(
    (await f.administration.repo.all("SELECT * FROM admin_drafts")).length,
    0,
  );
  await assert.rejects(
    () =>
      f.administration.repo.run(
        "UPDATE app_config SET revision=? WHERE id=1",
        "overwrite",
      ),
    /legacy_config_locked/,
  );
});
test("single-use preview tickets enforce path, site, revisions, expiration and current permissions without AI", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  const user = await f.addUser();
  const base = "/admin/api/v2/sites/demo/campaigns/guide/preview";
  const issued = await f.dispatch(
    base,
    "POST",
    { url: "https://www.example.com/products/polo?campaign=x" },
    user,
  );
  assert.equal(issued.statusCode, 200, issued.body);
  const token = issued.json().token;
  assert.ok(token);
  const redeem = (ticket, path = "/products/polo", headers = {}) =>
    f.dispatch(
      "/v1/preview/redeem?siteId=demo",
      "POST",
      { token: ticket, path, nonce: "a".repeat(43) },
      null,
      { origin: "https://www.example.com", ...headers },
    );
  assert.equal((await redeem(token, "/account")).statusCode, 410);
  const response = await redeem(token);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().mode, "preview");
  assert.equal(
    response.headers["access-control-allow-origin"],
    "https://www.example.com",
  );
  assert.equal((await redeem(token)).statusCode, 410);
  assert.equal(f.calls(), 0);
  const second = (
    await f.dispatch(
      base,
      "POST",
      { url: "https://www.example.com/products/polo" },
      user,
    )
  ).json();
  await f.administration.repo.run(
    "UPDATE admin_preview_tickets SET expires_at=1 WHERE token_hash=?",
    await hash(second.token),
  );
  assert.equal((await redeem(second.token)).statusCode, 410);
  const third = (
    await f.dispatch(
      base,
      "POST",
      { url: "https://www.example.com/products/polo" },
      user,
    )
  ).json();
  await f.administration.repo.run(
    "UPDATE admin_sites SET revision=? WHERE id=?",
    "new",
    "demo",
  );
  assert.equal((await redeem(third.token)).statusCode, 409);
  assert.equal(
    (
      await f.dispatch(
        base,
        "POST",
        { url: "https://evil.example/products/polo" },
        user,
      )
    ).statusCode,
    400,
  );
});
test("debug permission revoked live; system settings apply; last Superuser and recent authentication enforced", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  const superuser = await f.addUser(),
    editor = await f.addUser("member", "demo", "editor");
  const issued = (
    await f.dispatch(
      "/admin/api/v2/sites/demo/debug",
      "POST",
      { url: "https://www.example.com/products/polo" },
      editor,
    )
  ).json();
  assert.ok(
    await f.administration.verifyDebug(
      issued.token,
      "demo",
      "https://www.example.com",
    ),
  );
  await f.administration.repo.run(
    "DELETE FROM admin_memberships WHERE user_id=?",
    editor.id,
  );
  assert.equal(
    await f.administration.verifyDebug(
      issued.token,
      "demo",
      "https://www.example.com",
    ),
    null,
  );
  const own = await f.dispatch(
    "/admin/api/v2/users/" + superuser.id,
    "PUT",
    { globalRole: "member", status: "active" },
    superuser,
  );
  assert.equal(own.statusCode, 409);
  assert.equal(own.json().error, "last_superuser");
  await f.administration.repo.run(
    "UPDATE admin_sessions SET authenticated_at=? WHERE user_id=?",
    Date.now() - 300001,
    superuser.id,
  );
  assert.equal(
    (await f.dispatch("/admin/api/v2/recovery-codes", "POST", {}, superuser))
      .statusCode,
    428,
  );
});
test("manual invitations are one-time and creator permission revocation invalidates unaccepted links", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  const owner = await f.addUser("member", "demo", "admin");
  const invitation = await f.dispatch(
    "/admin/api/v2/sites/demo/invitations",
    "POST",
    { email: "Invite@Example.com", role: "editor" },
    owner,
  );
  assert.equal(invitation.statusCode, 200, invitation.body);
  const token = new URL(invitation.json().url).hash.slice(7);
  const inspect = () =>
    f.dispatch("/auth/invitation/inspect", "POST", { token });
  assert.equal((await inspect()).json().email, "invite@example.com");
  await f.administration.repo.run(
    "DELETE FROM admin_memberships WHERE user_id=?",
    owner.id,
  );
  assert.equal((await inspect()).statusCode, 410);
});
test("unfinished drafts save without leaking into delivery; publishing and forced previews require valid content", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  const user = await f.addUser();
  const before = (
    await f.dispatch("/admin/api/v2/sites/demo", "GET", undefined, user)
  ).json();
  const c = structuredClone(before.site.campaigns[0]);
  c.id = "unfinished";
  c.name = "";
  c.content.title = "";
  c.judgment = { offer: "", conditions: [""] };
  const root = "/admin/api/v2/sites/demo/campaigns/unfinished";
  const draft = await f.dispatch(root + "/draft", "PUT", c, user, {
    "If-Match": before.revision,
  });
  assert.equal(draft.statusCode, 200, draft.body);
  const pub = await f.dispatch(root + "/publish", "POST", {}, user, {
    "If-Match": draft.json().revision,
  });
  assert.equal(pub.statusCode, 400);
  assert.equal(
    (
      await f.dispatch(
        root + "/preview",
        "POST",
        { url: "https://www.example.com/products/polo" },
        user,
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.dispatch(root + "/draft", "DELETE", undefined, user, {
        "If-Match": "old",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await f.dispatch(root + "/draft", "DELETE", undefined, user, {
        "If-Match": draft.json().revision,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await f.administration.repo.all("SELECT * FROM admin_drafts")).length,
    0,
  );
});
test("last passkey cannot be removed via direct API and custom campaigns require administrator role", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  const owner = await f.addUser(),
    editor = await f.addUser("member", "demo", "editor");
  await f.administration.repo.run(
    "INSERT INTO admin_credentials(id,user_id,public_key,counter,transports,label,created_at) VALUES(?,?,?,0,'[]','Test',?)",
    "last-key",
    owner.id,
    "public-only-test",
    Date.now(),
  );
  const removal = await f.dispatch(
    "/admin/api/v2/passkeys/last-key",
    "DELETE",
    undefined,
    owner,
  );
  assert.equal(removal.statusCode, 409);
  assert.equal(removal.json().error, "last_passkey");
  const current = await f.administration.repo.site("demo");
  current.site.allowCustomJavaScript = true;
  current.site.campaigns[0].presentation.type = "custom";
  current.site.campaigns[0].custom = {
    code: "export function render(context) { context.reportShown(); }",
    variables: {},
  };
  await f.administration.repo.run(
    "UPDATE admin_sites SET body=? WHERE id=?",
    JSON.stringify(current.site),
    "demo",
  );
  const campaign = structuredClone(current.site.campaigns[0]);
  campaign.presentation.type = "floating";
  delete campaign.custom;
  const saved = await f.dispatch(
    "/admin/api/v2/sites/demo/campaigns/guide/draft",
    "PUT",
    campaign,
    editor,
    { "If-Match": current.revision },
  );
  assert.equal(saved.statusCode, 403);
});
test("session idle and absolute expiration are enforced independently of browser cookie lifetime", async (t) => {
  const f = await managedFixture();
  t.after(() => f.app.close());
  const user = await f.addUser(),
    other = await f.addUser("member");
  await f.administration.repo.run(
    "UPDATE admin_sessions SET last_seen=? WHERE user_id=?",
    Date.now() - 1800001,
    user.id,
  );
  assert.equal(
    (await f.dispatch("/auth/session", "GET", undefined, user)).statusCode,
    401,
  );
  await f.administration.repo.run(
    "UPDATE admin_sessions SET expires_at=? WHERE user_id=?",
    Date.now() - 1,
    other.id,
  );
  assert.equal(
    (await f.dispatch("/auth/session", "GET", undefined, other)).statusCode,
    401,
  );
});
test("environment model and cost limits are inherited before cutover and managed after initialization", async (t) => {
  const { app, administration } = await buildManagedApp({
    databasePath: ":memory:",
    config: fixture(),
    origin,
    secret,
    bootstrapToken: bootstrap,
    defaults: {
      model: "legacy-model",
      dailyRequestBudget: 17,
      maxConcurrent: 2,
    },
    jev: async () => {
      throw Error("not needed");
    },
  });
  t.after(() => app.close());
  const first = await administration.runtimeSettings();
  assert.equal(first.dailyRequestBudget, 17);
  assert.equal(first.model, "legacy-model");
  await administration.repo.run(
    "UPDATE admin_settings SET initialized=1,body=?",
    JSON.stringify({
      name: "Workspace",
      model: "managed-model",
      dailyRequestBudget: 7,
      maxConcurrent: 1,
    }),
  );
  const next = await administration.runtimeSettings();
  assert.equal(next.model, "managed-model");
  assert.equal(next.dailyRequestBudget, 7);
});
