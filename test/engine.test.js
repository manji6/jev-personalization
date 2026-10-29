import { test } from "node:test";
import assert from "node:assert/strict";
import { prepare, select, pathAllowed, draftIntent } from "../src/engine.js";
import { fixture, input } from "./helpers.js";
import { inputSchema, configSchema } from "../src/schema.js";
test("short visits withheld without changing raw data", () => {
  const s = fixture().sites[0],
    i = input();
  i.visits[0].visibleMs = 2;
  assert.equal(prepare(s, i).reason, "insufficient_observation");
  assert.equal(i.visits.length, 2);
});
test("exact gate, allowed facts and actions, unknown exclusion fails closed", () => {
  const s = fixture().sites[0],
    i = input();
  i.actions = [{ name: "secret", value: "private" }];
  i.facts = { secret: true };
  s.campaigns[0].excludeFact = "registered";
  assert.equal(prepare(s, i).reason, "no_eligible_campaign");
  i.facts.registered = false;
  const p = prepare(s, i);
  assert.deepEqual(p.state.actions, []);
  assert.deepEqual(p.state.facts, { registered: false });
  i.delivery.guide = { shown: 1, dismissed: false };
  assert.equal(prepare(s, i).reason, "no_eligible_campaign");
});
test("priority, all/any, threshold equality, and invalid probability", () => {
  const s = fixture().sites[0];
  const c = structuredClone(s.campaigns[0]);
  c.id = "second";
  c.priority = 20;
  s.campaigns.push(c);
  const p = prepare(s, input());
  assert.equal(
    select(p, { answers: { c0q0: { noul: 0.8 }, c1q0: { noul: 0.9 } } }).id,
    "second",
  );
  assert.equal(
    select(p, { answers: { c0q0: { noul: 0.7 }, c1q0: { noul: 0.5 } } }),
    null,
  );
  assert.throws(() => select(p, { answers: { c0q0: { noul: NaN } } }));
  s.campaigns = [c];
  c.questions.push({ key: "other", instructions: "Other?" });
  c.combination = "any";
  assert.equal(
    select(prepare(s, input()), {
      answers: { c0q0: { noul: 0.1 }, c0q1: { noul: 0.9 } },
    }).id,
    "second",
  );
  c.combination = "all";
  assert.equal(
    select(prepare(s, input()), {
      answers: { c0q0: { noul: 0.1 }, c0q1: { noul: 0.9 } },
    }),
    null,
  );
});
test("excluded and encoded paths cannot reach model", () => {
  const s = fixture().sites[0];
  s.excludedPathPrefixes.push("/products/private");
  for (const p of [
    "/products/private/x",
    "/products/%70rivate/x",
    "/products/../account",
    "/products/%3Fmail",
  ])
    assert.equal(pathAllowed(p, s), false);
  const i = input();
  i.visits.at(-1).page.path = "/account";
  assert.equal(prepare(s, i).reason, "insufficient_observation");
});
test("schemas reject unbounded/unknown input and insecure content", () => {
  const i = input();
  i.visitorId = "forbidden";
  assert.equal(inputSchema.safeParse(i).success, false);
  delete i.visitorId;
  i.visits[0].page.path = "/a?email=x";
  assert.equal(inputSchema.safeParse(i).success, false);
  const c = fixture();
  c.sites[0].campaigns[0].content.url = "javascript:alert(1)";
  assert.equal(configSchema.safeParse(c).success, false);
});
test("natural language draft requires human review", () =>
  assert.equal(draftIntent("AまたはBの人", "A").requiresReview, true));
test("brief current page cannot re-enter model state through current_page", () => {
  const s = fixture().sites[0],
    i = input();
  i.visits.push({
    page: { path: "/products/private-interest", name: "Do not send" },
    visibleMs: 1,
  });
  const p = prepare(s, i);
  assert.ok(!JSON.stringify(p.state).includes("Do not send"));
  assert.equal(p.state.last_qualified_page.name, "導入事例");
});
