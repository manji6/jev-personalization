import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePageUrl, urlTargetingMatches } from "../src/page-url.js";
import { urlPolicyRevision } from "../src/context-policy.js";
import { prepare, select } from "../src/engine.js";
import { inputSchema, siteSchema } from "../src/schema.js";
import { buildManagedApp } from "../src/app.js";
import { fixture } from "./helpers.js";
const page = (url = "https://www.example.com/products/a?cid=mail_runner") => ({
  path: new URL(url).pathname,
  name: "Polo",
  url,
});
const targeting = () => ({
  combination: "all",
  conditions: [
    {
      source: "entry",
      field: "query",
      key: "cid",
      operator: "contains",
      value: "runner",
    },
  ],
});
const body = async (site) => ({
  siteId: site.id,
  protocolVersion: 2,
  currentPage: page(),
  entryPage: page(),
  visits: [],
  actions: [],
  facts: {},
  delivery: {},
  metadataRevision: "legacy",
  urlPolicyRevision: await urlPolicyRevision(site),
});
test("URL retains encoding/order and removes all matching decoded keys, credentials and fragments", () => {
  const raw =
    "https://user:password@www.example.com/products/a?cid=mail_runner&email=a%40example.com&email=b&%74oken=secret&cid=other&flag#private";
  assert.equal(
    sanitizePageUrl(raw, ["email", "token"]),
    "https://www.example.com/products/a?cid=mail_runner&cid=other&flag",
  );
  assert.equal(
    sanitizePageUrl(
      "https://www.example.com/?CID=Run%20ner&cid=a+b&empty=&flag",
      [],
    ),
    "https://www.example.com/?CID=Run%20ner&cid=a+b&empty=&flag",
  );
  assert.equal(
    sanitizePageUrl("https://www.example.com/?CID=A&cid=B", ["cid"]),
    "https://www.example.com/?CID=A",
  );
  for (const raw of [
    "javascript:alert(1)",
    "http://external.example/a",
    "not a URL",
    "https://www.example.com/?x=" + "a".repeat(4096),
  ])
    assert.equal(sanitizePageUrl(raw), undefined);
  assert.equal(
    sanitizePageUrl("http://localhost:3000/?cid=runner#x"),
    "http://localhost:3000/?cid=runner",
  );
});
test("site minimum of 0 past views is valid and judges from the first page", async () => {
  const site = fixture().sites[0],
    c = site.campaigns[0];
  site.minQualifiedVisits = 0;
  delete c.minimumHistory;
  assert.equal(siteSchema.safeParse(site).success, true);
  site.minQualifiedVisits = -1;
  assert.equal(siteSchema.safeParse(site).success, false);
  site.minQualifiedVisits = 0;
  const input = await body(site);
  assert.equal(input.visits.length, 0);
  assert.equal(prepare(site, input).reason, undefined);
  site.minQualifiedVisits = 1;
  assert.equal(prepare(site, input).reason, "insufficient_observation");
});
test("current/entry context and qualified past history stay separate; URL conditions do not require a model", async () => {
  const site = fixture().sites[0],
    c = site.campaigns[0];
  c.minimumHistory = 0;
  c.urlTargeting = targeting();
  c.decisionMode = "rules";
  c.questions = [];
  const input = await body(site),
    prepared = prepare(site, input);
  assert.equal(prepared.reason, undefined);
  assert.equal(prepared.state.current_page.url, input.currentPage.url);
  assert.equal(prepared.state.last_qualified_page, undefined);
  assert.deepEqual(prepared.questions, {});
  assert.equal(select(prepared, { answers: {} }).id, c.id);
  input.currentPage = page("https://www.example.com/guides/b");
  assert.equal(urlTargetingMatches(c.urlTargeting, input), true);
  input.entryPage = page("https://www.example.com/products/a?cid=walker");
  assert.equal(prepare(site, input).reason, "no_eligible_campaign");
  c.urlTargeting.conditions[0] = {
    source: "current",
    field: "url",
    key: "",
    operator: "prefix",
    value: "https://www.example.com/guides/",
  };
  assert.equal(prepare(site, input).reason, undefined);
  c.minimumHistory = 1;
  assert.equal(prepare(site, input).reason, "insufficient_observation");
  input.visits = [{ page: page(), visibleMs: 6000 }];
  assert.equal(prepare(site, input).state.last_qualified_page.name, "Polo");
});
test("schemas reject missing current context, invalid URLs, empty URL-only conditions and oversized exclusion lists", async () => {
  const site = fixture().sites[0],
    input = await body(site);
  assert.equal(inputSchema.safeParse(input).success, true);
  assert.equal(
    inputSchema.safeParse({ ...input, currentPage: undefined }).success,
    false,
  );
  assert.equal(
    inputSchema.safeParse({
      ...input,
      currentPage: {
        ...page(),
        url: "https://user:password@www.example.com/products/a",
      },
    }).success,
    false,
  );
  assert.equal(
    siteSchema.safeParse({
      ...site,
      excludedQueryKeys: Array(51).fill("email"),
    }).success,
    false,
  );
  assert.equal(
    siteSchema.safeParse({
      ...site,
      campaigns: [
        {
          ...site.campaigns[0],
          decisionMode: "rules",
          questions: [],
          urlTargeting: { combination: "all", conditions: [] },
        },
      ],
    }).success,
    false,
  );
});
test("Node API evaluates URL-only initial decisions without history or paid calls, and sanitizes every model URL", async (t) => {
  const config = fixture(),
    site = config.sites[0],
    c = site.campaigns[0];
  site.excludedQueryKeys = ["email", "token"];
  c.minimumHistory = 0;
  c.decisionMode = "rules";
  c.questions = [];
  c.urlTargeting = targeting();
  let sent,
    calls = 0;
  const f = await buildManagedApp({
    config,
    databasePath: ":memory:",
    origin: "https://admin.example.com",
    secret: "test-context-secret-".repeat(4),
    bootstrapToken: "test-bootstrap-".repeat(4),
    jev: async (p) => {
      calls++;
      sent = p;
      return { model: "mock", answers: { c0q0: { noul: 0.95 } } };
    },
  });
  t.after(() => f.app.close());
  const dispatch = (payload) =>
    f.app.inject({
      url: "/v1/decision?siteId=demo",
      method: "POST",
      headers: {
        Origin: "https://www.example.com",
        "Content-Type": "application/json",
      },
      payload,
    });
  const input = await body(site);
  input.currentPage = page(
    "https://www.example.com/products/a?cid=runner&email=PRIVATE&token=SECRET",
  );
  input.entryPage = input.currentPage;
  let r = await dispatch(input);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().reason, "deterministic_match");
  assert.equal(calls, 0);
  input.urlPolicyRevision = "0".repeat(32);
  r = await dispatch(input);
  assert.equal(r.json().reason, "url_policy_revision_changed");
  assert.equal(calls, 0);
  input.urlPolicyRevision = await urlPolicyRevision(site);
  input.currentPage = { ...page(), url: "https://evil.example/products/a" };
  assert.equal((await dispatch(input)).statusCode, 400);
  c.decisionMode = "model";
  c.questions = [
    { key: "interest", instructions: "現在ページの案内に関心がありますか？" },
  ];
  await f.db
    .prepare("UPDATE app_config SET body=? WHERE id=1")
    .bind(JSON.stringify(config))
    .run();
  input.currentPage = input.entryPage;
  r = await dispatch(input);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(sent).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(sent).includes("SECRET"), false);
  assert.equal(
    sent.state.current_page.url,
    "https://www.example.com/products/a?cid=runner",
  );
  assert.equal(
    sent.state.entry_page.url,
    "https://www.example.com/products/a?cid=runner",
  );
  assert.deepEqual(sent.state.browsing_history_oldest_first, []);
});

test("restoring a session removes newly excluded values everywhere and does not fabricate a later entry page", async () => {
  const { restoreState } = await import("../src/sdk.js");
  const site = fixture().sites[0];
  site.excludedQueryKeys = ["email"];
  const saved = {
    updated: Date.now(),
    visits: [
      {
        page: page("https://www.example.com/guides/a?cid=runner&email=PRIVATE"),
        visibleMs: 6000,
      },
    ],
    entryPage: page(
      "https://www.example.com/guides/a?cid=runner&email=PRIVATE",
    ),
    actions: [],
    facts: {},
    delivery: {},
  };
  const restored = restoreState(saved, site);
  assert.equal(JSON.stringify(restored).includes("PRIVATE"), false);
  assert.equal(
    restored.entryPage.url,
    "https://www.example.com/guides/a?cid=runner",
  );
  saved.entryPage = { path: "/guides/a", name: "URL too long" };
  assert.equal(restoreState(saved, site).entryPage.path, "/guides/a");
  assert.equal(restoreState(saved, site).entryPage.url, undefined);
  saved.visits[0].visibleMs = 100;
  assert.deepEqual(restoreState(saved, site).visits, []);
});
