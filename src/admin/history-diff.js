// 施策の版どうしの違いを、画面に出せる形にまとめる。ブラウザでもNodeでも動く純粋な関数だけを置く。
import { describeGraph, graphFromCampaign } from "../condition-graph.js";

export const KIND_LABELS = {
  draft: "下書き保存",
  publish: "本番へリリース",
  unpublish: "公開を停止",
  unpublish_save: "公開を停止して保存",
  restore: "下書きに復元",
};
const TYPES = {
  modal: "モーダル",
  floating: "フローティング",
  bar: "通知バー",
  custom: "独自JavaScript",
};
const GROUP_LABELS = {
  basic: "基本情報",
  condition: "条件",
  judgment: "判定の設定",
  content: "表示内容",
  custom: "独自JavaScript",
  delivery: "配信設定",
};
const GROUP_ORDER = [
  "basic",
  "condition",
  "judgment",
  "content",
  "custom",
  "delivery",
];
const NODE_KIND = {
  url: "URL条件",
  jev: "Jev条件",
  and: "AND",
  or: "OR",
  result: "表示対象の判定",
};

const strictness = (v) =>
  v === 0.6
    ? "広めに判定（0.60）"
    : v === 0.7
      ? "標準（0.70）"
      : v === 0.85
        ? "慎重に判定（0.85）"
        : `カスタム設定（${Number(v).toFixed(2)}）`;
const history = (v) =>
  v === undefined
    ? "サイト設定を使う"
    : v === 0
      ? "0件（1ページ目から判定）"
      : `${v}件以上（${v + 1}ページ目から判定）`;
const targetText = (t) =>
  !t || t.mode === "all"
    ? "すべての許可ページ"
    : `${t.mode === "exact" ? "完全一致" : "前方一致"}：${(t.paths || []).join("、") || "（なし）"}`;
const blank = (v) =>
  v === undefined || v === null || v === "" ? "（なし）" : String(v);

export function graphOf(campaign) {
  if (!campaign)
    return { version: 1, offer: "", nodes: [], edges: [], layout: {} };
  const g = campaign.conditionGraph
    ? structuredClone(campaign.conditionGraph)
    : graphFromCampaign(campaign, { draft: true });
  g.nodes ||= [];
  g.edges ||= [];
  g.layout ||= {};
  return g;
}
export function nodeText(n) {
  if (n.kind === "url")
    return `${n.source === "entry" ? "流入ページ" : "現在ページ"}の${n.field === "query" ? `「${n.key}」` : "URL"}が「${n.value}」${{ contains: "を含む", equals: "と等しい", prefix: "から始まる" }[n.operator] || ""}`;
  if (n.kind === "jev")
    return (n.format === "raw" ? n.instructions : n.condition) || "（未入力）";
  return (
    { and: "すべて満たす", or: "どれかを満たす", result: "最終結果" }[n.kind] ||
    NODE_KIND[n.kind] ||
    n.kind
  );
}
const nodeSignature = (n) =>
  JSON.stringify([
    n.kind,
    n.source,
    n.field,
    n.key,
    n.operator,
    n.value,
    n.format,
    n.condition,
    n.instructions,
  ]);

function offerOf(c, g) {
  return g.offer || c?.judgment?.offer || c?.intent || "";
}

// 条件グラフの差分。位置（layout）は比べない。
export function diffGraph(fromCampaign, toCampaign) {
  const a = graphOf(fromCampaign),
    b = graphOf(toCampaign);
  const an = new Map(a.nodes.map((n) => [n.id, n])),
    bn = new Map(b.nodes.map((n) => [n.id, n]));
  const nodes = [];
  for (const [id, n] of bn) {
    const old = an.get(id);
    nodes.push({
      id,
      kind: n.kind,
      status: !old
        ? "added"
        : nodeSignature(old) === nodeSignature(n)
          ? "same"
          : "changed",
      before: old,
      after: n,
    });
  }
  for (const [id, n] of an)
    if (!bn.has(id))
      nodes.push({
        id,
        kind: n.kind,
        status: "removed",
        before: n,
        after: undefined,
      });
  const edgeKey = (e) => `${e.from}>${e.to}`;
  const ae = new Map(a.edges.map((e) => [edgeKey(e), e])),
    be = new Map(b.edges.map((e) => [edgeKey(e), e]));
  const edges = [];
  for (const [k, e] of be)
    edges.push({
      from: e.from,
      to: e.to,
      status: ae.has(k) ? "same" : "added",
    });
  for (const [k, e] of ae)
    if (!be.has(k)) edges.push({ from: e.from, to: e.to, status: "removed" });
  const items = [];
  for (const n of nodes) {
    const label = NODE_KIND[n.kind] || n.kind;
    if (n.status === "added")
      items.push({
        type: "added",
        summary: `${label}を追加`,
        text: `${label} ${n.id}「${nodeText(n.after)}」を追加`,
      });
    else if (n.status === "removed")
      items.push({
        type: "removed",
        summary: `${label}を削除`,
        text: `${label} ${n.id}「${nodeText(n.before)}」を削除`,
      });
    else if (n.status === "changed")
      items.push({
        type: "changed",
        summary: `${label}を変更`,
        text: `${label} ${n.id}：「${nodeText(n.before)}」→「${nodeText(n.after)}」`,
      });
  }
  const addedEdges = edges.filter((e) => e.status === "added"),
    removedEdges = edges.filter((e) => e.status === "removed");
  return {
    nodes,
    edges,
    items,
    addedEdges,
    removedEdges,
    before: a,
    after: b,
    beforeText: a.nodes.length ? describeGraph(a) : "（条件なし）",
    afterText: b.nodes.length ? describeGraph(b) : "（条件なし）",
    count: items.length + addedEdges.length + removedEdges.length,
  };
}

