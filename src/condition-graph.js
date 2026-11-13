import { pathAllowed } from "./path-policy.js";
import { z } from "zod";
import { guidedQuestions, restoreJudgment } from "./questions.js";
import { urlConditionMatches, sanitizePageUrl } from "./page-url.js";
const id = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
function makeSchema(draft) {
  const text = (max) =>
    draft ? z.string().max(max) : z.string().trim().min(1).max(max);
  const common = { id };
  const nodes = z.discriminatedUnion("kind", [
    z
      .object({
        ...common,
        kind: z.literal("url"),
        source: z.enum(["entry", "current"]),
        field: z.enum(["query", "url"]),
        key: z.string().max(100).default(""),
        operator: z.enum(["contains", "equals", "prefix"]),
        value: text(300),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("jev"),
        key: id,
        format: z.enum(["guided", "raw"]),
        condition: z.string().max(400).optional(),
        instructions: z.string().max(1000).optional(),
        templateVersion: z.enum(["current", "legacy"]).optional(),
      })
      .strict(),
    z.object({ ...common, kind: z.literal("and") }).strict(),
    z.object({ ...common, kind: z.literal("or") }).strict(),
    z.object({ id: z.literal("result"), kind: z.literal("result") }).strict(),
  ]);
  return z
    .object({
      version: z.literal(1).default(1),
      offer: z.string().max(400).default(""),
      nodes: z.array(nodes).min(1).max(20),
      edges: z.array(z.object({ id, from: id, to: id }).strict()).max(40),
      layout: z
        .record(
          id,
          z
            .object({
              x: z.number().finite().min(0).max(5000),
              y: z.number().finite().min(0).max(10000),
            })
            .strict(),
        )
        .default({}),
    })
    .strict()
    .superRefine((g, ctx) => {
      for (const message of graphIssues(g, { draft }))
        ctx.addIssue({ code: "custom", message });
    });
}
export function graphIssues(g, { draft = false } = {}) {
  const issues = [],
    byId = new Map(g.nodes.map((n) => [n.id, n]));
  if (byId.size !== g.nodes.length) issues.push("ノードIDが重複しています。");
  if (
    g.nodes.filter((n) => n.kind === "result").length !== 1 ||
    !byId.has("result")
  )
    issues.push("最終結果ノードが1つ必要です。");
  if (
    new Set(g.edges.map((e) => e.id)).size !== g.edges.length ||
    new Set(g.edges.map((e) => e.from + ":" + e.to)).size !== g.edges.length
  )
    issues.push("接続が重複しています。");
  const jev = g.nodes.filter((n) => n.kind === "jev"),
    urls = g.nodes.filter((n) => n.kind === "url");
  if (jev.length > 5) issues.push("Jevの判定は1施策5問までです。");
  if (urls.length > 5) issues.push("URL条件は1施策5つまでです。");
  if (new Set(jev.map((n) => n.key)).size !== jev.length)
    issues.push("質問IDが重複しています。");
  const incoming = new Map(g.nodes.map((n) => [n.id, []])),
    outgoing = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) {
      issues.push("接続先のノードがありません。");
      continue;
    }
    if (e.from === e.to) issues.push("同じノードには接続できません。");
    incoming.get(e.to).push(e.from);
    outgoing.get(e.from).push(e.to);
  }
  const colors = new Map();
  let cyclic = false;
  function visit(id) {
    if (colors.get(id) === 1) {
      cyclic = true;
      return;
    }
    if (colors.get(id) === 2) return;
    colors.set(id, 1);
    for (const next of outgoing.get(id) || []) visit(next);
    colors.set(id, 2);
  }
  for (const n of g.nodes) visit(n.id);
  if (cyclic) issues.push("循環する接続は作れません。");
  for (const n of g.nodes) {
    const ins = incoming.get(n.id),
      outs = outgoing.get(n.id);
    if (["url", "jev"].includes(n.kind) && ins.length)
      issues.push(`${n.id}：条件ノードに入力は接続できません。`);
    if (n.kind === "result" && (outs.length || ins.length > 1))
      issues.push("最終結果の入力は1本、出力は接続しません。");
    if (!draft) {
      if (n.kind === "result" && ins.length !== 1)
        issues.push("最終結果へ1本接続してください。");
      if (["and", "or"].includes(n.kind) && ins.length < 2)
        issues.push(`${n.id}：AND/ORには2つ以上の入力が必要です。`);
      if (
        n.kind === "url" &&
        (!n.value.trim() || (n.field === "query" && !n.key.trim()))
      )
        issues.push(`${n.id}：GETパラメータのキーを入力してください。`);
      if (n.kind === "jev") {
        if (n.format === "guided") {
          if (!g.offer.trim())
            issues.push("「何を伝えたいですか？」を入力してください。");
          if (!n.condition?.trim())
            issues.push(`${n.id}：判定する関心・状態を入力してください。`);
        }
        if (n.format === "raw" && !n.instructions?.trim())
          issues.push(`${n.id}：判定質問を入力してください。`);
      }
    }
  }
  const active = activeGraphNodes(g);
  if (!draft && active.size !== g.nodes.length)
    issues.push("未接続のノードがあります。結果へ接続するか削除してください。");
  for (const key of Object.keys(g.layout || {}))
    if (!byId.has(key)) issues.push("表示位置に不明なノードがあります。");
  return [...new Set(issues)];
}
export const conditionGraphSchema = makeSchema(false);
export const draftConditionGraphSchema = makeSchema(true);
export function activeGraphNodes(g) {
  const incoming = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) incoming.get(e.to)?.push(e.from);
  const active = new Set();
  function walk(id) {
    if (active.has(id) || !incoming.has(id)) return;
    active.add(id);
    for (const p of incoming.get(id)) walk(p);
  }
  walk("result");
  return active;
}
export function graphQuestions(g, { draft = false } = {}) {
  return g.nodes
    .filter((n) => n.kind === "jev")
    .map((n) => {
      if (n.format === "raw")
        return {
          key: n.key,
          instructions:
            n.instructions?.trim() ||
            (draft ? "下書き：質問を入力してください" : ""),
        };
      try {
        return guidedQuestions({
          offer: g.offer,
          conditions: [n.condition],
          keys: [n.key],
          ...(n.templateVersion ? { templateVersion: n.templateVersion } : {}),
        })[0];
      } catch (error) {
        if (!draft) throw error;
        return {
          key: n.key,
          instructions: "下書き：案内内容と条件を入力してください",
        };
      }
    });
}
export function evaluateGraph(g, input = {}, answers = {}) {
  const byId = new Map(g.nodes.map((n) => [n.id, n])),
    incoming = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) incoming.get(e.to)?.push(e.from);
  const values = {},
    neededBy = {},
    visiting = new Set();
  function run(id) {
    if (Object.hasOwn(values, id)) return values[id];
    if (visiting.has(id)) return null;
    visiting.add(id);
    const n = byId.get(id);
    let value = null,
      needed = [];
    if (n?.kind === "url") value = urlConditionMatches(n, input);
    else if (n?.kind === "jev") {
      const p = answers[id];
      value =
        typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1
          ? p > (input.threshold ?? 0.7)
          : null;
      if (value === null) needed = [id];
    } else if (n) {
      const ins = incoming.get(id) || [],
        children = ins.map(run);
      if (n.kind === "result") {
        value = ins.length === 1 ? children[0] : null;
        needed = ins.length === 1 ? neededBy[ins[0]] || [] : [];
      } else if (ins.length >= 2) {
        if (n.kind === "and" && children.includes(false)) value = false;
        else if (n.kind === "or" && children.includes(true)) value = true;
        else if (children.every((v) => v !== null)) value = n.kind === "and";
        else {
          value = null;
          needed = ins
            .filter((i) => values[i] === null)
            .flatMap((i) => neededBy[i] || []);
        }
      }
    }
    values[id] = value;
    neededBy[id] = [...new Set(needed)];
    visiting.delete(id);
    return value;
  }
  const value = run("result");
  for (const n of g.nodes) run(n.id);
  return {
    value,
    values,
    needed: neededBy.result || [],
    active: [...activeGraphNodes(g)],
  };
}
export function graphFromCampaign(c, { draft = false } = {}) {
  if (c.conditionGraph) return structuredClone(c.conditionGraph);
  const g = { version: 1, offer: "", nodes: [], edges: [], layout: {} };
  let counter = 0;
  const edge = (from, to) =>
    g.edges.push({ id: `edge_${++counter}`, from, to });
  const group = (ids, kind, name) => {
    if (ids.length === 1) return ids[0];
    if (!ids.length) return null;
    g.nodes.push({ id: name, kind });
    ids.forEach((id) => edge(id, name));
    return name;
  };
  let judgment =
      draft && c.judgment ? c.judgment : restoreJudgment(c.questions || []),
    model = null,
    url = null;
  if (c.decisionMode !== "rules") {
    const qs = judgment
      ? judgment.conditions.map((condition, i) => ({
          key: judgment.keys?.[i] ?? `condition_${i + 1}`,
          condition,
        }))
      : c.questions || [];
    if (judgment) g.offer = judgment.offer;
    const ids = qs.map((q, i) => {
      const id = `jev_${i + 1}`;
      g.nodes.push({
        id,
        kind: "jev",
        key: q.key,
        format: judgment ? "guided" : "raw",
        ...(judgment
          ? {
              condition: q.condition,
              ...(judgment.templateVersion
                ? { templateVersion: judgment.templateVersion }
                : {}),
            }
          : { instructions: q.instructions }),
      });
      return id;
    });
    if (!ids.length) {
      g.nodes.push({
        id: "jev_1",
        kind: "jev",
        key: "condition_1",
        format: "guided",
        condition: "",
      });
      ids.push("jev_1");
    }
    model = group(ids, c.combination === "any" ? "or" : "and", "model_group");
  }
  const urlIds = (c.urlTargeting?.conditions || []).map((r, i) => {
    const id = `url_${i + 1}`;
    g.nodes.push({ id, kind: "url", ...r });
    return id;
  });
  url = group(
    urlIds,
    c.urlTargeting?.combination === "any" ? "or" : "and",
    "url_group",
  );
  if (!url && !model) {
    g.nodes.push({
      id: "url_1",
      kind: "url",
      source: "entry",
      field: "query",
      key: "cid",
      operator: "contains",
      value: "",
    });
    url = "url_1";
  }
  const root = group([url, model].filter(Boolean), "and", "all_conditions");
  g.nodes.push({ id: "result", kind: "result" });
  edge(root, "result");
  return g;
}
export function graphTest(site, body) {
  const graph = draftConditionGraphSchema.parse(body.graph),
    issues = graphIssues(graph);
  const input = { threshold: body.threshold };
  for (const [key, value] of [
    ["currentPage", body.currentUrl],
    ["entryPage", body.entryUrl],
  ]) {
    const clean = sanitizePageUrl(value, site.excludedQueryKeys);
    if (!clean) throw Error("test_url_rejected");
    const url = new URL(clean);
    if (!site.origins.includes(url.origin) || !pathAllowed(url.pathname, site))
      throw Error("test_url_rejected");
    input[key] = { path: url.pathname, url: clean, name: "条件テスト" };
  }
  const ids = new Set(
    graph.nodes.filter((n) => n.kind === "jev").map((n) => n.id),
  );
  for (const key of Object.keys(body.probabilities))
    if (!ids.has(key)) throw Error("test_question_rejected");
  return {
    valid: !issues.length,
    issues,
    ...evaluateGraph(graph, input, body.probabilities),
    requiredJev: evaluateGraph(graph, input).needed,
    input,
    questions: graphQuestions(graph, { draft: true }),
  };
}

