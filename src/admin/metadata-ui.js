import { sanitizePageUrl, pageWithUrl, sanitizePage } from "../page-url.js";
import { z } from "zod";
import {
  metadataPolicySchema,
  defaultMetadataRules,
} from "../metadata-policy.js";
import { extractPage } from "../metadata-extractor.js";
import { bytesToBase64 } from "./crypto.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clone = (v) => structuredClone(v);
const reportSchema = z
  .object({
    page: z
      .object({
        url: z.url().max(4096).optional(),
        path: z
          .string()
          .startsWith("/")
          .max(512)
          .refine((v) => !/[?#]/.test(v)),
        name: z.string().min(1).max(160),
        description: z.string().max(400).optional(),
        type: z.string().max(80).optional(),
        themes: z.array(z.string().max(80)).max(8).optional(),
      })
      .strict(),
    provenance: z
      .object({
        name: z.string().max(200).optional(),
        description: z.string().max(200).optional(),
        type: z.string().max(200).optional(),
        themes: z.string().max(200).optional(),
        trace: z
          .array(
            z
              .object({
                rank: z.number().int().min(1).max(10).optional(),
                id: z.string().max(64).optional(),
                name: z.string().max(80),
                adopted: z.boolean(),
                reason: z.string().max(200),
                conditions: z
                  .array(
                    z
                      .object({
                        source: z.string().max(200),
                        op: z.enum([
                          "exists",
                          "nonempty",
                          "equals",
                          "includes",
                        ]),
                        matched: z.boolean(),
                      })
                      .strict(),
                  )
                  .max(5)
                  .optional(),
              })
              .strict(),
          )
          .max(10),
      })
      .strict(),
  })
  .strict();

const sources = {
  jsonld: "JSON-LD",
  meta: "メタタグ（OGP含む）",
  title: "HTML title",
};
const ops = {
  nonempty: "値がある（空でない）",
  exists: "プロパティがある",
  equals: "等しい",
  includes: "配列に含む／文字列と一致",
};
const btn = (label, action, disabled = false, kind = "") =>
  `<button type="button" class="button ${kind}" data-metadata="${esc(action)}" ${disabled ? "disabled" : ""}>${label}</button>`;
const label = (s) =>
  s.source === "title" ? "HTML title" : `${sources[s.source]}.${s.key}`;
export function createMetadataSettings(ctx) {
  let owner = "",
    policy = null,
    excluded = [],
    rules = [],
    editing = null,
    creating = false,
    result = null,
    resultMessage = "",
    connection = null,
    busy = false;
  const current = () => ctx.value();
  const fingerprint = () => JSON.stringify({ policy, excluded });
  function sync() {
    const key = current().site.id + ":" + current().revision;
    if (key !== owner) {
      owner = key;
      policy = clone(current().site.metadataExtraction ?? null);
      excluded = clone(current().site.excludedQueryKeys ?? []);
      rules = clone(
        policy?.rules.length ? policy.rules : defaultMetadataRules(),
      );
      editing = null;
      result = null;
      resultMessage = "URLを入力して確認を開始してください。";
      disconnect();
    }
  }
  function disconnect() {
    if (connection) {
      clearTimeout(connection.timer);
      clearTimeout(connection.expiry);
      connection.tab?.postMessage(
        {
          type: "jevsense:metadata-stop",
          siteId: connection.siteId,
          nonce: connection.nonce,
        },
        connection.origin,
      );
      connection = null;
    }
  }
  function changed() {
    result = null;
    resultMessage =
      "設定案を変更しました。変更後の内容で確認するにはページを開き直してください。";
    disconnect();
    ctx.dirty();
    paintResult();
  }
  function config() {
    return metadataPolicySchema.parse({
      ...policy,
      rules: policy?.mode === "custom" ? rules : [],
    });
  }
  function html() {
    sync();
    const readOnly = !ctx.canManage();
    return `<div id="metadataSettings"><section class="card card-body url-policy"><h2>ページURLの取得</h2><p class="hint">現在ページ・有効閲覧履歴・流入ページにURLを持たせます。除外が空ならGETパラメータをすべて保持します。#以降とURL内のユーザー名・パスワードは常に除きます。</p><label class="field">取得しないGETパラメータのキー<textarea id="excludedQueryKeys" aria-label="取得しないGETパラメータのキー" ${readOnly ? "disabled" : ""} placeholder="email&#10;token">${esc(excluded.join("\n"))}</textarea><small>1行に1キー、最大50件。大文字小文字を区別した完全一致です。同じキーの値はすべて除き、保存・送信・診断へ残しません。未指定の値は送信されるため、対象URLを確認してください。</small></label></section><section class="card card-body"><div class="metadata-mode-heading"><div><h2>取得方法</h2><p class="hint">標準はOGP → title・meta。JSON-LDや条件・接頭辞を使う場合はカスタムを選びます。</p></div><span class="pill">サイト共通の設定</span></div>${!policy ? '<p class="notice">このサイトは従来のJSON-LD優先の取得を使用しています。取得方法を選んで保存するまで、現在の動作を維持します。</p>' : ""}<div class="segmented">${btn("標準の自動取得", "mode:standard", readOnly, policy?.mode === "standard" ? "selected" : "")}${btn("サイト独自のルール", "mode:custom", readOnly, policy?.mode === "custom" ? "selected" : "")}</div><p class="hint">保存すると、SDKが次に設定を取得したときに反映します。タグの差し替えは不要です。</p>${readOnly ? '<p class="notice">取得ルールの編集と実ページの取得確認は、サイト管理者・Superuserが利用できます。</p>' : ""}</section><div class="metadata-grid"><div><div id="metadataRules">${ruleList()}</div><div class="editor-footer"><p class="hint">保存前の設定案で実ページを確認できます。保存すると、以前の取得ルールによる閲覧履歴は次回設定反映時に破棄します。表示済み状態は維持します。</p>${btn("変更内容を確認", "review", readOnly, "primary")}</div></div><aside class="card metadata-test"><header class="card-header"><h3>取得結果を確認</h3></header><div class="card-body"><label class="field">確認するページURL<input id="metadataURL" aria-label="確認するページURL" type="url" autocomplete="off" spellcheck="false" value="${esc(current().site.origins[0] + current().site.allowedPathPrefixes[0])}"><small>登録済みのサイト・収集経路にあるページを指定してください。</small></label><div class="url-preview"><strong>保存・送信するURL</strong><pre id="sanitizedURL"></pre></div>${btn("このURLで確認", "inspect", readOnly || !policy, "primary")}<p class="hint">別タブのSDKから、保存前の設定案による取得結果を受け取ります。計測同意と最新版のSDKが必要です。Jev判定・オファー表示・履歴保存は行いません。</p><div id="metadataResult" aria-live="polite"></div>${btn("同じページから再取得", "refresh", !connection || !result, "small")}<details class="metadata-manual"><summary>導入前に取得値を手動入力して試す</summary><p class="hint">人工データでの確認用です。実ページから取得した結果とは区別して表示します。</p><label class="field">ページ情報のサンプルJSON<textarea id="metadataSample" spellcheck="false">${esc(JSON.stringify({ url: "https://example.com/products/polo", title: "HTMLのページ名", meta: { "og:title": "夏のポロシャツ特集", "og:description": "暑い日の着心地を考えた特集です。" }, jsonld: [{ "@type": "Product", sku: "POLO-A", name: "吸汗速乾ポロシャツ", description: "さらりとした着心地の一着。" }] }, null, 2))}</textarea></label>${btn("人工データで確認", "sample", !policy)}</details></div></aside></div></div>`;
  }
  function ruleList() {
    if (!policy)
      return '<section class="card card-body"><h3>取得方法を選択してください</h3><p>既存の動作を確認してから、標準またはサイト独自のルールに切り替えられます。</p></section>';
    if (policy.mode === "standard")
      return '<section class="card card-body"><h3>標準の取得順序</h3><dl class="metadata-mapping"><dt>ページ名</dt><dd>og:title → HTML title → Untitled</dd><dt>説明</dt><dd>og:description → meta description → 省略</dd></dl><p class="hint">空・不正な値は次の取得元へ進みます。JSON-LD、種類・テーマは取得しません。</p></section>';
    const disabled = !ctx.canManage();
    return `<div class="metadata-mode-heading"><h3>取得候補の優先順位</h3>${btn("＋ 候補を追加", "add", disabled || rules.length >= 10, "small")}</div><p class="hint">上から確認し、条件とページ名を満たす最初の候補を使います。</p>${rules.map((r, i) => `<article class="card metadata-rule ${r.enabled ? "" : "metadata-off"}"><header class="card-header"><span class="metadata-rank">${i + 1}</span><div><h3>${esc(r.name)}</h3><small>${r.conditions.length}つの条件・${r.combination === "all" ? "すべて満たす" : "いずれかを満たす"}</small></div><span class="pill">${sources[r.nameOutput.source]}</span></header><div class="card-body"><p class="hint">${r.conditions.map((c) => `${esc(label(c))} ${ops[c.op]} ${["includes", "equals"].includes(c.op) ? esc(c.value) : ""}`).join(r.combination === "all" ? " ／ " : " または ")}</p><dl class="metadata-mapping"><dt>ページ名</dt><dd>${esc(r.nameOutput.prefix)}<code>{${esc(label(r.nameOutput))}}</code></dd><dt>説明</dt><dd>${esc(r.descriptionOutput.prefix)}<code>{${esc(label(r.descriptionOutput))}}</code></dd></dl><p class="hint">説明がない場合：${r.descriptionPolicy === "allow" ? "説明なしで採用" : "次の候補へ進む"}</p></div><footer class="metadata-rule-footer"><label><input type="checkbox" data-metadata-enable="${r.id}" ${r.enabled ? "checked" : ""} ${disabled ? "disabled" : ""}> 有効</label><div class="actions">${btn("↑", `up:${r.id}`, disabled || !i, "small")}${btn("↓", `down:${r.id}`, disabled || i === rules.length - 1, "small")}${btn("編集", `edit:${r.id}`, disabled, "small")}${btn("複製", `duplicate:${r.id}`, disabled || rules.length >= 10, "small")}${btn("削除", `delete:${r.id}`, disabled, "small")}</div></footer></article>`).join("")}<p class="notice">どの候補も使えない場合は、ページ名をUntitledとして扱い、説明を省略します。条件に使うSKU等の値は取得結果へ自動で含めません。</p>`;
  }
  function mount() {
    if (!document.getElementById("metadataSettings")) return;
    paintResult();
    paintUrl();
  }
  function repaint() {
    document.getElementById("metadataRules").innerHTML = ruleList();
    ctx.enhance();
    paintResult();
  }
  function paintUrl() {
    const output = document.getElementById("sanitizedURL");
    if (!output) return;
    if (excluded.length > 50 || excluded.some((k) => k.length > 100)) {
      output.textContent =
        "除外キーは50件以内・各100文字以内で指定してください。";
      return;
    }
    output.textContent =
      sanitizePageUrl(
        document.getElementById("metadataURL")?.value,
        excluded,
      ) || "収集可能なURLを入力してください（4,096文字まで）。";
  }
  function paintResult() {
    const root = document.getElementById("metadataResult");
    if (!root) return;
    root.innerHTML = `<p class="notice">${esc(resultMessage)}</p>${result ? `<div class="metadata-output"><h3>${esc(result.page.name)}</h3><p>${esc(result.page.description || "説明なし")}</p></div><h4>採用・不採用の理由</h4><ol class="metadata-trace">${(result.provenance.trace || []).map((t) => `<li><strong>${t.adopted ? "採用：" : ""}${esc(t.name)}</strong><small>${esc(t.reason)}</small></li>`).join("")}</ol><details><summary>APIへ送るページ情報の形</summary><pre>${esc(JSON.stringify(result.page, null, 2))}</pre></details><details><summary>取得元と候補の確認結果</summary><p class="hint">この確認根拠は、通常の判断要求やJevへは送りません。</p><pre>${esc(JSON.stringify(result.provenance, null, 2))}</pre></details>` : ""}`;
    const refresh = document.querySelector('[data-metadata="refresh"]');
    if (refresh) refresh.disabled = !connection || !result;
  }
  const f = (name, key, value, hint = "", opts = {}) =>
    ctx.field(name, key, value, hint, opts);
  const sel = (name, key, value, options) =>
    ctx.select(name, key, value, options);
  function readEditor() {
    const form = document.getElementById("metadataRuleForm");
    if (!form) return;
    for (const [key, value] of new FormData(form)) {
      const parts = key.split(".");
      let dest = editing;
      for (const part of parts.slice(0, -1)) dest = dest[part];
      dest[parts.at(-1)] = value;
    }
  }
  function editDialog() {
    const r = editing;
    const output = (kind, title) =>
      `<section class="metadata-section"><h3>${title}</h3>${sel("取得元", `${kind}.source`, r[kind].source, sources)}${f("取得キー", `${kind}.key`, r[kind].key, "例：name、description、og:title。HTML titleを選んだ場合はtitle。", { required: true, max: 120 })}${f("取得値の前につける文字", `${kind}.prefix`, r[kind].prefix, "任意。例：商品詳細：", { max: 80 })}</section>`;
    ctx.dialog(
      creating ? "取得候補を追加" : "取得候補を編集",
      `<form id="metadataRuleForm">${f("候補名", "name", r.name, "管理画面内で区別するための名前です。", { required: true, max: 80 })}${sel("条件の組み合わせ", "combination", r.combination, { all: "すべて満たす（AND）", any: "いずれかを満たす（OR）" })}<h3>適用する条件</h3>${r.conditions.map((c, i) => `<section class="metadata-section">${sel("取得元", `conditions.${i}.source`, c.source, sources)}${f("確認するキー", `conditions.${i}.key`, c.key, "JSON-LDの標準の商品型はProductです。", { required: true, max: 120 })}${sel("条件", `conditions.${i}.op`, c.op, ops)}${["includes", "equals"].includes(c.op) ? f("比較する値", `conditions.${i}.value`, c.value, "完全一致で比較します。", { max: 160 }) : ""}${btn("この条件を削除", `remove-condition:${i}`, r.conditions.length === 1, "small")}</section>`).join("")}${btn("＋ 条件を追加", "add-condition", r.conditions.length >= 5, "small")}${output("nameOutput", "ページ名")}${output("descriptionOutput", "説明")}${sel("説明を取得できない場合", "descriptionPolicy", r.descriptionPolicy, { allow: "説明なしで採用する", next: "次の候補へ進む" })}<p class="notice">JSON-LDの条件と取得値は、同じオブジェクトで評価します。複数候補から対象を特定できなければ次の候補へ進みます。</p><p id="metadataRuleError" role="alert"></p></form>`,
      btn("キャンセル", "cancel") +
        btn("候補を保存", "save-rule", false, "primary"),
      "metadata-dialog",
    );
  }
  async function startInspection() {
    const policy = config(),
      raw = document.getElementById("metadataURL").value;
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw Error("HTTPSのページURLを入力してください。");
    }
    if (
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" && url.hostname === "localhost")
      )
    )
      throw Error("認証情報を含まないHTTPSのURLを入力してください。");
    disconnect();
    result = null;
    resultMessage = "確認するページを開いています…";
    paintResult();
    const tab = window.open("about:blank", "_blank");
    if (!tab) throw Error("ポップアップを許可して、もう一度確認してください。");
    const nonce = bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
      key = owner,
      fp = fingerprint();
    try {
      const data = await ctx.api(ctx.path() + "/metadata-inspection", "POST", {
        url: url.origin + url.pathname,
        policy,
        excludedQueryKeys: excluded,
        nonce,
      });
      if (
        key !== owner ||
        fp !== fingerprint() ||
        !document.getElementById("metadataSettings")
      ) {
        tab.close();
        return;
      }
      connection = { ...data, tab, nonce, key, fp };
      const target = new URL(url.href);
      target.hash =
        "jevsense-metadata=" +
        encodeURIComponent(
          JSON.stringify({ origin: location.origin, nonce, hash: target.hash }),
        );
      tab.location.href = target.href;
      resultMessage =
        "SDKの接続を待っています。管理画面と対象ページを開いたままにしてください。";
      paintResult();
      connection.timer = setTimeout(() => {
        if (connection?.tab === tab && !result) {
          resultMessage =
            "まだ接続できていません。SDKの設置・更新、サイトの同意、CSP、ポップアップ、Cross-Origin-Opener-Policyを確認してください。";
          paintResult();
        }
      }, 10000);
      connection.expiry = setTimeout(
        () => {
          if (connection?.tab === tab) {
            disconnect();
            result = null;
            resultMessage =
              "確認の有効期限が切れました。ページを開き直してください。";
            paintResult();
          }
        },
        Math.max(0, data.expiresAt - Date.now()),
      );
    } catch (error) {
      tab.close();
      resultMessage = "確認を開始できませんでした。" + error.message;
      paintResult();
      throw error;
    }
  }
  function sample() {
    const raw = document.getElementById("metadataSample").value;
    if (raw.length > 20000)
      throw Error("サンプルは20,000文字以内にしてください。");
    const data = JSON.parse(raw),
      url = new URL(data.url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      typeof data.title !== "string" ||
      !data.meta ||
      typeof data.meta !== "object" ||
      Array.isArray(data.meta) ||
      !Array.isArray(data.jsonld)
    )
      throw Error("url・title・meta・jsonldの形式を確認してください。");
    disconnect();
    const doc = document.implementation.createHTMLDocument("");
    doc.title = data.title;
    for (const [name, value] of Object.entries(data.meta)) {
      if (typeof value !== "string") continue;
      const tag = doc.createElement("meta");
      tag.name = name;
      tag.content = value;
      doc.head.append(tag);
    }
    for (const node of data.jsonld) {
      const tag = doc.createElement("script");
      tag.type = "application/ld+json";
      tag.textContent = JSON.stringify(node);
      doc.head.append(tag);
    }
    const provenance = {};
    result = {
      page: pageWithUrl(
        extractPage(doc, url, provenance, config()),
        url,
        excluded,
      ),
      provenance,
    };
    resultMessage =
      "手動入力した人工データの確認結果です。実ページは取得していません。";
    paintResult();
  }
  async function action(value) {
    if (
      excluded.length > 50 ||
      excluded.some((k) => k.length > 100 || /[\u0000-\u001f\u007f]/.test(k))
    )
      throw Error(
        "除外キーは50件以内・各100文字以内で、制御文字を含めずに指定してください。",
      );
    const [kind, id] = value.split(":");
    if (kind === "sample") {
      sample();
      return;
    }
    if (kind === "cancel") {
      ctx.closeDialog();
      return;
    }
    if (!ctx.canManage()) return;
    if (kind === "mode") {
      policy = { mode: id, rules };
      changed();
      ctx.render();
      return;
    }
    if (kind === "inspect") {
      await startInspection();
      return;
    }
    if (kind === "refresh") {
      if (connection && Date.now() < connection.expiresAt)
        connection.tab.postMessage(
          {
            type: "jevsense:metadata-refresh",
            siteId: connection.siteId,
            nonce: connection.nonce,
          },
          connection.origin,
        );
      return;
    }
    if (kind === "review") {
      const next = policy ? config() : null;
      ctx.dialog(
        "ページ情報の取得方法を保存",
        `<p>このサイトのすべてのページへ適用します。次回SDKが設定を取得したときに反映します。過去のページ情報は新しいルールで再抽出できないため、ブラウザ内の閲覧履歴を破棄します。表示済み状態は維持します。</p><p>取得方法：${!next ? "従来の取得方法を維持" : next.mode === "standard" ? "標準（OGP → title・meta）" : "サイト独自のルール"}</p>${next?.mode === "custom" ? `<ol>${next.rules.map((r) => `<li>${esc(r.name)}${r.enabled ? "" : "（無効）"}</li>`).join("")}</ol>` : ""}`,
        btn("キャンセル", "cancel") + btn("保存する", "save", false, "primary"),
      );
      return;
    }
    if (kind === "save") {
      await ctx.save(policy ? config() : null, excluded);
      ctx.closeDialog();
      return;
    }
    if (kind === "add" || kind === "edit") {
      if (kind === "add" && rules.length >= 10) return;
      creating = kind === "add";
      editing = clone(
        creating
          ? {
              ...defaultMetadataRules()[0],
              id: crypto.randomUUID(),
              name: "新しい取得候補",
            }
          : rules.find((r) => r.id === id),
      );
      editDialog();
      return;
    }
    if (kind === "add-condition" || kind === "remove-condition") {
      readEditor();
      if (kind === "add-condition" && editing.conditions.length < 5)
        editing.conditions.push({
          source: "jsonld",
          key: "name",
          op: "nonempty",
          value: "",
        });
      if (kind === "remove-condition" && editing.conditions.length > 1)
        editing.conditions.splice(Number(id), 1);
      editDialog();
      return;
    }
    if (kind === "save-rule") {
      readEditor();
      const form = document.getElementById("metadataRuleForm");
      if (!form.reportValidity()) return;
      try {
        metadataPolicySchema.parse({ mode: "custom", rules: [editing] });
      } catch {
        document.getElementById("metadataRuleError").textContent =
          "候補名・取得キー・条件を確認してください。キーに式や配列指定は使えません。";
        return;
      }
      if (creating) rules.push(editing);
      else rules[rules.findIndex((r) => r.id === editing.id)] = editing;
      policy.rules = rules;
      ctx.closeDialog();
      changed();
      repaint();
      return;
    }
    const i = rules.findIndex((r) => r.id === id);
    if (i < 0) return;
    if (kind === "up" && i > 0)
      [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
    if (kind === "down" && i < rules.length - 1)
      [rules[i + 1], rules[i]] = [rules[i], rules[i + 1]];
    if (kind === "duplicate" && rules.length < 10)
      rules.splice(i + 1, 0, {
        ...clone(rules[i]),
        id: crypto.randomUUID(),
        name: (rules[i].name + "（複製）").slice(0, 80),
      });
    if (kind === "delete") rules.splice(i, 1);
    policy.rules = rules;
    changed();
    repaint();
  }
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-metadata]");
    if (!target || target.disabled || busy) return;
    event.preventDefault();
    busy = true;
    Promise.resolve(action(target.dataset.metadata))
      .catch((e) => ctx.toast(e.message))
      .finally(() => (busy = false));
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "excludedQueryKeys" && ctx.canManage()) {
      excluded = [
        ...new Set(
          event.target.value
            .split("\n")
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ];
      changed();
      paintUrl();
    }
    if (event.target.id === "metadataURL") paintUrl();
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.metadataEnable && ctx.canManage()) {
      const rule = rules.find((r) => r.id === target.dataset.metadataEnable);
      if (rule) {
        rule.enabled = target.checked;
        changed();
        repaint();
      }
    }
    if (target.closest("#metadataRuleForm")) {
      readEditor();
      if (target.tagName === "SELECT") editDialog();
    }
  });
  window.addEventListener("message", (event) => {
    const c = connection;
    if (
      !c ||
      Date.now() >= c.expiresAt ||
      event.source !== c.tab ||
      event.origin !== c.origin ||
      event.data?.siteId !== c.siteId ||
      event.data.nonce !== c.nonce ||
      c.key !== owner ||
      c.fp !== fingerprint()
    )
      return;
    if (event.data.type === "jevsense:metadata-ready") {
      c.tab.postMessage(
        {
          type: "jevsense:metadata-start",
          siteId: c.siteId,
          nonce: c.nonce,
          token: c.token,
        },
        c.origin,
      );
      return;
    }
    if (event.data.type === "jevsense:metadata-consent-required") {
      resultMessage =
        "対象ページで計測への同意を完了してください。同意後に取得確認へ接続します。";
      paintResult();
      return;
    }
    if (event.data.type === "jevsense:metadata-result") {
      // Treat the website as untrusted. Limit message size and display only known projection fields.
      const parsed = reportSchema.safeParse({
        page: event.data.page,
        provenance: event.data.provenance,
      });
      if (!parsed.success) return;
      clearTimeout(c.timer);
      result = {
        ...parsed.data,
        page: sanitizePage(parsed.data.page, excluded),
      };
      resultMessage =
        "実ページの取得結果です。表示中のメタ情報が変わると結果を更新します。";
      paintResult();
      return;
    }
    if (
      ["jevsense:metadata-error", "jevsense:metadata-ended"].includes(
        event.data.type,
      )
    ) {
      result = null;
      resultMessage =
        "取得確認を終了しました。必要ならページを開き直してください。";
      disconnect();
      paintResult();
    }
  });
  window.addEventListener("pagehide", disconnect);
  return {
    html,
    mount,
    disconnect,
    reset() {
      disconnect();
      owner = "";
    },
  };
}
