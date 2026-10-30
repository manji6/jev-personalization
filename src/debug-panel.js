const HEADER = "X-JevSense-Debug";
const labels = {
  insufficient_observation: "情報不足で保留",
  metadata_not_approved: "メタデータ送信が無効",
  no_eligible_campaign: "配信条件を満たす施策がありません",
  excluded_page: "収集対象外のページ",
  qualified: "条件成立・表示対象を決定",
  no_match_or_uncertain: "判定の閾値を満たさず保留",
  model_error: "Jevとの通信・応答エラー",
  model_not_configured: "Jevのキーが未設定",
  budget_exhausted: "日次の問い合わせ上限",
  busy: "同時処理の上限",
  rate_limited: "通信回数の上限",
  debug_session_invalid: "診断の認可が無効・期限切れ",
  too_brief: "最低閲覧時間に未到達",
  enabled: "施策が有効",
  target: "表示対象ページ",
  not_dismissed: "未クローズ",
  show_limit: "表示回数",
  fact: "除外状態の確認",
  initial: "ページを取得",
  qualification: "最低閲覧時間に到達",
  navigation: "ページ遷移",
  action: "操作を連携",
  fact_changed: "状態を変更",
  metadata: "ページ情報を更新",
  visible: "ページの表示を再開",
  manual: "明示的な判定依頼",
  queued: "通信中に更新された状態",
};
const describe = (value) => labels[value] ?? value;
export function createDebugger(win, { siteId, endpoint, snapshot }) {
  let token = null,
    expiresAt = 0,
    host,
    root,
    content,
    status,
    timer,
    expiryTimer,
    generation = 0,
    activeTab = "status",
    events = [],
    bytes = 0;
  const el = (tag, text, parent, className) => {
    const node = win.document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    parent?.append(node);
    return node;
  };
  function valid() {
    return !!token && Date.now() < expiresAt;
  }
  function json(parent, title, data) {
    const details = el("details", undefined, parent);
    el("summary", title, details);
    el("pre", JSON.stringify(data, null, 2), details);
  }
  function renderTrace(parent, result) {
    const trace = result.debug;
    if (!trace) {
      el(
        "p",
        "詳細な診断情報はありません。この要求が診断開始前の場合は、次の通常イベントから記録されます。",
        parent,
      );
      return;
    }
    const o = trace.observation;
    el(
      "p",
      `最低閲覧時間 ${(o.minVisibleMs / 1000).toFixed(1)}秒 ／ 必要 ${o.minQualifiedVisits}ページ ／ 適格 ${o.qualifiedVisits}ページ`,
      parent,
    );
    for (const visit of o.visits)
      el(
        "p",
        `${visit.path} · ${(visit.visibleMs / 1000).toFixed(1)}秒 · ${visit.reason === "qualified" ? "最低閲覧時間を満たす" : describe(visit.reason)}`,
        parent,
        "muted",
      );
    const m = trace.model;
    el(
      "p",
      m.called
        ? `Jevに問い合わせました · ${m.actualModel ?? m.requestedModel} · ${m.elapsedMs ?? "—"}ms`
        : "Jevへの問い合わせ：未実行",
      parent,
    );
    if (m.called) {
      json(parent, "Jevへ実際に送ったstate・questions", {
        model: m.requestedModel,
        state: m.state,
        questions: m.questions,
      });
      if (m.usage) json(parent, "使用量（応答に含まれる項目のみ）", m.usage);
    }
    for (const c of trace.campaigns) {
      const details = el("details", undefined, parent);
      el(
        "summary",
        `${c.title} (${c.id})${result.campaign?.id === c.id ? " · 選択" : ""}`,
        details,
      );
      for (const check of c.checks)
        el("p", `${check.passed ? "✓" : "×"} ${describe(check.key)}`, details);
      el(
        "p",
        `閾値：${c.threshold}を超える ／ ${c.combination === "all" ? "すべて成立（AND）" : "いずれか成立（OR）"} ／ 優先順位：${c.priority}`,
        details,
      );
      if (!c.questions) el("p", "この施策のJev判定は未実行です。", details);
      for (const q of c.questions ?? [])
        el(
          "p",
          `${q.passed ? "✓" : "×"} ${q.instructions} → ${q.probability === null ? "不正・欠落した応答" : q.probability.toFixed(3)}`,
          details,
        );
      el("p", `表示回数：${c.shown} / ${c.maxShows}`, details);
      if (c.excludeFact)
        el(
          "p",
          `除外状態 ${c.excludeFact}：${c.excludeFactValue === null ? "未連携" : String(c.excludeFactValue)}（falseのときのみ配信）`,
          details,
        );
      json(details, "表示対象の経路条件", c.target);
    }
    el("p", "判定値は購入確率・施策効果ではありません。", parent, "muted");
  }
  function render() {
    if (!root || !valid()) return;
    status.textContent = `診断中 · ${new Date(expiresAt).toLocaleTimeString("ja-JP")}まで`;
    content.replaceChildren();
    root
      .querySelectorAll("[data-tab]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.tab === activeTab)),
      );
    const s = snapshot();
    if (activeTab === "status") {
      el("h3", "現在の状態", content);
      el("p", `サイト：${siteId}`, content);
      el(
        "p",
        s.enabled
          ? "同意取得済み・計測有効"
          : "計測停止中：同意・サイト設定・送信の有効化を確認してください。",
        content,
      );
      el("p", s.hidden ? "タブは非表示です" : "タブは表示中です", content);
      el("p", s.current?.path ?? "収集対象の現在ページはありません", content);
      if (s.current)
        el(
          "p",
          `表示中 ${(s.current.visibleMs / 1000).toFixed(1)}秒 ／ 最低閲覧時間まで ${Math.max(0, (s.minVisibleMs - s.current.visibleMs) / 1000).toFixed(1)}秒`,
          content,
        );
      el(
        "p",
        s.offerVisible
          ? "オファー表示中：追加の判断要求は停止しています。"
          : "判断材料が変わったときだけ問い合わせます。定期送信はしません。",
        content,
      );
      el(
        "p",
        "このパネルは通常動作を観察します。開く操作による追加のJev問い合わせはありません。",
        content,
        "muted",
      );
    } else if (activeTab === "history") {
      el("h3", "このブラウザで計測した情報", content);
      for (const v of s.state.visits) {
        const card = el("article", undefined, content);
        el("h4", v.page.name, card);
        el("p", `${v.page.path} · ${(v.visibleMs / 1000).toFixed(1)}秒`, card);
        json(card, "取得したページ情報", v.page);
      }
      json(content, "現在ページの取得元", s.sources);
      json(content, "許可された操作・状態", {
        actions: s.state.actions,
        facts: s.state.facts,
      });
      json(content, "表示回数・閉じた状態", s.state.delivery);
      el(
        "p",
        "フォーム入力・ページ全文・JSON-LD全体は取得・送信しません。",
        content,
        "muted",
      );
    } else {
      el("h3", "このタブの判定・表示の記録", content);
      if (!events.some((event) => ["request", "response"].includes(event.type)))
        el(
          "p",
          "診断開始前の通信は記録されません。次の通常イベントを待つか、ページを移動してください。",
          content,
        );
      for (const event of [...events].reverse()) {
        const details = el("details", undefined, content);
        const name =
          {
            request: "判断APIへ送信",
            response: "判断APIの応答",
            shown: "オファーの描画完了",
            closed: "オファーを閉じました",
            removed: "オファーを破棄",
            render_failed: "オファーの描画失敗",
            stale: "古い応答を破棄",
            network_error: "判断APIとの通信エラー",
            page: "ページ情報を取得",
            consent: "同意状態を変更",
            action: "操作を連携",
            fact: "状態を変更",
            metadata: "ページ情報を更新",
            started: "診断を開始",
          }[event.type] ?? event.type;
        el(
          "summary",
          `${new Date(event.time).toLocaleTimeString("ja-JP")} ${name}${event.data.reason ? " · " + describe(event.data.reason) : ""}`,
          details,
        );
        if (event.type === "response") {
          el(
            "p",
            `HTTP ${event.data.status} ／ API全体 ${event.data.elapsedMs}ms ／ ${describe(event.data.result.reason ?? event.data.result.error ?? event.data.result.decision)}`,
            details,
          );
          renderTrace(details, event.data.result);
        }
        json(
          details,
          event.type === "request" ? "APIへ送ったJSON" : "記録のJSON",
          event.data,
        );
      }
      el(
        "p",
        "記録はこのタブ内だけに保持（最大60件・合計1MB）。遷移・終了・期限切れで消去します。",
        content,
        "muted",
      );
    }
  }
  function stop(message, notify = false) {
    if (notify) {
      try {
        win.opener?.postMessage(
          { type: "jevsense:debug-stopped", siteId },
          endpoint,
        );
      } catch {}
    }
    generation++;
    token = null;
    expiresAt = 0;
    events = [];
    bytes = 0;
    win.clearInterval(timer);
    win.clearTimeout(expiryTimer);
    if (message && root) {
      content.replaceChildren();
      el("p", message, content);
      status.textContent = "診断終了";
    } else {
      host?.remove();
      host = root = null;
    }
  }
  function mount() {
    host?.remove();
    host = el("aside", undefined, win.document.body);
    host.dataset.jevsenseDebug = "true";
    root = host.attachShadow({ mode: "open" });
    const css = `:host{all:initial;position:fixed;right:16px;top:16px;z-index:2147483646;font:14px/1.6 system-ui,sans-serif;color:#23362c}*{box-sizing:border-box}[hidden]{display:none!important}section{width:440px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #cbd7cf;border-radius:16px;box-shadow:0 12px 48px #0003;overflow:hidden}header{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#153c2b;color:white}header strong{flex:1}button{font:inherit;cursor:pointer;border:1px solid #cbd7cf;border-radius:8px;background:#fff;color:#1d4c35;padding:6px 10px}nav{display:flex;gap:6px;padding:12px;border-bottom:1px solid #e0e6e2}button[aria-pressed=true]{background:#e4f2e9}main{padding:0 16px 16px;max-height:calc(100dvh - 170px);overflow:auto}h3{font-size:16px}h4{margin:0}p{margin:8px 0;overflow-wrap:anywhere}.muted{color:#64736a;font-size:12px}details,article{border:1px solid #dbe3de;padding:10px;border-radius:8px;margin:10px 0}summary{cursor:pointer;overflow-wrap:anywhere}pre{font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto}`;
    if (win.CSSStyleSheet && "adoptedStyleSheets" in root) {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [sheet];
    } else el("style", css, root);
    const section = el("section", undefined, root);
    section.setAttribute("aria-label", "JevSense デバッグパネル");
    const header = el("header", undefined, section);
    el("strong", "JevSense 診断", header);
    const toggle = el("button", "折りたたむ", header);
    toggle.setAttribute("aria-expanded", "true");
    const close = el("button", "終了", header);
    close.onclick = () => stop(undefined, true);
    const body = el("div", undefined, section);
    toggle.onclick = () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? "開く" : "折りたたむ";
      toggle.setAttribute("aria-expanded", String(!body.hidden));
    };
    status = el("p", "", body, "muted");
    status.style.margin = "8px 16px";
    const nav = el("nav", undefined, body);
    for (const [id, name] of [
      ["status", "現在の状態"],
      ["history", "閲覧・行動"],
      ["decisions", "判定履歴"],
    ]) {
      const button = el("button", name, nav);
      button.dataset.tab = id;
      button.onclick = () => {
        activeTab = id;
        render();
      };
    }
    content = el("main", undefined, body);
  }
  function record(type, data = {}) {
    if (!valid()) return;
    let serialized = JSON.stringify({ time: Date.now(), type, data });
    if (serialized.length > 262144)
      serialized = JSON.stringify({
        time: Date.now(),
        type,
        data: { reason: "大きすぎるため詳細を省略しました" },
      });
    const event = JSON.parse(serialized);
    event.size = serialized.length * 2;
    events.push(event);
    bytes += event.size;
    while (events.length > 60 || bytes > 1048576) bytes -= events.shift().size;
    if (activeTab === "decisions") render();
  }
  async function receive(event) {
    const data = event.data;
    if (
      !win.opener ||
      event.source !== win.opener ||
      event.origin !== endpoint ||
      data?.type !== "jevsense:debug-start" ||
      data.siteId !== siteId ||
      typeof data.token !== "string"
    )
      return;
    const attempt = ++generation;
    try {
      const r = await win.fetch(
        `${endpoint}/v1/debug-session?siteId=${encodeURIComponent(siteId)}`,
        {
          credentials: "omit",
          headers: { [HEADER]: data.token },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!r.ok) return;
      const session = await r.json();
      if (
        attempt !== generation ||
        !Number.isFinite(session.expiresAt) ||
        session.expiresAt <= Date.now()
      )
        return;
      token = data.token;
      expiresAt = session.expiresAt;
      events = [];
      bytes = 0;
      win.clearInterval(timer);
      win.clearTimeout(expiryTimer);
      mount();
      record("started");
      render();
      timer = win.setInterval(() => {
        if (activeTab === "status") render();
      }, 1000);
      expiryTimer = win.setTimeout(
        () =>
          stop(
            "診断の有効期限が切れました。管理画面から再度開始してください。",
            true,
          ),
        expiresAt - Date.now(),
      );
      win.opener.postMessage(
        { type: "jevsense:debug-connected", siteId },
        endpoint,
      );
    } catch {
      /* Diagnostic authorization never changes normal collection. */
    }
  }
  function ready() {
    try {
      win.opener?.postMessage(
        { type: "jevsense:debug-ready", siteId },
        endpoint,
      );
    } catch {}
  }
  win.addEventListener("message", receive);
  win.addEventListener("pageshow", (event) => {
    if (event.persisted) ready();
  });
  win.addEventListener("pagehide", () => stop());
  ready();
  return {
    record,
    headers: () => (valid() ? { [HEADER]: token } : {}),
    clear: () => {
      events = [];
      bytes = 0;
      render();
    },
  };
}
