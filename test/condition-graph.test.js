import test from "node:test";
import assert from "node:assert/strict";
import {
  conditionGraphSchema,
  draftConditionGraphSchema,
  graphFromCampaign,
  graphQuestions,
  evaluateGraph,
  graphIssues,
  graphTest,
} from "../src/condition-graph.js";
import { prepare, select } from "../src/engine.js";
import { fixture, input } from "./helpers.js";
import { guidedQuestions } from "../src/questions.js";
import { mixedGraph } from "./graph-fixtures.js";

const context = (cid = "runner") => ({
  protocolVersion: 2,
  siteId: "demo",
  currentPage: {
    path: "/guides/a",
    name: "Guide",
    url: "https://www.example.com/guides/a",
  },
  entryPage: {
    path: "/guides/a",
    name: "Guide",
    url: "https://www.example.com/guides/a?cid=" + cid,
  },
  visits: [],
  actions: [],
  facts: {},
  delivery: {},
});
test("graph short circuits mixed AND/OR, deduplicates shared questions and preserves unknown values", () => {
  const graph = conditionGraphSchema.parse(mixedGraph()),
    ctx = context();
  assert.deepEqual(evaluateGraph(graph, ctx).needed, ["comparison"]);
  assert.equal(evaluateGraph(graph, ctx, { comparison: 0.9 }).value, true);
  assert.equal(evaluateGraph(graph, ctx, { comparison: 0.7 }).value, false);
  assert.equal(evaluateGraph(graph, ctx, { comparison: null }).value, null);
  assert.deepEqual(
    new Set(evaluateGraph(graph, context("walker")).needed),
    new Set(["interest", "comparison"]),
  );
  assert.equal(
    evaluateGraph(graph, context("walker"), { interest: 0.4, comparison: 0.99 })
      .value,
    false,
  );
  graph.edges.push({ id: "f", from: "interest", to: "and" });
  assert.equal(
    evaluateGraph(graph, ctx).needed.filter((id) => id === "interest").length,
    1,
  );
  assert.equal(
    evaluateGraph(graph, ctx, { interest: 0.9, comparison: 0.9 }).value,
    true,
  );
});
test("graph rejects cycles, unknown edges, duplicate keys, orphan and partial groups, while drafts preserve incomplete fields", () => {
  for (const mutate of [
    (g) => g.edges.push({ id: "cycle", from: "and", to: "or" }),
    (g) => g.edges.push({ id: "bad", from: "none", to: "result" }),
    (g) => g.nodes.push({ ...g.nodes[1], id: "duplicate" }),
    (g) => g.nodes.push({ id: "orphan", kind: "and" }),
    (g) => (g.edges = g.edges.filter((e) => e.id !== "b")),
  ]) {
    const g = mixedGraph();
    mutate(g);
    assert.equal(conditionGraphSchema.safeParse(g).success, false);
  }
  const partial = {
    version: 1,
    offer: "",
    nodes: [
      { id: "jev", kind: "jev", format: "guided", key: "q", condition: "" },
      { id: "result", kind: "result" },
    ],
    edges: [],
    layout: {},
  };
  assert.equal(draftConditionGraphSchema.safeParse(partial).success, true);
  assert.equal(conditionGraphSchema.safeParse(partial).success, false);
  assert.ok(graphIssues(partial).length);
});
test("legacy migration preserves 1/2/5 question originals and keys, URL hard gates and AND/OR semantics", () => {
  for (const combination of ["all", "any"])
    for (const count of [1, 2, 5])
      for (const raw of [false, true]) {
        const c = structuredClone(fixture().sites[0].campaigns[0]);
        c.combination = combination;
        c.questions = raw
          ? Array.from({ length: count }, (_, i) => ({
              key: "q" + i,
              instructions: `独自の判断${i}ですか？`,
            }))
          : guidedQuestions({
              offer: "ご案内",
              conditions: Array.from({ length: count }, (_, i) => `関心${i}`),
              keys: Array.from({ length: count }, (_, i) => "q" + i),
              templateVersion: "legacy",
            });
        c.urlTargeting = {
          combination: "any",
          conditions: [
            {
              source: "entry",
              field: "query",
              key: "cid",
              operator: "contains",
              value: "runner",
            },
          ],
        };
        const g = conditionGraphSchema.parse(graphFromCampaign(c));
        assert.deepEqual(graphQuestions(g), c.questions);
        const answers = Object.fromEntries(
          g.nodes
            .filter((n) => n.kind === "jev")
            .map((n, i) => [n.id, i === 0 ? 0.9 : 0.1]),
        );
        assert.equal(
          evaluateGraph(g, context(), answers).value,
          combination === "any" || count === 1,
        );
        assert.equal(evaluateGraph(g, context("walker"), answers).value, false);
      }
});
test("engine only asks unresolved questions; exact URL-only graph matches need no model and lower candidates are dominated", () => {
  const site = fixture().sites[0],
    c = site.campaigns[0];
  c.conditionGraph = conditionGraphSchema.parse(mixedGraph());
  c.minimumHistory = 0;
  let p = prepare(site, context());
  assert.deepEqual(Object.keys(p.questions), ["c0q1"]);
  assert.equal(select(p, { answers: { c0q1: { noul: 0.9 } } }).id, c.id);
  assert.throws(() => select(p, { answers: {} }));
  const urlGraph = conditionGraphSchema.parse({
    version: 1,
    offer: "",
    nodes: [mixedGraph().nodes[0], { id: "result", kind: "result" }],
    edges: [{ id: "a", from: "url", to: "result" }],
    layout: {},
  });
  c.conditionGraph = urlGraph;
  site.campaigns.push({
    ...structuredClone(c),
    id: "lower",
    priority: c.priority - 1,
    conditionGraph: mixedGraph(),
  });
  p = prepare(site, context());
  assert.deepEqual(p.questions, {});
  assert.equal(p.candidates.length, 1);
  assert.equal(select(p, { answers: {} }).id, c.id);
});
test("test evaluator uses excluded URL values and rejects paths/origins outside the site without model calls", () => {
  const site = fixture().sites[0];
  site.excludedQueryKeys = ["cid"];
  const body = {
    graph: mixedGraph(),
    currentUrl: context().currentPage.url,
    entryUrl: context().entryPage.url,
    threshold: 0.7,
    probabilities: { interest: 0.9, comparison: 0.9 },
  };
  const r = graphTest(site, body);
  assert.equal(r.valid, true);
  assert.equal(r.input.entryPage.url.includes("cid="), false);
  assert.equal(r.requiredJev.length, 2);
  assert.throws(() =>
    graphTest(site, { ...body, currentUrl: "https://evil.example/guides/a" }),
  );
  assert.throws(() =>
    graphTest(site, { ...body, currentUrl: "https://www.example.com/account" }),
  );
});

