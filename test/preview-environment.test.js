import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { previewIdentity } from "../src/cloudflare/preview.js";
import {
  previewPlan,
  releasePlan,
  productionHash,
} from "../scripts/preview-plan.js";
const config = JSON.parse(await readFile("wrangler.json", "utf8")),
  migration = JSON.parse(
    await readFile("wrangler.preview-migrations.json", "utf8"),
  );
const issuer = "https://preview-test.cloudflareaccess.com",
  aud = "a".repeat(64),
  env = {
    DEPLOYMENT_TIER: "preview",
    PREVIEW_ACCESS_DOMAIN: "preview-test.cloudflareaccess.com",
    PREVIEW_ACCESS_AUD: aud,
  };
test("Preview resource validation rejects production DB, mismatched migrations and shared quotas", () => {
  const plan = previewPlan(config, migration, { allowLocked: true });
  assert.notEqual(plan.databaseId, config.d1_databases[0].database_id);
  const shared = structuredClone(config);
  shared.previews.d1_databases[0].database_id =
    shared.d1_databases[0].database_id;
  assert.throws(() => previewPlan(shared, migration), /separate D1/);
  const bad = structuredClone(migration);
  bad.d1_databases[0].database_id = "wrong";
  assert.throws(() => previewPlan(config, bad), /does not match/);
  const quotas = structuredClone(config);
  quotas.previews.ratelimits[0].namespace_id =
    config.ratelimits[0].namespace_id;
  assert.throws(
    () => previewPlan(quotas, migration, { allowLocked: true }),
    /isolated/,
  );
});
test("Production release requires exactly the clean commit and configuration that were previewed", () => {
  const commit = "b".repeat(40),
    receipt = {
      commit,
      deploymentId: "deployment",
      productionConfigHash: productionHash(config),
    };
  assert.equal(
    releasePlan({
      head: commit,
      reviewedCommit: commit,
      dirty: false,
      receipt,
      config,
    }).commit,
    commit,
  );
  for (const extra of [
    { reviewedCommit: undefined },
    { dirty: true },
    { receipt: { ...receipt, dirty: true } },
    { head: "c".repeat(40) },
    { receipt: { ...receipt, commit: "c".repeat(40) } },
    { receipt: { ...receipt, productionConfigHash: "bad" } },
  ])
    assert.throws(() =>
      releasePlan({
        head: commit,
        reviewedCommit: commit,
        dirty: false,
        receipt,
        config,
        ...extra,
      }),
    );
});
test("Preview access validates signatures, expiration, audience and issuer; missing settings and forged headers fail closed", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256"),
    jwk = { ...(await exportJWK(publicKey)), kid: "test" };
  const keySet = createLocalJWKSet({ keys: [jwk] });
  const signed = async (overrides = {}) =>
    new SignJWT({ email: "owner@example.com", ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(overrides.iss || issuer)
      .setAudience(overrides.aud || aud)
      .setSubject("owner")
      .setIssuedAt()
      .setExpirationTime(overrides.exp || Math.floor(Date.now() / 1000) + 120)
      .sign(privateKey);
  const request = (token) =>
    new Request("https://preview.example.com/admin", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
  assert.equal(
    (await previewIdentity(request(await signed()), env, { keySet })).email,
    "owner@example.com",
  );
  for (const token of [
    "not-a-jwt",
    await signed({ aud: "wrong" }),
    await signed({ iss: "https://evil.example" }),
    await signed({ exp: 1 }),
  ])
    assert.equal(await previewIdentity(request(token), env, { keySet }), null);
  assert.equal(
    await previewIdentity(
      request(await signed()),
      { DEPLOYMENT_TIER: "preview" },
      { keySet },
    ),
    null,
  );
});
