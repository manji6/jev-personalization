import { CSS, HTML } from "./condition-builder-assets.js";
import {
  graphFromCampaign,
  describeGraph,
  graphIssues,
  graphQuestions,
  evaluateGraph,
  activeGraphNodes,
  autoLayoutGraph,
  draftConditionGraphSchema,
} from "../condition-graph.js";
import { nextQuestionKey } from "../questions.js";
import { sanitizePageUrl } from "../page-url.js";
export function mountConditionBuilder(host, ctx) {
  const root = host.shadowRoot || host.attachShadow({ mode: "open" }),
    win = host.ownerDocument.defaultView,
    readOnly = ctx.disabled;
  // Parse outside the campaign form: fragment parsing in its context drops nested forms.
  const template = host.ownerDocument.createElement("template");
  template.innerHTML = HTML;
  root.replaceChildren(template.content.cloneNode(true));
  if (win.CSSStyleSheet && "adoptedStyleSheets" in root) {
    const style = new win.CSSStyleSheet();
    style.replaceSync(CSS);
    root.adoptedStyleSheets = [style];
  } else {
    const style = host.ownerDocument.createElement("style");
    style.textContent = CSS;
    root.prepend(style);
  }
  const controller = new AbortController(),
    on = (el, type, fn, options = {}) =>
      el.addEventListener(type, fn, { ...options, signal: controller.signal });
  let destroyed = false,
    snapshot,
    lastTest = null,
    lastFingerprint = "",
    testError = "",
    running = false;

  const $ = (id) => root.getElementById(id),
    esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  let nodes = [],
    edges = [],
    sequence = 0,
    selected = "url1",
    selectedEdge = null,
    tab = "edit",
    testing = false,
    zoom = 1,
    connecting = null,
    pointer = null,
    drag = null,
    history = [],
    scenario = 0,
    worldH = 1000;
  let worldW = 1020;
  const scenarios = [
    {
      name: "メールから流入",
      entry: "https://example.com/ja/?cid=mail_runner",
      current: "https://example.com/ja/products/polo",
      interest: 0.86,
      comparison: 0.79,
    },
    {
      name: "閲覧から判断",
      entry: "https://example.com/ja/",
      current: "https://example.com/ja/",
      interest: 0.86,
      comparison: 0.79,
    },
    {
      name: "対象外",
      entry: "https://example.com/ja/?cid=walker",
      current: "https://example.com/ja/news",
      interest: 0.18,
      comparison: 0.22,
    },
    {
      name: "情報不足",
      entry: "https://example.com/ja/",
      current: "https://example.com/ja/",
      interest: null,
      comparison: null,
    },
  ];
  let sample = { ...scenarios[0] },
    probabilities = {},
    modalDraft = null;
  const node = (id) => nodes.find((n) => n.id === id),
    size = (n) =>
      n.kind === "and" || n.kind === "or"
        ? { w: 205, h: 125 }
        : n.kind === "result"
          ? { w: 230, h: 145 }
          : { w: 240, h: 180 };
  const parents = (id) => edges.filter((e) => e.to === id).map((e) => e.from),
    children = (id) => edges.filter((e) => e.from === id).map((e) => e.to);
  const title = (n) =>
    ({
      url: "URL条件",
      jev: "Jev条件",
      and: "AND",
      or: "OR",
      result: "表示対象の判定",
    })[n.kind];
  function say(text) {
    $("message").textContent = text;
    clearTimeout(say.timer);
    say.timer = setTimeout(() => ($("message").textContent = ""), 4200);
  }
  function remember() {
    history.push(JSON.stringify({ nodes, edges, worldH }));
    if (history.length > 30) history.shift();
  }
  function setSample(i) {
    scenario = i;
    sample = { ...scenarios[i] };
    probabilities = Object.fromEntries(
      nodes
        .filter((n) => n.kind === "jev")
        .map((n) => [n.id, sample[n.sampleRole || "interest"]]),
    );
  }
  function initialize() {
    hideNodeMenu();
    clearTimeout(say.timer);
    $("message").textContent = "";
    history = [];
    selectedEdge = null;
    connecting = null;
    testing = false;
    tab = "edit";
    sequence = 10;
    loadGraph(graphFromCampaign(ctx.campaign(), { draft: ctx.isDraft() }));
    setSample(0);
    snapshot = JSON.stringify(readGraph());
    render();
    fit(false);
  }
  function activeNodes() {
    return activeGraphNodes(readGraph());
  }
  function validation() {
    return graphIssues(readGraph());
  }
  function urlText(n) {
    return `${n.source === "entry" ? "流入ページ" : "現在ページ"}の${n.field === "query" ? `「${n.key}」` : "URL"}が「${n.value}」${{ contains: "を含む", equals: "と等しい", prefix: "から始まる" }[n.operator]}`;
  }
  function urlMatch(n) {
    try {
      const u = new URL(sample[n.source === "entry" ? "entry" : "current"]),
        values = n.field === "query" ? u.searchParams.getAll(n.key) : [u.href];
      return values.some((v) =>
        n.operator === "equals"
          ? v === n.value
          : n.operator === "prefix"
            ? v.startsWith(n.value)
            : v.includes(n.value),
      );
    } catch {
      return null;
    }
  }
  function evaluate(id, after = false) {
    const g = readGraph();
    if (id === "result")
      return evaluateGraph(
        g,
        { ...testInput(), threshold: ctx.threshold() },
        after ? probabilities : {},
      );
    const partial = {
      ...g,
      nodes: g.nodes,
      edges: g.edges.filter((e) => e.to !== "result"),
    };
    partial.edges = [
      ...partial.edges,
      { id: "evaluation", from: id, to: "result" },
    ];
    return evaluateGraph(
      partial,
      { ...testInput(), threshold: ctx.threshold() },
      after ? probabilities : {},
    );
  }
  function outcome(value) {
    return value === null
      ? "情報不足・保留"
      : value
        ? "条件を満たす"
        : "条件を満たさない";
  }
  function stateOf(id) {
    if (!activeNodes().has(id)) return { class: "", label: "未接続" };
    if (!validTest())
      return {
        class: "",
        label: node(id).kind === "result" ? "テストで確認" : "条件を接続",
      };
    const r = lastTest.values[id];
    if (node(id).kind === "jev" && !lastTest.requiredJev.includes(id))
      return { class: "", label: "Jevへの質問不要" };
    return {
      class: r === null ? "unknown" : r ? "yes" : "no",
      label: outcome(r),
    };
  }
  function question(n) {
    return (
      graphQuestions(
        { offer: $("offer").value, nodes: [n] },
        { draft: true },
      )[0]?.instructions || ""
    );
  }
  function renderNodes() {
    const issues = validation();
    $("nodes").innerHTML = nodes
      .map((n) => {
        const s = stateOf(n.id),
          short =
            n.kind === "url"
              ? urlText(n)
              : n.kind === "jev"
                ? nodeText(n) || "関心・状態を入力してください"
                : n.kind === "and"
                  ? "すべて満たす"
                  : n.kind === "or"
                    ? "どれかを満たす"
                    : validTest()
                      ? issues.length
                        ? "接続を確認してください"
                        : lastTest.value === null
                          ? "情報不足・保留"
                          : lastTest.value
                            ? "表示対象の条件を満たす"
                            : "今回は対象外"
                      : "ここで最終結果を確認";
        return `<article class="node ${n.kind} ${selected === n.id ? "selected" : ""}" data-node="${n.id}"  aria-label="${title(n)} ${n.id}">${n.kind !== "url" && n.kind !== "jev" ? `<button class="port in" data-in="${n.id}" aria-label="入力 ${n.id}"></button>` : ""}<div class="node-head" data-drag="${n.id}"><span class="node-title">${title(n)}</span><span class="node-id">${n.id}</span></div><p class="node-copy">${esc(short)}</p><div class="node-meta"><span class="tag ${s.class}">${s.label}</span>${n.kind !== "result" ? `<div class="node-actions"><button class="tiny" data-edit="${n.id}" aria-label="${n.id}を編集">編集</button><button class="tiny delete-action" data-delete-node="${n.id}" aria-label="${n.id}を削除">削除</button></div>` : ""}</div>${n.kind !== "result" ? `<button class="port out ${connecting === n.id ? "connecting" : ""}" data-out="${n.id}" aria-label="出力 ${n.id}"></button>` : ""}</article>`;
      })
      .join("");
    for (const n of nodes) {
      const el = root.querySelector(`[data-node="${n.id}"]`);
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
    }
    drawEdges();
    updateSummary();
    $("undo").disabled = !history.length;
    $("removeSelected").disabled =
      !selectedEdge && (!selected || selected === "result");
    $("canvasHelp").textContent = connecting
      ? `出力「${connecting}」を接続中。AND・OR・最終結果の入力端子を選んでください。Escで取り消せます。`
      : "ノードの見出しで移動。出力→入力をドラッグ、または順にクリックして接続できます。";
    const detached = nodes.filter((n) => !activeNodes().has(n.id)).length;
    $("issues").hidden = !issues.length && !detached;
    $("issues").textContent = [
      ...issues,
      ...(detached
        ? [
            `未接続のノードが${detached}個あります。最終結果につながった条件だけを判定します。`,
          ]
        : []),
    ].join(" ");
    updateTestResult();
    applyReadOnly();
  }
  function point(id, out) {
    const n = node(id),
      s = size(n);
    return { x: n.x + s.w / 2, y: n.y + (out ? s.h : 0) };
  }
  function curve(a, b) {
    const distance = Math.max(60, Math.abs(b.y - a.y) * 0.55);
    return `M${a.x},${a.y} C${a.x},${a.y + distance} ${b.x},${b.y - distance} ${b.x},${b.y}`;
  }
  function drawEdges() {
    let html =
      '<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M1 1 L8 4.5 L1 8" fill="none" stroke="#8da796" stroke-width="1.5"/></marker></defs>';
    for (const e of edges) {
      const a = point(e.from, true),
        b = point(e.to, false),
        c =
          selectedEdge === e.id
            ? "selected"
            : testing
              ? stateOf(e.from).class
              : "";
      html += `<path class="wire ${c}" d="${curve(a, b)}" marker-end="url(#arrow)"/><path class="wire hit" d="${curve(a, b)}" data-edge="${e.id}" tabindex="0" role="button" aria-label="接続 ${e.from} から ${e.to}"/>`;
    }
    if (connecting && pointer)
      html += `<path class="wire ghost" d="${curve(point(connecting, true), pointer)}"/>`;
    $("wires").innerHTML = html;
  }
  function payload() {
    return readGraph();
  }
  function updateSummary() {
    $("readable").textContent = describeGraph(readGraph());
    $("json").textContent = JSON.stringify(readGraph(), null, 2);
    notify();
  }
  function choice(field, current, items) {
    return `<div class="choice" role="group">${Object.entries(items)
      .map(
        ([v, label]) =>
          `<button data-choice="${field}" data-value="${v}" aria-pressed="${current === v}">${label}</button>`,
      )
      .join("")}</div>`;
  }
  function editPanel(subject = node(selected)) {
    const n = subject;
    if (selectedEdge) {
      const e = edges.find((e) => e.id === selectedEdge);
      return `<h2>接続を選択中</h2><p>${esc(e?.from)} → ${esc(e?.to)}</p><button type="button" data-delete-edge="${selectedEdge}" ${readOnly ? "disabled" : ""}>この接続を削除</button>`;
    }
    if (!n)
      return '<h2>ノードを選んでください</h2><p class="hint">条件をクリックするとここで確認できます。</p>';
    let html = `<h2>${title(n)}を編集</h2><p class="hint">ノード ${n.id} ・変更はすぐ図へ反映されます。</p>`;
    if (n.kind === "url")
      html += `<label>対象のページ</label>${choice("source", n.source, { entry: "流入ページ", current: "現在ページ" })}<label>調べる値</label>${choice("field", n.field, { query: "GETパラメータ", url: "URL全体" })}${n.field === "query" ? `<label for="key">パラメータのキー</label><input id="key" data-property="key" maxlength="100" value="${esc(n.key)}">` : ""}<label>一致の方法</label>${choice("operator", n.operator, { contains: "含む", equals: "等しい", prefix: "前方一致" })}<label for="value">比較する値</label><input id="value" data-property="value" maxlength="300" value="${esc(n.value)}"><p class="note">除外したGETパラメータの値は判定に使いません。</p>`;
    else if (n.kind === "jev")
      html +=
        n.format === "raw"
          ? `<label for="instructions">判定質問（原文）</label><textarea id="instructions" data-property="instructions" maxlength="1000">${esc(n.instructions)}</textarea><p class="hint">この条件は、Jevへ送る質問の原文をそのまま保存した従来の形式です。新しく追加するJev条件は「どんな人に届けたいですか？」に「◯◯に興味がある人」のように書く形式で、質問は自動で組み立てられます。既存の原文と質問ID ${esc(n.key)}を保持します。共通の案内内容を変更しても、この原文は自動変更しません。</p>`
          : `<label for="condition">どんな人に届けたいですか？</label><textarea id="condition" data-property="condition" maxlength="400" placeholder="例：吸汗速乾ポロシャツに興味がある人">${esc(n.condition)}</textarea><p class="hint">このコンテンツを見せたい人は、どんな状態の人ですか？「◯◯に興味がある人」「◯◯について知りたそうな人」のように書きます。1つの判断だけを書き、AND/ORは接続で指定します。</p><details open><summary>Jevへ送る判定質問</summary><pre id="question">${esc(question(n))}</pre></details>`;
    else if (n.kind === "and" || n.kind === "or")
      html += `<label>組み合わせ</label>${choice("kind", n.kind, { and: "すべて満たす（AND）", or: "どれか満たす（OR）" })}<p>${parents(n.id).length}本の入力が接続されています。</p><p class="note">入力は2本以上。情報不足は不成立と区別します。</p>`;
    else
      html +=
        "<p>最終結果へ1本つなぎます。表示ページや回数の制約は別に適用します。</p>";
    return html;
  }
  function testPanel() {
    const active = activeNodes();
    return `<h2>この設定を試す</h2><p class="hint">本番と同じ条件評価ロジックを使います。Jevの判定値はサンプルで、有料APIは呼びません。</p><div class="scenarios">${scenarios.map((s, i) => `<button type="button" data-scenario="${i}" aria-pressed="${scenario === i}">${s.name}</button>`).join("")}</div><label for="sampleEntry">流入ページのURL</label><input id="sampleEntry" data-sample="entry" value="${esc(sample.entry)}"><label for="sampleCurrent">現在ページのURL</label><input id="sampleCurrent" data-sample="current" value="${esc(sample.current)}"><h3>Jevの判定値を試す</h3>${nodes
      .filter((n) => n.kind === "jev" && active.has(n.id))
      .map(
        (n) =>
          `<div class="field-pair"><label for="prob-${n.id}">${esc(nodeText(n) || n.id)}</label><input id="prob-${n.id}" data-prob="${n.id}" type="number" min="0" max="1" step="0.01" placeholder="不明" value="${probabilities[n.id] ?? ""}"></div>`,
      )
      .join(
        "",
      )}<p class="hint">空欄は情報不足。サイトの除外キーは送信前に適用します。</p><button type="button" id="testRun" class="primary" ${readOnly || running ? "disabled" : ""}>${running ? "テスト中…" : "テストを実行"}</button><div class="test-result"><strong id="testOutcome"></strong><p id="testWhy"></p><p class="hint" id="testCost"></p></div><p class="note">同意・履歴数・表示ページ・表示回数の制約や、実際の推論精度は動作確認で別に確認します。URL情報と結果をサーバーへ保存しません。</p>`;
  }
  function renderSide() {
    $("inspector").innerHTML = tab === "test" ? testPanel() : editPanel();
    root
      .querySelectorAll("[data-tab]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.tab === tab)),
      );
    updateTestResult();
  }
  function updateTestResult() {
    if (!$("testOutcome")) return;
    if (!validTest()) {
      $("testOutcome").textContent = running
        ? "テスト中…"
        : "テストを実行してください";
      $("testWhy").textContent =
        testError ||
        "条件や入力が変わった場合は、もう一度テストして確認します。";
      $("testCost").textContent = "";
      return;
    }
    const r = lastTest;
    $("testOutcome").textContent = !r.valid
      ? "接続・入力を確認してください"
      : r.value === null
        ? "情報不足のため保留"
        : r.value
          ? "表示対象の条件を満たします"
          : "今回は対象外";
    $("testWhy").textContent = r.issues.length
      ? r.issues.join(" ")
      : "ノードと線で条件ごとの結果を確認できます。配信制約は別に適用します。";
    $("testCost").textContent =
      `URLだけでは決まらないJev質問：${r.requiredJev.length}件（このテストでは送信しません）`;
  }
  function render() {
    updateWorld();
    renderNodes();
    renderSide();
    applyReadOnly();
  }
  function updateWorld() {
    $("world").style.width = worldW + "px";
    $("world").style.height = worldH + "px";
    $("world").style.transform = `scale(${zoom})`;
    $("stage").style.width = worldW * zoom + "px";
    $("stage").style.height = worldH * zoom + "px";
    $("zoomLabel").textContent = Math.round(zoom * 100) + "%";
  }
  function fit(all = true) {
    const v = $("viewport"),
      left = Math.min(...nodes.map((n) => n.x)),
      top = Math.min(...nodes.map((n) => n.y));
    const right = Math.max(...nodes.map((n) => n.x + size(n).w)),
      bottom = Math.max(...nodes.map((n) => n.y + size(n).h));
    zoom =
      win.innerWidth < 750 && !all
        ? 1
        : Math.max(
            0.25,
            Math.min(
              1,
              (v.clientWidth - 40) / (right - left),
              all ? (v.clientHeight - 40) / (bottom - top) : 1,
            ),
          );
    updateWorld();
    v.scrollLeft = Math.max(0, ((left + right) * zoom) / 2 - v.clientWidth / 2);
    v.scrollTop = Math.max(0, top * zoom - 20);
  }
  function reaches(from, to, seen = new Set()) {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return children(from).some((n) => reaches(n, to, seen));
  }
  function connect(from, to) {
    if (readOnly) return false;
    if (!node(from) || !node(to)) return false;
    if (from === to || reaches(to, from)) {
      say(
        "循環する接続は作れません。AND／ORから前の条件へ戻る線を確認してください。",
      );
      return false;
    }
    if (
      node(from).kind === "result" ||
      !["and", "or", "result"].includes(node(to).kind)
    ) {
      say("出力からAND・OR・最終結果の入力へ接続してください。");
      return false;
    }
    if (edges.some((e) => e.from === from && e.to === to)) {
      say("この接続はすでにあります。");
      return false;
    }
    if (to === "result" && parents("result").length) {
      say("最終結果の接続は1本です。既存の線を外してからつないでください。");
      return false;
    }
    remember();
    let id;
    do {
      id = "edge" + ++sequence;
    } while (edges.some((e) => e.id === id));
    edges.push({ id, from, to });
    connecting = null;
    pointer = null;
    render();
    say("接続しました。");
    return true;
  }
  function erase() {
    if (readOnly) return;
    hideNodeMenu();
    connecting = null;
    pointer = null;
    if (selectedEdge) {
      remember();
      edges = edges.filter((e) => e.id !== selectedEdge);
      selectedEdge = null;
      render();
      return;
    }
    if (selected && selected !== "result") {
      remember();
      nodes = nodes.filter((n) => n.id !== selected);
      edges = edges.filter((e) => e.from !== selected && e.to !== selected);
      selected = null;
      render();
    }
  }
  function add(kind) {
    if (readOnly) return;
    if (nodes.length >= 20) {
      say("20ノードまで作成できます。");
      return;
    }
    if (
      ["url", "jev"].includes(kind) &&
      nodes.filter((n) => n.kind === kind).length >= 5
    ) {
      say("URL条件・Jev条件はそれぞれ5つまでです。");
      return;
    }
    remember();
    let id;
    do {
      id = "node" + ++sequence;
    } while (node(id));
    let position;
    for (let row = 0; row < 25 && !position; row++)
      for (let col = 0; col < 3 && !position; col++) {
        const x = 35 + col * 285,
          y = 45 + row * 220,
          s = size({ kind });
        if (
          nodes.every((n) => {
            const b = size(n);
            return (
              x + s.w + 18 <= n.x ||
              n.x + b.w + 18 <= x ||
              y + s.h + 18 <= n.y ||
              n.y + b.h + 18 <= y
            );
          })
        )
          position = { x, y };
      }
    const base = { id, kind, ...(position || { x: 35, y: worldH }) };
    if (kind === "url")
      Object.assign(base, {
        source: "entry",
        field: "query",
        key: "cid",
        operator: "contains",
        value: "",
      });
    if (kind === "jev")
      Object.assign(base, {
        key: nextQuestionKey(
          nodes.filter((n) => n.kind === "jev").map((n) => n.key),
        ),
        format: "guided",
        condition: "",
      });
    nodes.push(base);
    worldH = Math.max(worldH, base.y + size(base).h + 70);
    probabilities[id] = null;
    selected = id;
    selectedEdge = null;
    tab = "edit";
    render();
    say("ノードを追加しました。編集して端子を接続してください。");
  }
  function arrange() {
    if (readOnly) return;
    remember();
    const layout = autoLayoutGraph(readGraph());
    for (const n of nodes) Object.assign(n, layout[n.id]);
    updateBounds();
    render();
    fit(false);
  }
  function worldPoint(event) {
    const rect = $("world").getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    };
  }
  on($("world"), "pointerdown", (event) => {
    if (event.button !== 0 || readOnly) return;
    const out = event.target.closest("[data-out]"),
      handle = event.target.closest("[data-drag]");
    if (out) {
      connecting = out.dataset.out;
      pointer = worldPoint(event);
      event.preventDefault();
      drawEdges();
      $("canvasHelp").textContent =
        "入力端子までドラッグ、または入力端子をクリックしてください。Escで取り消し。";
      return;
    }
    if (handle) {
      const n = node(handle.dataset.drag);
      drag = {
        id: n.id,
        start: worldPoint(event),
        x: n.x,
        y: n.y,
        remembered: false,
      };
      event.preventDefault();
    }
  });
  on(win, "pointermove", (event) => {
    if (drag) {
      const p = worldPoint(event),
        n = node(drag.id);
      if (
        !drag.remembered &&
        Math.abs(p.x - drag.start.x) + Math.abs(p.y - drag.start.y) > 2
      ) {
        remember();
        drag.remembered = true;
      }
      n.x = Math.max(
        14,
        Math.min(worldW - size(n).w - 14, drag.x + p.x - drag.start.x),
      );
      n.y = Math.max(
        20,
        Math.min(worldH - size(n).h - 20, drag.y + p.y - drag.start.y),
      );
      const el = root.querySelector(`[data-node="${n.id}"]`);
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      drawEdges();
    } else if (connecting) {
      pointer = worldPoint(event);
      drawEdges();
    }
  });
  on(win, "pointerup", (event) => {
    if (drag) {
      drag = null;
      updateSummary();
      $("undo").disabled = !history.length;
      return;
    }
    if (connecting) {
      const input = hitInput(event.clientX, event.clientY);
      if (input) connect(connecting, input.dataset.in);
    }
  });
  on(win, "pointercancel", () => (drag = null));
  on(root, "click", (event) => {
    event.stopPropagation();
    const b = event.target.closest("button"),
      d = b?.dataset ?? {};
    if (d.add) {
      add(d.add);
      return;
    }
    if (d.out) {
      connecting = d.out;
      pointer = null;
      renderNodes();
      say("次に、つなぐ先の入力端子を選んでください。");
      return;
    }
    if (d.in) {
      if (connecting) connect(connecting, d.in);
      else say("先に条件やAND／ORの出力端子を選んでください。");
      return;
    }
    if (d.edit) {
      openNodeEdit(d.edit);
      return;
    }
    if (d.deleteNode) {
      deleteNode(d.deleteNode);
      return;
    }
    if (d.choice) {
      if (readOnly) return;
      if (b.closest("#nodeEditDialog") && modalDraft) {
        modalDraft[d.choice] = d.value;
        renderModal();
        return;
      }
      const n = node(selected);
      remember();
      n[d.choice] = d.value;
      render();
      return;
    }
    if (d.tab) {
      tab = d.tab;
      render();
      return;
    }
    if (d.scenario !== undefined) {
      setSample(Number(d.scenario));
      render();
      return;
    }
    if (b?.id === "testRun") {
      void runTest();
      return;
    }
    if (d.test !== undefined) {
      void runTest();
      return;
    }
    if (d.deleteEdge) {
      selectedEdge = d.deleteEdge;
      erase();
      return;
    }
    const path = event.target.closest("[data-edge]");
    if (path) {
      connecting = null;
      pointer = null;
      selectedEdge = path.dataset.edge;
      selected = null;
      render();
      return;
    }
    const box = event.target.closest("[data-node]");
    if (box && !event.target.closest(".port")) {
      connecting = null;
      pointer = null;
      selected = box.dataset.node;
      selectedEdge = null;
      render();
      return;
    }
  });
  on($("inspector"), "input", (event) => {
    event.stopPropagation();
    const el = event.target;
    if (el.dataset.property) {
      if (readOnly) return;
      const n = node(selected);
      remember();
      n[el.dataset.property] = el.value;
      renderNodes();
      if ($("question")) $("question").textContent = question(n);
    }
    if (el.dataset.sample) {
      sample[el.dataset.sample] = el.value;
      scenario = -1;
      renderNodes();
    }
    if (el.dataset.prob) {
      scenario = -1;
      const p = el.value === "" ? null : Number(el.value);
      probabilities[el.dataset.prob] =
        p !== null && (!Number.isFinite(p) || p < 0 || p > 1) ? null : p;
      renderNodes();
    }
    if (el.dataset.sample || el.dataset.prob)
      root
        .querySelectorAll("[data-scenario]")
        .forEach((b) => b.setAttribute("aria-pressed", "false"));
  });
  $("offer").oninput = (event) => {
    event.stopPropagation();
    updateSummary();
    if ($("question")) $("question").textContent = question(node(selected));
  };
  $("trySettings").onclick = () => void runTest();
  $("removeSelected").onclick = erase;
  $("undo").onclick = () => {
    if (!history.length) return;
    const old = JSON.parse(history.pop());
    nodes = old.nodes;
    edges = old.edges;
    worldH = old.worldH ?? 1000;
    updateBounds();
    selected = null;
    selectedEdge = null;
    connecting = null;
    render();
  };
  $("arrange").onclick = arrange;
  $("reset").onclick = () => {
    fit(true);
  };
  $("zoomIn").onclick = () => {
    zoom = Math.min(1.5, zoom + 0.1);
    updateWorld();
  };
  $("zoomOut").onclick = () => {
    zoom = Math.max(0.25, zoom - 0.1);
    updateWorld();
  };
  $("fit").onclick = () => fit(true);
  on(root, "keydown", (event) => {
    if ($("nodeEditDialog").open || $("jsonEditor").open) return;
    if (!$("nodeMenu").hidden) {
      const buttons = [...$("nodeMenu").querySelectorAll("button")];
      if (event.key === "Escape") {
        event.preventDefault();
        hideNodeMenu();
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const current = buttons.indexOf(root.activeElement);
        buttons[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length
        ]?.focus();
        return;
      }
    }
    if (event.target.dataset?.edge && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      connecting = null;
      pointer = null;
      selectedEdge = event.target.dataset.edge;
      selected = null;
      render();
      return;
    }
    if (event.key === "Escape") {
      connecting = null;
      pointer = null;
      drawEdges();
      return;
    }
    if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      erase();
    }
  });

  function hideNodeMenu() {
    $("nodeMenu").hidden = true;
    $("nodeMenu").replaceChildren();
  }
  function deleteNode(id) {
    hideNodeMenu();
    if (!node(id)) return;
    if (id === "result") {
      say("最終結果は固定のノードです。");
      return;
    }
    selected = id;
    selectedEdge = null;
    erase();
    say("ノードと接続線を削除しました。「元に戻す」で戻せます。");
  }
  function renderModal() {
    if (!modalDraft) return;
    $("nodeEditHeading").textContent = title(modalDraft) + "を編集";
    let body = editPanel(modalDraft)
      .replace(/^<h2>.*?<\/h2>/, "")
      .replace(
        "変更はすぐ図へ反映されます。",
        "「変更を保存」で図へ反映します。",
      );
    body = body
      .replace(/<button /g, '<button type="button" ')
      .replace(/\bid="([^"]+)"/g, (_, id) => `id="modal-${id}"`)
      .replace(/\bfor="([^"]+)"/g, (_, id) => `for="modal-${id}"`);
    $("nodeEditFields").innerHTML = body;
    applyReadOnly();
  }
  function openNodeEdit(id) {
    const n = node(id);
    if (!n || n.kind === "result") return;
    hideNodeMenu();
    connecting = null;
    pointer = null;
    selected = id;
    selectedEdge = null;
    tab = "edit";
    render();
    modalDraft = structuredClone(n);
    $("nodeEditError").textContent = "";
    renderModal();
    $("nodeEditDialog").showModal();
    const first =
      $("nodeEditFields").querySelector("input,textarea") ||
      $("nodeEditFields").querySelector("button");
    first?.focus();
  }
  on($("nodeEditFields"), "input", (event) => {
    if (!modalDraft || !event.target.dataset.property) return;
    modalDraft[event.target.dataset.property] = event.target.value;
    $("nodeEditError").textContent = "";
    if ($("modal-question"))
      $("modal-question").textContent = question(modalDraft);
  });
  on($("nodeEditForm"), "submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!modalDraft) return;
    const d = modalDraft;
    if (
      d.kind === "url" &&
      (!d.value.trim() || (d.field === "query" && !d.key.trim()))
    ) {
      $("nodeEditError").textContent =
        "パラメータのキーと比較する値を入力してください。";
      return;
    }
    if (
      d.kind === "jev" &&
      !(d.format === "raw" ? d.instructions : d.condition)?.trim()
    ) {
      $("nodeEditError").textContent = "判定する関心・状態を入力してください。";
      return;
    }
    if (readOnly || !node(d.id)) return;
    remember();
    Object.assign(node(d.id), d);
    modalDraft = null;
    $("nodeEditDialog").close();
    render();
    say("条件の変更を保存しました。");
  });
  $("nodeEditCancel").onclick = () => $("nodeEditDialog").close();
  on($("nodeEditDialog"), "close", () => {
    const id = modalDraft?.id ?? selected;
    modalDraft = null;
    requestAnimationFrame(() =>
      root.querySelector(`[data-edit="${id}"]`)?.focus({ preventScroll: true }),
    );
  });
  on($("world"), "contextmenu", (event) => {
    const box = event.target.closest("[data-node]"),
      line = event.target.closest("[data-edge]");
    if (!box && !line) return;
    event.preventDefault();
    drag = null;
    connecting = null;
    pointer = null;
    const menu = $("nodeMenu");
    if (box) {
      const id = box.dataset.node;
      selected = id;
      selectedEdge = null;
      renderNodes();
      menu.innerHTML =
        id === "result"
          ? '<button role="menuitem" data-context-test>結果を確認</button><p>最終結果は固定です。</p>'
          : `<button role="menuitem" data-edit="${id}">編集する</button><button role="menuitem" class="delete-action" data-delete-node="${id}">削除する</button>`;
    } else {
      selected = null;
      selectedEdge = line.dataset.edge;
      renderNodes();
      menu.innerHTML = `<button role="menuitem" class="delete-action" data-delete-edge="${selectedEdge}">接続を削除する</button>`;
    }
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    const rect = menu.getBoundingClientRect();
    menu.style.left =
      Math.max(8, Math.min(event.clientX, win.innerWidth - rect.width - 8)) +
      "px";
    menu.style.top =
      Math.max(8, Math.min(event.clientY, win.innerHeight - rect.height - 8)) +
      "px";
    menu.querySelector("button")?.focus();
  });
  on(root, "pointerdown", (event) => {
    if (!$("nodeMenu").contains(event.target)) hideNodeMenu();
  });
  on(root, "click", (event) => {
    if (event.target.closest("[data-context-test]")) {
      hideNodeMenu();
      testing = true;
      tab = "test";
      render();
    }
    if (event.target.closest("[data-delete-edge]")) hideNodeMenu();
  });
  on($("viewport"), "scroll", hideNodeMenu);
  on(win, "resize", hideNodeMenu);

  $("download").onclick = () => {
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob([JSON.stringify(payload(), null, 2)], {
          type: "application/json",
        }),
      );
    a.href = url;
    a.download = "jevsense-condition-graph.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  function nodeText(n) {
    return n.format === "raw" ? n.instructions : n.condition;
  }
  function readGraph() {
    return {
      version: 1,
      offer: $("offer").value,
      nodes: nodes.map(({ x, y, sampleRole, ...n }) => n),
      edges: structuredClone(edges),
      layout: Object.fromEntries(nodes.map((n) => [n.id, { x: n.x, y: n.y }])),
    };
  }
  function updateBounds() {
    worldH = Math.max(850, ...nodes.map((n) => n.y + size(n).h + 65));
    worldW = Math.max(1020, ...nodes.map((n) => n.x + size(n).w + 40));
  }
  function loadGraph(g) {
    selectedEdge = null;
    connecting = null;
    pointer = null;
    const automatic = autoLayoutGraph(g);
    nodes = g.nodes.map((n) => ({
      ...n,
      ...(g.layout[n.id] || automatic[n.id]),
    }));
    edges = structuredClone(g.edges);
    $("offer").value = g.offer;
    selected =
      nodes.find((n) => n.kind === "jev" || n.kind === "url")?.id || "result";
    updateBounds();
  }
  function notify() {
    if (readOnly) return;
    const g = readGraph(),
      serialized = JSON.stringify(g);
    if (snapshot !== undefined && snapshot !== serialized) {
      snapshot = serialized;
      lastTest = null;
      ctx.changed(g);
    }
  }
  function testInput() {
    const input = {};
    for (const [key, value] of [
      ["entryPage", sample.entry],
      ["currentPage", sample.current],
    ]) {
      const clean = sanitizePageUrl(value, ctx.site().excludedQueryKeys);
      if (clean) {
        const u = new URL(clean);
        input[key] = { path: u.pathname, url: clean, name: "条件テスト" };
      }
    }
    return input;
  }
  function testBody() {
    return {
      graph: readGraph(),
      currentUrl:
        sanitizePageUrl(sample.current, ctx.site().excludedQueryKeys) || "",
      entryUrl:
        sanitizePageUrl(sample.entry, ctx.site().excludedQueryKeys) || "",
      probabilities: Object.fromEntries(
        nodes
          .filter((n) => n.kind === "jev")
          .map((n) => [n.id, probabilities[n.id] ?? null]),
      ),
      threshold: ctx.threshold(),
    };
  }
  function fingerprint() {
    return JSON.stringify(testBody());
  }
  function validTest() {
    return !!lastTest && lastFingerprint === fingerprint();
  }
  async function runTest() {
    if (readOnly || running) return;
    tab = "test";
    running = true;
    testError = "";
    lastTest = null;
    const body = testBody(),
      generation = fingerprint();
    render();
    try {
      const result = await ctx.test(body);
      if (!destroyed && generation === fingerprint()) {
        lastTest = result;
        lastFingerprint = generation;
      }
    } catch (error) {
      if (!destroyed)
        testError =
          error.message ||
          "テストできませんでした。URLと接続を確認してください。";
    } finally {
      running = false;
      if (!destroyed) render();
    }
  }
  function hitInput(x, y) {
    return [...root.querySelectorAll("[data-in]")].find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }
  function applyReadOnly() {
    if (!readOnly) return;
    for (const el of root.querySelectorAll(
      "[data-add],[data-out],[data-in],[data-delete-node],[data-choice],[data-property],#offer,#undo,#removeSelected,#arrange,#reset,#trySettings,#testRun,#editJSON,#nodeEditForm button[type=submit]",
    ))
      el.disabled = true;
  }
  $("editJSON").onclick = () => {
    if (readOnly) return;
    $("graphJSON").value = JSON.stringify(readGraph(), null, 2);
    $("jsonError").textContent = "";
    $("jsonEditor").showModal();
  };
  $("cancelJSON").onclick = () => $("jsonEditor").close();
  on($("jsonForm"), "submit", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (readOnly) return;
    try {
      const graph = draftConditionGraphSchema.parse(
        JSON.parse($("graphJSON").value),
      );
      remember();
      loadGraph(graph);
      lastTest = null;
      $("jsonEditor").close();
      render();
      say(
        "JSONの条件を反映しました。下書き保存・配信開始は画面下から行います。",
      );
    } catch (error) {
      $("jsonError").textContent =
        error.issues?.map((i) => i.message).join(" ") ||
        "JSONの構文とグラフの形式を確認してください。";
    }
  });
  const site = ctx.site(),
    path = site.allowedPathPrefixes[0] || "/";
  for (const s of scenarios) {
    s.entry =
      site.origins[0] +
      path +
      (s.name === "メールから流入"
        ? "?cid=mail_runner"
        : s.name === "対象外"
          ? "?cid=walker"
          : "");
    s.current = site.origins[0] + path;
  }
  initialize();
  return {
    read: () => structuredClone(readGraph()),
    invalidateTest() {
      lastTest = null;
      renderNodes();
    },
    destroy() {
      destroyed = true;
      controller.abort();
      clearTimeout(say.timer);
      $("nodeEditDialog")?.close();
      $("jsonEditor")?.close();
    },
  };
}