// 行ごとの差分（旧→新）。
function row(label, before, after) {
  return before === after ? null : { label, before, after };
}
function lineDiff(before, after) {
  const a = (before || "").split("\n"),
    b = (after || "").split("\n");
  // 最長共通部分列で、変更のない行を揃える。
  const dp = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lines = [];
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) (lines.push({ type: "same", text: a[i++] }), j++);
    else if (dp[i + 1][j] >= dp[i][j + 1])
      lines.push({ type: "removed", text: a[i++] });
    else lines.push({ type: "added", text: b[j++] });
  }
  while (i < a.length) lines.push({ type: "removed", text: a[i++] });
  while (j < b.length) lines.push({ type: "added", text: b[j++] });
  // 変更行の前後3行だけを残し、ほかは折りたたむ。
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, k) => {
    if (l.type !== "same")
      for (let d = -3; d <= 3; d++)
        if (keep[k + d] !== undefined) keep[k + d] = true;
  });
  const out = [];
  let hidden = 0;
  lines.forEach((l, k) => {
    if (keep[k]) {
      if (hidden) (out.push({ type: "fold", count: hidden }), (hidden = 0));
      out.push(l);
    } else hidden++;
  });
  if (hidden) out.push({ type: "fold", count: hidden });
  return out;
}

// from（いまの内容、または1つ前の版）から to（選んだ版）への違い。
export function compareCampaigns(from, to) {
  const groups = Object.fromEntries(
    GROUP_ORDER.map((id) => [
      id,
      { id, label: GROUP_LABELS[id], rows: [], count: 0 },
    ]),
  );
  const push = (id, r) => {
    if (r) {
      groups[id].rows.push(r);
      groups[id].count++;
    }
  };
  const f = from || {},
    t = to || {};
  push("basic", row("施策名", blank(f.name), blank(t.name)));

  const graph = diffGraph(from, to);
  groups.condition.graph = graph;
  groups.condition.count = graph.count;
  if (graph.count)
    groups.condition.rows.push({
      label: "文章で見ると",
      before: graph.beforeText,
      after: graph.afterText,
    });

  push(
    "judgment",
    row(
      "何を伝えたいですか？",
      blank(offerOf(f, graph.before)),
      blank(offerOf(t, graph.after)),
    ),
  );
  push(
    "judgment",
    row(
      "対象者判定の厳しさ",
      f.threshold === undefined ? "（なし）" : strictness(f.threshold),
      t.threshold === undefined ? "（なし）" : strictness(t.threshold),
    ),
  );
  push(
    "judgment",
    row(
      "判定に必要な過去の有効閲覧数",
      history(f.minimumHistory),
      history(t.minimumHistory),
    ),
  );

  const fc = f.content || {},
    tc = t.content || {};
  push(
    "content",
    row(
      "表示形式",
      TYPES[f.presentation?.type] || "（なし）",
      TYPES[t.presentation?.type] || "（なし）",
    ),
  );
  push(
    "content",
    row(
      "画像のみ表示",
      f.presentation?.imageOnly ? "はい" : "いいえ",
      t.presentation?.imageOnly ? "はい" : "いいえ",
    ),
  );
  for (const [key, label] of [
    ["title", "表示タイトル"],
    ["body", "メッセージ"],
    ["linkLabel", "ボタンの文言"],
    ["url", "リンク先"],
    ["imageUrl", "画像"],
    ["imageAlt", "画像の代替テキスト"],
  ])
    push("content", row(label, blank(fc[key]), blank(tc[key])));

  const fcode = f.custom?.code,
    tcode = t.custom?.code;
  if ((fcode || "") !== (tcode || "")) {
    groups.custom.code = lineDiff(fcode, tcode);
    groups.custom.count++;
  }
  const fv = f.custom?.variables || {},
    tv = t.custom?.variables || {};
  for (const key of [
    ...new Set([...Object.keys(fv), ...Object.keys(tv)]),
  ].sort())
    push("custom", row(`変数 ${key}`, blank(fv[key]), blank(tv[key])));

  push(
    "delivery",
    row("表示するページ", targetText(f.target), targetText(t.target)),
  );
  push(
    "delivery",
    row(
      "表示回数の上限",
      f.maxShows === undefined ? "（なし）" : `${f.maxShows}回`,
      t.maxShows === undefined ? "（なし）" : `${t.maxShows}回`,
    ),
  );
  push("delivery", row("優先順位", blank(f.priority), blank(t.priority)));
  push(
    "delivery",
    row("除外する確定状態", f.excludeFact || "なし", t.excludeFact || "なし"),
  );

  const list = GROUP_ORDER.map((id) => groups[id]);
  return {
    groups: list,
    changed: list.filter((g) => g.count > 0),
    total: list.reduce((n, g) => n + g.count, 0),
  };
}