export function autoLayoutGraph(g) {
  const ranks = new Map(),
    incoming = new Map(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) incoming.get(e.to)?.push(e.from);
  function rank(id, seen = new Set()) {
    if (ranks.has(id)) return ranks.get(id);
    if (seen.has(id)) return 0;
    seen = new Set(seen);
    seen.add(id);
    const ins = incoming.get(id) || [];
    const value = ins.length
      ? Math.max(...ins.map((i) => rank(i, seen))) + 1
      : 0;
    ranks.set(id, value);
    return value;
  }
  g.nodes.forEach((n) => rank(n.id));
  const layout = {};
  let y = 45;
  for (let r = 0; r <= Math.max(...ranks.values()); r++) {
    const nodes = g.nodes.filter((n) => ranks.get(n.id) === r),
      cols = Math.min(3, nodes.length);
    nodes.forEach(
      (n, i) =>
        (layout[n.id] = {
          x: Math.max(15, (1020 - cols * 285) / 2) + (i % 3) * 285,
          y: y + Math.floor(i / 3) * 220,
        }),
    );
    y += Math.max(1, Math.ceil(nodes.length / 3)) * 220 + 30;
  }
  return layout;
}

export function describeGraph(g) {
  const nodes = new Map(g.nodes.map((n) => [n.id, n])),
    memo = new Map();
  function describe(id, seen = new Set()) {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return "循環した接続";
    const n = nodes.get(id);
    if (!n) return "未接続";
    seen = new Set(seen);
    seen.add(id);
    let value;
    if (n.kind === "url")
      value = `${n.source === "entry" ? "流入ページ" : "現在ページ"}の${n.field === "query" ? `「${n.key}」` : "URL"}が「${n.value}」${{ contains: "を含む", equals: "と等しい", prefix: "から始まる" }[n.operator]}`;
    else if (n.kind === "jev")
      value = `Jevが「${(n.format === "raw" ? n.instructions : n.condition) || "未入力"}」と判定`;
    else {
      const ins = g.edges.filter((e) => e.to === id).map((e) => e.from);
      value =
        n.kind === "result"
          ? ins.length
            ? describe(ins[0], seen)
            : "最終結果へ接続してください"
          : `（${ins.map((i) => describe(i, seen)).join(n.kind === "and" ? " かつ " : " または ")}）`;
    }
    if (value.length > 4000) value = value.slice(0, 3999) + "…";
    memo.set(id, value);
    return value;
  }
  return describe("result");
}
