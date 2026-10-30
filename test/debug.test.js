import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  issueDebugSession,
  verifyDebugSession,
  DEBUG_TTL_MS,
  DEBUG_HEADER,
} from "../src/debug-auth.js";
import { buildApp } from "../src/server.js";
import { Store } from "../src/store.js";
import { fixture, input } from "./helpers.js";
const secret = "diagnostic-test-admin-".repeat(3),
  origin = "https://www.example.com";
async function setup(t) {
  const store = new Store(
    join(await mkdtemp(join(tmpdir(), "jev-debug-")), "config.json"),
  );
  await store.save(fixture());
  let calls = 0,
    sent;
  const app = await buildApp({
    store,
    adminToken: secret,
    jev: async (prepared) => {
      calls++;
      sent = { state: prepared.state, questions: prepared.questions };
      return {
        model: "actual-test-model",
        answers: { c0q0: { noul: 0.9 } },
        usage: { input_tokens: 17, output_tokens: 1, private: "never copy" },
      };
    },
  });
  t.after(() => app.close());
  const launch = await app.inject({
    method: "POST",
    url: "/admin/api/debug-session",
    headers: { authorization: `Bearer ${secret}` },
    payload: { siteId: "demo", url: origin + "/guides/a?secret=omit#omit" },
  });
  assert.equal(launch.statusCode, 200);
  return { app, session: launch.json(), calls: () => calls, sent: () => sent };
}
const request = (token, value = input()) => ({
  method: "POST",
  url: "/v1/decision?siteId=demo",
  headers: { origin, ...(token ? { [DEBUG_HEADER]: token } : {}) },
  payload: value,
});
test("signed debug capability rejects forgery, expiration, wrong site/origin/secret and strips URL data", async () => {
  const now = 1700000000000;
  const session = await issueDebugSession(
    secret,
    fixture().sites[0],
    origin + "/guides/a?private=x#private",
    now,
  );
  assert.equal(session.url, origin + "/guides/a");
  assert.ok(
    await verifyDebugSession(secret, session.token, "demo", origin, now),
  );
  for (const [key, token, site, host, time] of [
    [secret, session.token, "other", origin, now],
    [secret, session.token, "demo", "https://evil.example", now],
    [secret + "wrong", session.token, "demo", origin, now],
    [secret, session.token, "demo", origin, now + DEBUG_TTL_MS],
    [secret, "altered." + session.token.split(".")[1], "demo", origin, now],
    [secret, "malformed", "demo", origin, now],
  ])
    assert.equal(await verifyDebugSession(key, token, site, host, time), null);
  await assert.rejects(
    issueDebugSession(secret, fixture().sites[0], "https://evil.example/"),
  );
  await assert.rejects(
    issueDebugSession(
      secret,
      fixture().sites[0],
      "https://user:password@www.example.com/",
    ),
  );
});
test("Node diagnostic flow returns actual bounded model state and conditions only with scoped authorization", async (t) => {
  const { app, session, calls, sent } = await setup(t);
  const response = await app.inject(request(session.token));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const d = response.json().debug;
  assert.deepEqual(
    { state: d.model.state, questions: d.model.questions },
    sent(),
  );
  assert.equal(d.model.actualModel, "actual-test-model");
  assert.deepEqual(d.model.usage, { input_tokens: 17, output_tokens: 1 });
  assert.equal(d.campaigns[0].questions[0].probability, 0.9);
  assert.equal(d.campaigns[0].matched, true);
  assert.ok(d.campaigns[0].checks.every((c) => c.passed));
  assert.ok(!response.body.includes(secret));
  assert.ok(!response.body.includes(session.token));
  assert.equal((await app.inject(request())).json().debug, undefined);
  const count = calls();
  assert.equal(
    (await app.inject(request(session.token + "x"))).statusCode,
    401,
  );
  assert.equal(calls(), count);
  assert.equal(
    (
      await app.inject({
        url: "/admin/api/config",
        headers: { authorization: `Bearer ${session.token}` },
      })
    ).statusCode,
    401,
  );
});
test("insufficient observation explains skipped Jev and excluded/brief visits without extra calls", async (t) => {
  const { app, session, calls } = await setup(t);
  const value = input();
  value.visits[0].visibleMs = 1;
  value.visits.push({
    page: { path: "/private/secret", name: "Private" },
    visibleMs: 6000,
  });
  const response = (await app.inject(request(session.token, value))).json();
  assert.equal(response.reason, "insufficient_observation");
  assert.equal(response.debug.model.called, false);
  assert.equal(response.debug.observation.qualifiedVisits, 1);
  assert.deepEqual(
    response.debug.observation.visits.map((v) => v.reason),
    ["too_brief", "qualified", "excluded_page"],
  );
  assert.equal(calls(), 0);
});
test("debug issuance needs admin auth and allowlisted target; verification permits only matching origin", async (t) => {
  const { app, session } = await setup(t);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/admin/api/debug-session",
        payload: { siteId: "demo", url: origin },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/admin/api/debug-session",
        headers: { authorization: `Bearer ${secret}` },
        payload: { siteId: "demo", url: "https://evil.example/" },
      })
    ).statusCode,
    400,
  );
  const verify = await app.inject({
    url: "/v1/debug-session?siteId=demo",
    headers: { origin, [DEBUG_HEADER]: session.token },
  });
  assert.equal(verify.statusCode, 200);
  assert.equal(verify.json().expiresAt, session.expiresAt);
  assert.equal(
    (
      await app.inject({
        url: "/v1/debug-session?siteId=demo",
        headers: { origin },
      })
    ).statusCode,
    401,
  );
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/v1/decision?siteId=demo",
    headers: { origin },
  });
  assert.match(
    preflight.headers["access-control-allow-headers"],
    /X-JevSense-Debug/,
  );
});
