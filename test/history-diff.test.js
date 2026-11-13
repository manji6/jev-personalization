import test from "node:test";
import assert from "node:assert/strict";
import {
  compareCampaigns,
  summarizeChange,
  diffGraph,
  layoutGraphDiff,
} from "../src/admin/history-diff.js";

const graph = (nodes, edges, layout = {}) => ({
  version: 1,
  offer: "ブーツの特集を案内する",
  nodes,
  edges: edges.map(([from, to], i) => ({ id: `e${i}`, from, to })),
  layout,
});
const jev = (id, condition) => ({
  id,
  kind: "jev",
  key: id,
  format: "guided",
  condition,
});
const url = (id, value) => ({
  id,
  kind: "url",
  source: "entry",
  field: "query",
  key: "cid",
  operator: "contains",
  value,
});
const campaign = (over = {}) => ({
  id: "boots",
  name: "秋のブーツ特集",
  enabled: false,
  threshold: 0.7,
  minimumHistory: 0,
  maxShows: 3,
  priority: 50,
  target: { mode: "prefix", paths: ["/ja/"] },
  presentation: { type: "modal", imageOnly: false },
  content: {
    title: "秋のブーツ特集",
    body: "",
    linkLabel: "",
    url: "https://example.com/",
  },
  conditionGraph: graph(
    [jev("jev_1", "ブーツに関心がある人"), { id: "result", kind: "result" }],
    [["jev_1", "result"]],
    { jev_1: { x: 100, y: 100 }, result: { x: 100, y: 400 } },
  ),
  ...over,
});

test("identical campaigns have no differences, whatever the enabled flag or node positions", () => {
  const a = campaign(),
    b = campaign({ enabled: true });
  b.conditionGraph.layout.jev_1 = { x: 900, y: 10 };
  const d = compareCampaigns(a, b);
  assert.equal(d.total, 0);
  assert.deepEqual(d.changed, []);
});

test("scalar differences are grouped with before and after values", () => {
  const a = campaign(),
    b = campaign({
      threshold: 0.85,
      minimumHistory: 2,
      priority: 80,
      content: { ...campaign().content, title: "足もとから秋支度" },
    });
  const d = compareCampaigns(a, b);
  const rows = Object.fromEntries(
    d.groups.flatMap((g) => g.rows.map((r) => [r.label, r])),
  );
  assert.equal(rows["対象者判定の厳しさ"].before, "標準（0.70）");
  assert.equal(rows["対象者判定の厳しさ"].after, "慎重に判定（0.85）");
  assert.equal(
    rows["判定に必要な過去の有効閲覧数"].after,
    "2件以上（3ページ目から判定）",
  );
  assert.equal(rows["表示タイトル"].after, "足もとから秋支度");
  assert.equal(rows["優先順位"].after, "80");
  assert.deepEqual(
    d.changed.map((g) => g.id),
    ["judgment", "content", "delivery"],
  );
  assert.equal(d.total, 4);
});

test("graph differences name added, removed and changed nodes and count connections", () => {
  const before = campaign({
    conditionGraph: graph(
      [
        url("url_1", "runner"),
        jev("jev_1", "ポロシャツに関心がある人"),
        { id: "or_1", kind: "or" },
        { id: "result", kind: "result" },
      ],
      [
        ["url_1", "or_1"],
        ["jev_1", "or_1"],
        ["or_1", "result"],
      ],
    ),
  });
  const after = campaign({
    conditionGraph: graph(
      [
        url("url_1", "walker"),
        jev("jev_2", "ブーツに関心がある人"),
        { id: "or_1", kind: "or" },
        { id: "result", kind: "result" },
      ],
      [
        ["url_1", "or_1"],
        ["jev_2", "or_1"],
        ["or_1", "result"],
      ],
    ),
  });
  const g = diffGraph(before, after);
  const status = Object.fromEntries(g.nodes.map((n) => [n.id, n.status]));
  assert.deepEqual(status, {
    url_1: "changed",
    jev_2: "added",
    or_1: "same",
    result: "same",
    jev_1: "removed",
  });
  assert.equal(g.addedEdges.length, 1);
  assert.equal(g.removedEdges.length, 1);
  assert.equal(g.count, 3 + 2);
  assert.match(g.beforeText, /ポロシャツ/);
  assert.match(g.afterText, /ブーツ/);
  const d = compareCampaigns(before, after);
  assert.equal(d.groups.find((x) => x.id === "condition").count, 5);
});

