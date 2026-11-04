const HEADER = "X-JevSense-Debug";
const labels = {
  insufficient_observation: "情報不足で保留",
  qualification_local: "有効閲覧へ保存（通信なし）",
  metadata_local: "ページ情報を更新（通信なし）",
  action_local: "イベントを保存（次ページで判定）",
  fact_local: "状態を保存（次ページで判定）",
  settings_local: "取得設定を更新（同じページでは再判定しません）",
  url_policy_revision_changed: "URL除外設定の更新が必要なため保留",
  deterministic_match: "URLの確定条件に一致",
  url: "URLの確定条件",
  history: "必要な過去の有効閲覧数",
  graph: "ノードの条件（URLで確定・Jev待ちを含む）",
  request_too_large: "判定要求がサイズ上限を超えています",
  metadata_revision_changed: "取得ルールの更新が必要なため保留",
  metadata_rules_changed: "取得ルールを更新し、現在のページを再取得",
  settings_changed: "設定変更後のページを取得",
  metadata_not_approved: "メタデータ送信が無効",
  no_eligible_campaign: "配信条件を満たす施策がありません",
  excluded_page: "収集対象外のページ",
  qualified: "条件成立・表示対象を決定",
  no_match_or_uncertain: "判定の閾値を満たさず保留",
  model_error: "Jevとの通信・応答エラー",
  model_not_configured: "Jevの接続設定が利用できません",
  budget_exhausted: "日次の問い合わせ上限",
  busy: "同時処理の上限",
  rate_limited: "通信回数の上限",
  debug_session_invalid: "診断の認可が無効・期限切れ",
  too_brief: "最低閲覧時間に達していません",
  enabled: "施策が有効",
  target: "表示対象ページ",
  not_dismissed: "まだ閉じていない",
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
export function createDebugger(
  win,
  { siteId, endpoint, snapshot, credentials = "omit" },
) {
  let token = null,
    expiresAt = 0,
    host,
    root,
    content,
    status,
    timer,
    expiryTimer,
    generation = 0,
    authorizeReady,
    activeTab = "status",
    historyOrder = "asc",
    events = [],
    bytes = 0,
    sequence = 0;
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
  function json(parent, title, data, key = title) {
    const details = el("details", undefined, parent);
    details.dataset.detailKey = key;
    el("summary", title, details);
    el("pre", JSON.stringify(data, null, 2), details);
  }
  function renderTrace(parent, result) {
    const trace = result.debug;
    if (!trace) {
      el(
        "p",
        "詳細な診断情報はありません。この要求が診断開始前の場合は、次のページの初期判定から記録されます。",
        parent,
      );
      return;
    }
    const o = trace.observation;
    if (o.currentPage)
      json(parent, "現在ページ（有効閲覧履歴とは別）", o.currentPage);
    if (o.entryPage) json(parent, "流入ページ（同意後の初回）", o.entryPage);
    el(
      "p",
      `最低閲覧時間 ${(o.minVisibleMs / 1000).toFixed(1)}秒 ／ 必要 ${o.minQualifiedVisits}ページ ／ 有効 ${o.qualifiedVisits}ページ`,
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
      m.mode === "stub"
        ? "固定のテスト値で判定しました · Jevへの問い合わせなし"
        : m.called
          ? `Jevに問い合わせました · ${m.actualModel ?? m.requestedModel} · ${m.elapsedMs ?? "—"}ms`
          : "Jevへの問い合わせ：未実行",
      parent,
    );
    if (m.called || m.mode === "stub") {
      json(
        parent,
        m.mode === "stub"
          ? "テストに使ったstate・questions（Jevへ未送信）"
          : "Jevへ実際に送ったstate・questions",
        {
          model: m.requestedModel,
          state: m.state,
          questions: m.questions,
        },
      );
      if (m.usage && m.mode !== "stub")
        json(parent, "使用量（応答に含まれる項目のみ）", m.usage);
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
        c.decisionMode === "rules"
          ? `URLの確定条件だけで判定 ／ 必要な過去の有効閲覧：${c.minimumHistory}件 ／ 優先順位：${c.priority}`
          : `閾値：${c.threshold}を超える ／ ${c.combination === "all" ? "すべて成立（AND）" : "いずれか成立（OR）"} ／ 優先順位：${c.priority}`,
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
      if (c.graph) json(details, "ノードごとの判定結果", c.graph);
    }
    el("p", "判定値は購入確率・施策効果ではありません。", parent, "muted");
  }
  function historyRows(s) {
    const current = s.state.currentVisit;
    const info = s.currentVisitInfo;
    const visits = new Map();
    for (const event of events)
      if (event.type === "visit")
        visits.set(event.data.id, {
          ...event.data,
          time: event.time,
          type: "page",
        });
    for (const visit of s.pastVisitInfo ?? [])
      if (visit.id !== undefined && visits.has(visit.id))
        visits.set(visit.id, { ...visits.get(visit.id), ...visit });
    if (current && info)
      visits.set(info.id, { ...current, ...info, type: "page", current: true });
    const past = s.pastVisitInfo ?? s.state.visits;
    const restored = past
      .filter((v) => v.id === undefined || !visits.has(v.id))
      .map((v, i) => ({
        ...v,
        type: "page",
        key: `saved-${i}`,
        qualified: true,
      }));
    const live = [
      ...visits.values(),
      ...events
        .filter((e) => ["action_local", "fact_local"].includes(e.type))
        .map((e) => ({ ...e, key: `event-${e.sequence}` })),
    ].sort((a, b) => a.time - b.time);
    const rows = [...restored, ...live];
    // The entry reference can survive when a short visit did not qualify.
    // Its timestamp and duration cannot be reconstructed after a reload.
    const entry = s.state.entryPage;
    if (entry && rows[0]?.page?.path !== entry.path)
      rows.unshift({ page: entry, type: "page", entry: true, key: "entry" });
    else if (entry && rows[0]?.type === "page") rows[0].entry = true;
    if (current && !info)
      rows.push({ ...current, type: "page", current: true, key: "current" });
    return rows;
  }
  function renderHistory(s) {
    const journey = el("div", undefined, content, "journey");
    const heading = el("div", undefined, journey, "journey-heading");
    el("h3", "行動履歴", heading);
    const order = el("select", undefined, heading);
    order.setAttribute("aria-label", "履歴の並び順");
    order.dataset.control = "history-order";
    for (const [value, title] of [
      ["asc", "古い順 → 現在"],
      ["desc", "新しい順 → 流入"],
    ]) {
      const option = el("option", title, order);
      option.value = value;
    }
    order.value = historyOrder;
    order.onchange = () => {
      historyOrder = order.value;
      render();
    };
    el(
      "p",
      "同意後の流入から現在まで、計測した情報を順番に確認できます。",
      journey,
      "muted",
    );
    const rows = historyRows(s);
    const summary = el("div", undefined, journey, "journey-summary");
    for (const [value, title] of [
      [
        `${rows.filter((r) => r.type === "page").length}ページ`,
        "確認できる閲覧",
      ],
      [`${(s.pastVisitInfo ?? s.state.visits).length}ページ`, "過去の有効閲覧"],
      [s.current ? "計測中" : "計測なし", "現在のページ"],
    ]) {
      const item = el("div", undefined, summary);
      el("strong", value, item);
      el("span", title, item);
    }
    const list = el("ol", undefined, journey, "timeline");
    list.setAttribute("aria-label", "計測した行動の時系列");
    if (!rows.length)
      el(
        "p",
        "計測した行動はまだありません。同意・取得設定・収集対象の経路を確認してください。",
        journey,
        "muted",
      );
    for (const row of historyOrder === "desc" ? [...rows].reverse() : rows) {
      const li = el(
        "li",
        undefined,
        list,
        `timeline-event${row.current ? " is-current" : ""}`,
      );
      const top = el("div", undefined, li, "event-top");
      const time = el(
        "time",
        row.time
          ? new Date(row.time).toLocaleTimeString("ja-JP")
          : "時刻の記録なし",
        top,
      );
      if (row.time) time.dateTime = new Date(row.time).toISOString();
      const page = row.type === "page";
      el(
        "span",
        page
          ? row.current
            ? "現在のページ"
            : row.entry
              ? "流入"
              : "ページ閲覧"
          : row.type === "action_local"
            ? "操作"
            : "状態変更",
        top,
        `event-badge${row.current ? " current" : row.entry ? " entry" : !page ? " action" : ""}`,
      );
      if (row.current && row.entry)
        el("span", "流入", top, "event-badge entry");
      if (page) {
        const card = el("article", undefined, li, "visit-card");
        el("h4", row.page.name, card);
        el("p", row.page.path, card, "visit-path");
        const metrics = el("p", undefined, card, "visit-metrics");
        const duration = el(
          "span",
          Number.isFinite(row.visibleMs)
            ? `${row.current ? "表示中" : "表示"} ${(row.visibleMs / 1000).toFixed(1)}秒`
            : "閲覧時間の記録なし",
          metrics,
        );
        if (row.current) duration.dataset.currentDuration = "true";
        el(
          "span",
          row.current
            ? "過去の有効閲覧には含めない"
            : row.qualified || row.visibleMs >= s.minVisibleMs
              ? "✓ 有効閲覧"
              : Number.isFinite(row.visibleMs)
                ? "最低閲覧時間未満"
                : "流入ページの記録",
          metrics,
        );
        json(card, "取得したページ情報", row.page, `page-${row.id ?? row.key}`);
      } else {
        const line = el(
          "p",
          row.type === "action_local" ? "操作を連携 " : "状態を変更 ",
          li,
          "action-line",
        );
        el("code", row.data.name, line);
        if (row.data.value !== undefined)
          el("span", ` → ${String(row.data.value)}`, line);
        el("p", "ブラウザ内に保存・この更新による再判定なし", li, "muted");
      }
    }
    el(
      "p",
      "有効閲覧は最低閲覧時間を満たした過去のページです。現在ページの計測とは分けて扱います。",
      journey,
      "muted history-note",
    );
    el(
      "p",
      "過去の有効閲覧と流入ページは保存済み情報から表示します。診断開始前・再読み込み前の時刻や途中の操作は復元しません。診断中の記録は最大60件・合計1MBで古いものから消去します。",
      journey,
      "muted history-note",
    );
    const extra = el("div", undefined, content, "history-extra");
    el("h3", "その他の計測情報", extra);
    el(
      "p",
      "履歴とは別に、いま保持している情報を確認できます。",
      extra,
      "muted",
    );
    json(extra, "現在ページの取得元", s.sources);
    json(extra, "許可された操作・状態", {
      actions: s.state.actions,
      facts: s.state.facts,
    });
    json(extra, "表示回数・閉じた状態", s.state.delivery);
    el(
      "p",
      "フォーム入力・ページ全文・JSON-LD全体は取得・送信しません。",
      extra,
      "muted",
    );
  }
  function render() {
    if (!root || !valid()) return;
    status.textContent = `診断中 · ${new Date(expiresAt).toLocaleTimeString("ja-JP")}まで`;
    const openDetails = new Set(
      [...content.querySelectorAll("details[open][data-detail-key]")].map(
        (d) => d.dataset.detailKey,
      ),
    );
    const scrollTop = content.scrollTop;
    const focused = root.activeElement?.dataset.control;
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
      el(
        "p",
        s.current?.path ?? "収集対象となる現在のページ情報はありません",
        content,
      );
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
          : "このページの初期判定は1回だけです。閲覧時間・イベント・状態の更新はローカルへ保存します。",
        content,
      );
      el(
        "p",
        "このパネルは通常動作を観察します。開く操作による追加のJev問い合わせはありません。",
        content,
        "muted",
      );
    } else if (activeTab === "history") {
      renderHistory(s);
    } else {
      el("h3", "このタブの判定・表示の記録", content);
      if (!events.some((event) => ["request", "response"].includes(event.type)))
        el(
          "p",
          "診断開始前の通信は記録されません。次のページへ移動すると、そのページの初期判定を記録できます。",
          content,
        );
      for (const event of [...events]
        .reverse()
        .filter((e) => !["visit", "page_left"].includes(e.type))) {
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
          }[event.type] ?? describe(event.type);
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
          `trace-${event.sequence}`,
        );
      }
      el(
        "p",
        "記録はこのタブ内だけに保持（最大60件・合計1MB）。遷移・終了・期限切れで消去します。",
        content,
        "muted",
      );
    }
    for (const d of content.querySelectorAll("details[data-detail-key]"))
      d.open = openDetails.has(d.dataset.detailKey);
    content.scrollTop = scrollTop;
    if (focused)
      content
        .querySelector(`[data-control="${focused}"]`)
        ?.focus({ preventScroll: true });
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
    const css = `:host{all:initial;position:fixed;right:16px;top:16px;z-index:2147483646;font:14px/1.6 system-ui,sans-serif;color:#23362c}*{box-sizing:border-box}[hidden]{display:none!important}section{width:520px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #cbd7cf;border-radius:16px;box-shadow:0 12px 48px #0003;overflow:hidden}header{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#153c2b;color:white}header strong{flex:1}button{font:inherit;cursor:pointer;border:1px solid #cbd7cf;border-radius:8px;background:#fff;color:#1d4c35;padding:6px 10px}nav{display:flex;gap:24px;padding:0 16px;border-bottom:1px solid #e0e6e2}nav button{border:0;border-bottom:3px solid transparent;border-radius:0;padding:12px 0;background:none;color:#64736a;font-size:13px}nav button[aria-pressed=true]{border-bottom-color:#357653;color:#1d4c35;font-weight:600}main{padding:0 16px 16px;max-height:calc(100dvh - 170px);overflow:auto}h3{font-size:16px}h4{margin:0}p{margin:8px 0;overflow-wrap:anywhere}.muted{color:#64736a;font-size:12px}details,article{border:1px solid #dbe3de;padding:10px;border-radius:8px;margin:10px 0}summary{cursor:pointer;overflow-wrap:anywhere}pre{font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto}
.journey{padding:20px 0}.journey-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.journey h3,.history-extra h3{margin:0}.journey-heading select{font:12px system-ui,sans-serif;color:#42664c;border:1px solid #cbd7cf;background:white;border-radius:6px;padding:8px;max-width:52%}.journey-summary{display:flex;background:#f3f7f2;border:1px solid #e1e8de;border-radius:8px;padding:12px 0;margin:18px 0 22px}.journey-summary div{flex:1;padding:0 12px;border-right:1px solid #dce5da;min-width:0}.journey-summary div:last-child{border:0}.journey-summary strong{display:block;font-size:15px}.journey-summary span{display:block;font-size:11px;color:#64736a;margin-top:4px}.timeline{list-style:none;margin:0;padding:0}.timeline-event{position:relative;border-left:1px solid #d3e0d4;margin-left:6px;padding:0 0 20px 22px}.timeline-event:last-child{border-left-color:transparent;padding-bottom:0}.timeline-event:before{content:"";position:absolute;left:-5px;top:6px;width:9px;height:9px;border-radius:50%;background:#fff;border:2px solid #91ae98}.timeline-event.is-current:before{background:#398157;border-color:#398157;box-shadow:0 0 0 4px #e5f2e8}.event-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.event-top time{font-size:11px;color:#687b6c;font-variant-numeric:tabular-nums}.event-badge{font-size:11px;padding:2px 6px;border-radius:4px;background:#edf3ea;color:#456c4b}.event-badge.entry{background:#efedf7;color:#6c5a8a}.event-badge.current{background:#dcefe2;color:#286342}.event-badge.action{background:#fbf0dc;color:#8d682f}.visit-card{margin:0;padding:12px;border-color:#dce5dc}.is-current .visit-card{background:#f6fbf6;border-color:#9ab89e}.visit-card h4{font-size:14px;overflow-wrap:anywhere}.visit-path{font-size:12px;color:#677c6b}.visit-metrics{display:flex;gap:6px 12px;flex-wrap:wrap;font-size:12px;color:#4d6e52}.visit-card details{margin:10px 0 0;padding:8px 0 0;border:0;border-radius:0;border-top:1px solid #dfe8dd}.visit-card summary{font-size:12px}.history-note{margin-top:18px}.history-extra{background:#f4f7f2;border-top:1px solid #d6e1d4;margin:0 -16px -16px;padding:20px 16px}.history-extra details{background:#fff}.action-line code{font:12px ui-monospace,monospace;background:#fbf0dc;padding:2px 4px;border-radius:4px;overflow-wrap:anywhere}button:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #71a988;outline-offset:2px}@media(max-width:440px){.journey-summary div{padding:0 8px}.journey-summary strong{font-size:14px}.timeline-event{padding-left:16px}header{padding:12px}nav{gap:20px;padding:0 16px}nav button{font-size:12px;padding:10px 0}}`;
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
  function appendEvent(type, data, time = Date.now()) {
    let serialized = JSON.stringify({ time, type, data });
    if (serialized.length > 262144)
      serialized = JSON.stringify({
        time,
        type,
        data: { reason: "大きすぎるため詳細を省略しました" },
      });
    const event = JSON.parse(serialized);
    event.sequence = ++sequence;
    event.size = serialized.length * 2;
    events.push(event);
    bytes += event.size;
    while (events.length > 60 || bytes > 1048576) bytes -= events.shift().size;
  }
  function record(type, data = {}) {
    if (!valid()) return;
    const s = snapshot();
    if (s.currentVisitInfo && s.state.currentVisit) {
      const { id, time } = s.currentVisitInfo;
      const previous = events.findIndex(
        (e) => e.type === "visit" && e.data.id === id,
      );
      if (previous >= 0) {
        bytes -= events[previous].size;
        events.splice(previous, 1);
      }
      appendEvent("visit", { ...s.state.currentVisit, id }, time);
    }
    appendEvent(type, data);
    if (activeTab === "decisions" || activeTab === "history") render();
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
          credentials,
          referrerPolicy: "no-referrer",
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
      authorizeReady?.();
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
        else if (activeTab === "history") {
          const visit = snapshot().state.currentVisit;
          const duration = content.querySelector("[data-current-duration]");
          if (visit && duration)
            duration.textContent = `表示中 ${(visit.visibleMs / 1000).toFixed(1)}秒`;
        }
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
    // A diagnostic popup can authorize the initial request without making a
    // second decision. Ordinary pages do not wait; popup waits are bounded.
    waitForAuthorization: () => {
      if (!win.opener || valid()) return Promise.resolve();
      return new Promise((resolve) => {
        const timeout = win.setTimeout(resolve, 500);
        authorizeReady = () => {
          win.clearTimeout(timeout);
          resolve();
        };
      });
    },
    headers: () => (valid() ? { [HEADER]: token } : {}),
    clear: () => {
      events = [];
      bytes = 0;
      render();
    },
  };
}
