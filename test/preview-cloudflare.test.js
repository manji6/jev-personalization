import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { issueDebugSession, DEBUG_HEADER } from "../src/debug-auth.js";
import { fixture } from "./helpers.js";
import { cloudflareFixture } from "./cloudflare-fixture.js";
const issuer = "https://preview-test.cloudflareaccess.com",
  aud = "a".repeat(64);
const bindings = {
  DEPLOYMENT_TIER: "preview",
  PREVIEW_ACCESS_DOMAIN: "preview-test.cloudflareaccess.com",
  PREVIEW_ACCESS_AUD: aud,
  PREVIEW_MODEL_MODE: "stub",
  RELEASE_SHA: "b".repeat(40),
};
test("workerd Preview is private, permits Access-bound initial setup and labels stub judgments without calling Jev", async (t) => {
  const { publicKey, privateKey } = await generateKeyPair("RS256"),
    jwk = { ...(await exportJWK(publicKey)), kid: "fixture" };
  const token = await new SignJWT({ email: "owner@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" })
    .setIssuer(issuer)
    .setAudience(aud)
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const f = await cloudflareFixture({
    passkey: true,
    bindings,
    jwks: { keys: [jwk] },
  });
  t.after(() => f.mf.dispose());
  const headers = { "Cf-Access-Jwt-Assertion": token };
  for (const path of [
    "/admin",
    "/control.js",
    "/sdk.js",
    "/demo",
    "/auth/status",
  ])
    assert.equal((await f.dispatch(path)).status, 403, path);
  const status = await f.dispatch("/auth/status", { headers });
  assert.equal(status.status, 200);
  const value = await status.json();
  assert.equal(value.setupEmail, "owner@example.com");
  assert.equal(value.setupMode, "access");
  assert.equal(value.deployment.tier, "preview");
  const options = await f.dispatch("/auth/setup/options", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Origin: "https://api.example.com",
    },
    body: JSON.stringify({ email: "other@example.com", displayName: "Other" }),
  });
  assert.equal(options.status, 403);
  const own = await f.dispatch("/auth/setup/options", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Origin: "https://api.example.com",
    },
    body: JSON.stringify({ email: "owner@example.com", displayName: "Owner" }),
  });
  assert.equal(own.status, 200);
  const page = await f.dispatch("/demo", { headers });
  assert.match(await page.text(), /data-preview-environment="true"/);
  const decision = await f.decision(undefined, headers);
  assert.equal(decision.status, 200);
  assert.equal((await decision.json()).model, "preview-stub");
  const uid = crypto.randomUUID();
  await f.db
    .prepare(
      "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) VALUES(?,?,?,'superuser','active',?)",
    )
    .bind(uid, "trace@example.com", "Trace", Date.now())
    .run();
  const debug = await issueDebugSession(
    "workerd-test-secret-".repeat(3),
    fixture().sites[0],
    "https://www.example.com/products/polo",
    Date.now(),
    { actor: uid, version: 1 },
  );
  const diagnostic = await f.decision(undefined, {
    ...headers,
    [DEBUG_HEADER]: debug.token,
  });
  assert.equal(diagnostic.status, 200);
  const report = await diagnostic.json();
  assert.equal(report.modelMode, "stub");
  assert.equal(report.debug.model.called, false);
  assert.equal(report.debug.model.mode, "stub");
  assert.equal(report.debug.campaigns[0].questions[0].probability, 0.95);
  assert.equal(f.calls(), 0);
});
test("Preview stays closed when Access issuer or audience is not configured", async (t) => {
  const f = await cloudflareFixture({
    passkey: true,
    bindings: { DEPLOYMENT_TIER: "preview" },
  });
  t.after(() => f.mf.dispose());
  assert.equal((await f.dispatch("/admin")).status, 403);
  const health = await f.dispatch("/health");
  assert.equal(health.status, 503);
  assert.equal((await health.json()).accessConfigured, false);
});

test("stub mode cannot be enabled by Preview flags alone on a Production Worker", async (t) => {
  const f = await cloudflareFixture({
    passkey: true,
    bindings: { PREVIEW_MODEL_MODE: "stub" },
  });
  t.after(() => f.mf.dispose());
  const response = await f.decision();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).model, "mock-jev");
  assert.equal(f.calls(), 1);
});