test("legacy campaigns without a graph are compared through their converted graph", () => {
  const legacy = (urlValue) => ({
    ...campaign(),
    conditionGraph: undefined,
    decisionMode: "rules",
    questions: [],
    urlTargeting: {
      combination: "all",
      conditions: [
        {
          source: "entry",
          field: "query",
          key: "cid",
          operator: "contains",
          value: urlValue,
        },
      ],
    },
  });
  const d = compareCampaigns(legacy("runner"), legacy("walker"));
  assert.equal(d.groups.find((g) => g.id === "condition").count, 1);
});

test("custom JavaScript differences show changed lines with context and fold the rest", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const a = campaign({
    custom: { code: lines.join("\n"), variables: { accent: "#224f3d" } },
  });
  const changed = [...lines];
  changed[20] = "line 20 changed";
  const b = campaign({
    custom: { code: changed.join("\n"), variables: { accent: "#7a3f1d" } },
  });
  const d = compareCampaigns(a, b);
  const custom = d.groups.find((g) => g.id === "custom");
  assert.equal(custom.count, 2);
  assert.equal(custom.rows[0].label, "変数 accent");
  const types = custom.code.map((l) => l.type);
  assert.equal(types.filter((t) => t === "removed").length, 1);
  assert.equal(types.filter((t) => t === "added").length, 1);
  assert.equal(types.filter((t) => t === "fold").length, 2);
  assert.ok(custom.code.length < 15, "unchanged lines are folded");
});

test("version summaries say what changed in one short sentence", () => {
  const a = campaign();
  assert.equal(summarizeChange(null, a), "最初の版");
  assert.equal(
    summarizeChange(a, campaign({ enabled: true })),
    "内容の変更なし",
  );
  assert.equal(
    summarizeChange(
      a,
      campaign({ content: { ...a.content, title: "新しいタイトル" } }),
    ),
    "表示タイトルを変更",
  );
  const withNode = campaign({
    conditionGraph: graph(
      [
        jev("jev_1", "ブーツに関心がある人"),
        jev("jev_2", "購入を比較している人"),
        { id: "and_1", kind: "and" },
        { id: "result", kind: "result" },
      ],
      [
        ["jev_1", "and_1"],
        ["jev_2", "and_1"],
        ["and_1", "result"],
      ],
    ),
    priority: 80,
    maxShows: 1,
    content: { ...a.content, title: "新しいタイトル" },
  });
  const text = summarizeChange(a, withNode);
  assert.match(text, /条件を\d+か所変更/);
  assert.match(text, /ほか1件/);
});

test("graph overlay layout places removed nodes at their old position and fits the width", () => {
  const before = campaign({
    conditionGraph: graph(
      [jev("jev_1", "古い条件"), { id: "result", kind: "result" }],
      [["jev_1", "result"]],
      { jev_1: { x: 1200, y: 100 }, result: { x: 600, y: 400 } },
    ),
  });
  const after = campaign({
    conditionGraph: graph(
      [jev("jev_2", "新しい条件"), { id: "result", kind: "result" }],
      [["jev_2", "result"]],
      { jev_2: { x: 100, y: 100 }, result: { x: 600, y: 400 } },
    ),
  });
  const layout = layoutGraphDiff(diffGraph(before, after), { width: 640 });
  assert.ok(layout.positions.get("jev_1").x > layout.positions.get("jev_2").x);
  assert.ok(layout.width <= 640 + 1);
  for (const p of layout.positions.values()) assert.ok(p.x >= 0 && p.y >= 0);
});

test("overlay layout moves nodes that share a position across versions apart", () => {
  const before = campaign({
    conditionGraph: graph(
      [jev("jev_old", "古い条件"), { id: "result", kind: "result" }],
      [["jev_old", "result"]],
      { jev_old: { x: 340, y: 40 }, result: { x: 340, y: 400 } },
    ),
  });
  const after = campaign({
    conditionGraph: graph(
      [jev("jev_new", "新しい条件"), { id: "result", kind: "result" }],
      [["jev_new", "result"]],
      { jev_new: { x: 340, y: 40 }, result: { x: 340, y: 400 } },
    ),
  });
  const layout = layoutGraphDiff(diffGraph(before, after));
  const a = layout.positions.get("jev_old"),
    b = layout.positions.get("jev_new");
  assert.ok(
    Math.abs(a.x - b.x) >= layout.nodeW || Math.abs(a.y - b.y) >= layout.nodeH,
    "boxes do not overlap",
  );
  assert.ok(layout.width >= Math.max(a.x, b.x) + layout.nodeW);
});