test("debug trace reports each graph value and queried node while keeping unneeded Jev answers unknown", async () => {
  const { createDebugTrace, startModelTrace, finishModelTrace } =
    await import("../src/debug-trace.js");
  const site = fixture().sites[0];
  site.campaigns[0].conditionGraph = mixedGraph();
  site.campaigns[0].minimumHistory = 0;
  const ctx = context(),
    p = prepare(site, ctx),
    trace = createDebugTrace(site, ctx);
  startModelTrace(trace, p, "requested-test");
  finishModelTrace(
    trace,
    p,
    {
      model: "actual-test",
      answers: { c0q1: { noul: 0.9 } },
      usage: { input_tokens: 1 },
    },
    10,
  );
  assert.equal(trace.campaigns[0].graph.value, true);
  assert.equal(trace.campaigns[0].graph.values.url, true);
  assert.equal(trace.campaigns[0].graph.values.interest, null);
  assert.deepEqual(trace.campaigns[0].graph.queried, ["comparison"]);
  assert.equal(trace.campaigns[0].questions.length, 1);
  assert.equal(trace.model.actualModel, "actual-test");
});

test("missing offer is reported once and separately from a missing node condition", () => {
  const graph = (offer, condition) => ({
    version: 1,
    offer,
    nodes: [
      {
        id: "jev_1",
        kind: "jev",
        key: "q1",
        format: "raw",
        instructions: "原文の質問",
      },
      { id: "node11", kind: "jev", key: "q2", format: "guided", condition },
      { id: "node12", kind: "or" },
      { id: "result", kind: "result" },
    ],
    edges: [
      { id: "e1", from: "jev_1", to: "node12" },
      { id: "e2", from: "node11", to: "node12" },
      { id: "e3", from: "node12", to: "result" },
    ],
    layout: {},
  });
  assert.deepEqual(graphIssues(graph("", "関心がある")), [
    "「何を伝えたいですか？」を入力してください。",
  ]);
  assert.deepEqual(graphIssues(graph("特集を案内する", "")), [
    "node11：判定する関心・状態を入力してください。",
  ]);
  assert.deepEqual(graphIssues(graph("特集を案内する", "関心がある")), []);
});