// 版の一覧に出す「何を変えたか」の一文。
export function summarizeChange(prev, version) {
  if (!prev) return "最初の版";
  const diff = compareCampaigns(prev, version);
  if (!diff.total) return "内容の変更なし";
  const parts = [];
  const condition = diff.groups.find((g) => g.id === "condition");
  if (condition.count) {
    const g = condition.graph;
    if (g.items.length === 1 && condition.count === 1)
      parts.push(g.items[0].summary);
    else if (!g.items.length) parts.push("条件の接続を変更");
    else parts.push(`条件を${condition.count}か所変更`);
  }
  for (const g of diff.changed) {
    if (g.id === "condition") continue;
    parts.push(
      g.rows.length === 1 && g.id !== "custom"
        ? `${g.rows[0].label}を変更`
        : `${g.label}を変更`,
    );
  }
  const shown = parts.slice(0, 2).join("、");
  return parts.length > 2 ? `${shown}ほか${parts.length - 2}件` : shown;
}

// 図に重ねて出すための配置。選んだ版の位置を使い、削除されたノードは元の位置に置く。
export function layoutGraphDiff(
  graphDiff,
  { width = 520, nodeW = 150, nodeH = 56 } = {},
) {
  const pos = new Map();
  let auto = 0;
  const place = (id, layouts) => {
    const p = layouts.find((l) => l && l[id]);
    if (p) return { x: p[id].x, y: p[id].y };
    const n = auto++;
    return { x: (n % 3) * 300, y: Math.floor(n / 3) * 220 };
  };
  for (const n of graphDiff.nodes)
    pos.set(
      n.id,
      place(
        n.id,
        n.status === "removed"
          ? [graphDiff.before.layout]
          : [graphDiff.after.layout, graphDiff.before.layout],
      ),
    );
  const xs = [...pos.values()].map((p) => p.x),
    ys = [...pos.values()].map((p) => p.y);
  const minX = Math.min(0, ...xs),
    minY = Math.min(0, ...ys),
    span = Math.max(0, ...xs) - minX;
  const scale = span ? Math.min(0.62, (width - nodeW - 20) / span) : 0.62;
  const placed = new Map();
  for (const [id, p] of pos)
    placed.set(id, {
      x: Math.round((p.x - minX) * scale) + 10,
      y: Math.round((p.y - minY) * scale) + 10,
    });
  // 版が違うと、別のノードが同じ位置にあることがある。重ならないように右へずらす。
  const order = [
    ...graphDiff.nodes.filter((n) => n.status !== "removed"),
    ...graphDiff.nodes.filter((n) => n.status === "removed"),
  ];
  const taken = [];
  for (const n of order) {
    let p = placed.get(n.id);
    for (
      let guard = 0;
      guard < 50 &&
      taken.some(
        (t) =>
          Math.abs(t.x - p.x) < nodeW + 8 && Math.abs(t.y - p.y) < nodeH + 8,
      );
      guard++
    )
      p = { x: p.x + nodeW + 16, y: p.y };
    placed.set(n.id, p);
    taken.push(p);
  }
  const maxX =
      Math.max(0, ...[...placed.values()].map((p) => p.x)) + nodeW + 10,
    maxY = Math.max(0, ...[...placed.values()].map((p) => p.y)) + nodeH + 10;
  return { positions: placed, width: maxX, height: maxY, nodeW, nodeH };
}
