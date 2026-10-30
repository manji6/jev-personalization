import {
  renderOffer,
  designWithDefaults,
  DEFAULT_DESIGN,
} from "/offer-renderer.js";
const $ = (id) => document.getElementById(id);
let revision,
  configuration,
  draft,
  siteId,
  campaignId,
  rawDirty = false,
  preview,
  fullPreview;
const lines = (value) =>
  value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const fieldIds = [
  "campaignIntent",
  "title",
  "body",
  "linkLabel",
  "url",
  "questions",
  "combination",
  "priority",
  "maxShows",
  "threshold",
  "enabled",
  "offerType",
  "imageUrl",
  "imageAlt",
  "imageOnly",
  "targetMode",
  "targetPaths",
  "customCode",
  "customVariables",
];
const siteIds = [
  "origins",
  "allowedPaths",
  "excludedPaths",
  "siteMetadataEnabled",
  "minVisibleMs",
  "minQualifiedVisits",
  "actionNames",
  "factNames",
  "allowCustomJavaScript",
  "themeBackground",
  "themeText",
  "themeAccent",
  "themeButtonText",
  "themeFont",
  "themeFontSize",
  "themeRadius",
  "themePadding",
  "modalWidth",
  "modalOpacity",
  "floatingPosition",
  "floatingWidth",
  "floatingOffset",
  "barPosition",
];
const exampleCode = `export function render({ content, variables, mount, signal, reportShown }) {
  const button = document.createElement('button');
  button.textContent = variables.label || content.title;
  button.addEventListener('click', () => window.location.assign(content.url), { signal });
  mount.append(button);
  reportShown();
  return () => button.remove();
}`;
function site() {
  return configuration?.sites.find((s) => s.id === siteId);
}
function campaign() {
  return site()?.campaigns.find((c) => c.id === campaignId);
}
function notify(message, error = false) {
  $("status").textContent = message;
  $("status").closest("footer").classList.toggle("has-error", error);
}
function dirty() {
  if (configuration)
    $("saveState").textContent =
      "未保存の変更があります — 保存すると配信に適用されます";
}
function errorMessage(data) {
  const labels = {
    intent: "対象者と伝えたいこと",
    title: "表示タイトル",
    body: "メッセージ",
    linkLabel: "リンク文言",
    url: "リンク先URL",
    imageUrl: "画像URL",
    imageAlt: "画像の代替テキスト",
    code: "独自JavaScript",
    variables: "コードへ渡す文字列",
    origins: "対象サイトのオリジン",
    allowedPathPrefixes: "収集を許可する経路",
    excludedPathPrefixes: "収集しない経路",
    minVisibleMs: "最低表示時間",
    minQualifiedVisits: "判断に必要な閲覧数",
    priority: "優先順位",
    maxShows: "表示回数の上限",
    threshold: "確率の閾値",
    design: "サイト共通デザイン",
    allowCustomJavaScript: "独自コードの許可",
    questions: "判定する質問",
    paths: "表示対象パス",
    width: "表示幅",
    fontSize: "文字サイズ",
    radius: "角丸",
    padding: "内側の余白",
  };
  if (data.issues)
    return (
      "設定を確認してください：" +
      data.issues
        .map((i) => {
          const key = [...i.path].reverse().find((p) => labels[p]);
          const field = labels[key] ?? i.path.join(".");
          const message = /[ぁ-んァ-ン一-龠]/.test(i.message)
            ? i.message
            : "必須項目・入力形式・画面に表示された範囲を確認してください。";
          return field + "：" + message;
        })
        .join(" / ")
    );
  return (
    {
      unauthorized: "管理トークンを確認してください。",
      config_changed_reload:
        "ほかの保存が先行しました。設定を読み込み直してください。",
      server_not_configured: "CloudflareのSecrets設定を確認してください。",
      rate_limited: "要求回数の上限です。1分ほど待って再試行してください。",
    }[data.error] ??
    data.error ??
    "処理に失敗しました"
  );
}

async function api(path, options = {}) {
  const r = await fetch("/admin/api/" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + $("token").value,
      ...options.headers,
    },
  });
  const data = await r.json();
  if (!r.ok) throw new Error(errorMessage(data));
  return data;
}
function bind(id, action) {
  $(id).onclick = async () => {
    $(id).disabled = true;
    $(id).setAttribute("aria-busy", "true");
    try {
      await action();
      notify("完了しました");
    } catch (e) {
      notify(e.message, true);
    } finally {
      $(id).disabled = false;
      $(id).removeAttribute("aria-busy");
    }
  };
}
function sync() {
  $("config").value = JSON.stringify(configuration, null, 2);
  rawDirty = false;
}
function readDesign() {
  return {
    colors: {
      background: $("themeBackground").value,
      text: $("themeText").value,
      accent: $("themeAccent").value,
      buttonText: $("themeButtonText").value,
    },
    font: $("themeFont").value,
    fontSize: Number($("themeFontSize").value),
    radius: Number($("themeRadius").value),
    padding: Number($("themePadding").value),
    modal: {
      width: Number($("modalWidth").value),
      backdropOpacity: Number($("modalOpacity").value),
    },
    floating: {
      width: Number($("floatingWidth").value),
      position: $("floatingPosition").value,
      offset: Number($("floatingOffset").value),
    },
    bar: { position: $("barPosition").value },
  };
}
function fillDesign(value) {
  const d = designWithDefaults(value);
  for (const [field, v] of Object.entries({
    themeBackground: d.colors.background,
    themeText: d.colors.text,
    themeAccent: d.colors.accent,
    themeButtonText: d.colors.buttonText,
    themeFont: d.font,
    themeFontSize: d.fontSize,
    themeRadius: d.radius,
    themePadding: d.padding,
    modalWidth: d.modal.width,
    modalOpacity: d.modal.backdropOpacity,
    floatingWidth: d.floating.width,
    floatingPosition: d.floating.position,
    floatingOffset: d.floating.offset,
    barPosition: d.bar.position,
  }))
    $(field).value = v;
}
function fillSite() {
  const s = site();
  if (!s) return;
  $("currentSiteId").value = s.id;
  for (const [field, v] of Object.entries({
    origins: s.origins.join("\n"),
    allowedPaths: s.allowedPathPrefixes.join("\n"),
    excludedPaths: s.excludedPathPrefixes.join("\n"),
    siteMetadataEnabled: String(s.metadataEnabled),
    minVisibleMs: s.minVisibleMs,
    minQualifiedVisits: s.minQualifiedVisits,
    actionNames: s.actionNames.join("\n"),
    factNames: s.factNames.join("\n"),
    allowCustomJavaScript: String(s.allowCustomJavaScript ?? false),
  }))
    $(field).value = v;
  fillDesign(s.design);
  $("siteTag").value =
    `<script defer src="${location.origin}/sdk.js" data-site="${s.id}"></script>`;
}
function formOffer() {
  return {
    id: campaignId ?? "preview",
    content: {
      title: $("title").value || "あなたにおすすめの情報",
      body: $("body").value || "ここにオファーのメッセージが表示されます。",
      linkLabel: $("linkLabel").value || "詳しく見る",
      ...($("url").value ? { url: $("url").value } : {}),
      ...($("imageUrl").value
        ? { imageUrl: $("imageUrl").value, imageAlt: $("imageAlt").value }
        : {}),
    },
    presentation: {
      type: $("offerType").value || "floating",
      imageOnly: $("imageOnly").value === "true",
    },
    design: readDesign(),
  };
}
function updatePreview() {
  $("previewTitle").textContent =
    $("title").value || "あなたのオファーが、ここに表示されます。";
  $("previewBody").textContent = $("body").value;
  $("previewLink").textContent = $("linkLabel").value;
  $("previewState").textContent =
    $("enabled").value === "true" ? "有効" : "停止";
  $("campaignName").textContent = campaignId ?? "未選択";
  $("customFields").hidden = $("offerType").value !== "custom";
  $("targetPaths").disabled = $("targetMode").value === "all";
  preview?.destroy();
  preview = null;
  const offer = formOffer();
  const override = $("previewType").value;
  if (override !== "campaign")
    offer.presentation = { type: override, imageOnly: false };
  $("offerPreview").dataset.device = $("previewDevice").value;
  if (offer.presentation.type === "custom") {
    $("offerPreview").textContent =
      "独自JavaScriptは管理画面では実行しません。テストサイトで表示を確認してください。";
    $("openPreview").disabled = true;
    return;
  }
  $("offerPreview").textContent = "";
  $("openPreview").disabled = false;
  try {
    preview = renderOffer(window, offer, {
      mount: $("offerPreview"),
      preview: true,
    });
  } catch {
    $("offerPreview").textContent =
      "プレビューを表示できません。入力値を確認してください。";
  }
}
function fillCampaign() {
  const c = campaign();
  for (const field of fieldIds) $(field).value = "";
  $("offerType").value = "floating";
  $("targetMode").value = "all";
  $("enabled").value = "false";
  $("combination").value = "all";
  $("imageOnly").value = "false";
  if (c) {
    for (const k of ["priority", "maxShows", "threshold", "combination"])
      $(k).value = c[k];
    $("enabled").value = String(c.enabled);
    $("campaignIntent").value = c.intent;
    for (const k of [
      "title",
      "body",
      "linkLabel",
      "url",
      "imageUrl",
      "imageAlt",
    ])
      $(k).value = c.content[k] ?? "";
    $("questions").value = c.questions.map((q) => q.instructions).join("\n");
    $("offerType").value = c.presentation?.type ?? "floating";
    $("imageOnly").value = String(c.presentation?.imageOnly ?? false);
    $("targetMode").value = c.target?.mode ?? "all";
    $("targetPaths").value = c.target?.paths.join("\n") ?? "";
  }
  $("customCode").value = c?.custom?.code ?? exampleCode;
  $("customVariables").value = JSON.stringify(
    c?.custom?.variables ?? {},
    null,
    2,
  );
  updatePreview();
}
function listCampaigns() {
  const campaigns = site()?.campaigns ?? [];
  $("campaign").replaceChildren(
    ...campaigns.map(
      (c) =>
        new Option(
          `${c.content.title}（${c.enabled ? "有効" : "停止"}）`,
          c.id,
        ),
    ),
  );
  if (!campaigns.some((c) => c.id === campaignId))
    campaignId = campaigns[0]?.id;
  $("campaign").value = campaignId ?? "";
  fillCampaign();
}
function render() {
  const sites = configuration.sites;
  $("site").replaceChildren(...sites.map((s) => new Option(s.id, s.id)));
  if (!sites.some((s) => s.id === siteId)) siteId = sites[0]?.id;
  $("site").value = siteId ?? "";
  fillSite();
  listCampaigns();
}
function stage() {
  if (rawDirty)
    throw new Error(
      "詳細JSONの変更を先に「JSONの変更を取り込む」で読み込んでください。",
    );
  const s = site();
  if (!s) return;
  s.origins = lines($("origins").value);
  s.allowedPathPrefixes = lines($("allowedPaths").value);
  s.excludedPathPrefixes = lines($("excludedPaths").value);
  s.metadataEnabled = $("siteMetadataEnabled").value === "true";
  s.minVisibleMs = Number($("minVisibleMs").value);
  s.minQualifiedVisits = Number($("minQualifiedVisits").value);
  s.actionNames = lines($("actionNames").value);
  s.factNames = lines($("factNames").value);
  s.allowCustomJavaScript = $("allowCustomJavaScript").value === "true";
  s.design = readDesign();
  const c = campaign();
  if (c) {
    c.intent = $("campaignIntent").value;
    c.enabled = $("enabled").value === "true";
    for (const k of ["priority", "maxShows", "threshold"])
      c[k] = Number($(k).value);
    c.combination = $("combination").value;
    c.content = {
      title: $("title").value,
      body: $("body").value,
      linkLabel: $("linkLabel").value,
      ...($("url").value ? { url: $("url").value } : {}),
    };
    if ($("imageUrl").value) c.content.imageUrl = $("imageUrl").value;
    if ($("imageAlt").value) c.content.imageAlt = $("imageAlt").value;
    c.questions = lines($("questions").value).map((instructions, i) => ({
      key: "q" + i,
      instructions,
    }));
    c.presentation = {
      type: $("offerType").value,
      imageOnly: $("imageOnly").value === "true",
    };
    c.target = {
      mode: $("targetMode").value,
      paths: lines($("targetPaths").value),
    };
    if (c.presentation.type === "custom") {
      let variables;
      try {
        variables = JSON.parse($("customVariables").value);
      } catch {
        throw new Error(
          "コードへ渡す文字列はJSONオブジェクトで入力してください。",
        );
      }
      c.custom = { code: $("customCode").value, variables };
    }
  }
  sync();
}
for (const key of [...fieldIds, ...siteIds])
  $(key).addEventListener("input", () => {
    dirty();
    updatePreview();
  });
$("config").addEventListener("input", () => {
  rawDirty = true;
  dirty();
});
for (const key of ["previewType", "previewDevice"])
  $(key).onchange = updatePreview;
$("site").onchange = () => {
  const next = $("site").value;
  try {
    stage();
    siteId = next;
    campaignId = undefined;
    fillSite();
    listCampaigns();
  } catch (e) {
    $("site").value = siteId;
    notify(e.message, true);
  }
};
$("campaign").onchange = () => {
  const next = $("campaign").value;
  try {
    stage();
    campaignId = next;
    fillCampaign();
  } catch (e) {
    $("campaign").value = campaignId;
    notify(e.message, true);
  }
};
function tab(type) {
  for (const name of ["site", "campaign"]) {
    const selected = name === type;
    $(name + "Tab").setAttribute("aria-selected", String(selected));
    $(name + "SettingsPanel").hidden = !selected;
  }
  updatePreview();
}
$("siteTab").onclick = () => tab("site");
$("campaignTab").onclick = () => tab("campaign");
bind("load", async () => {
  const result = await api("config");
  revision = result.revision;
  configuration = result.config;
  sync();
  render();
  $("connectionState").classList.add("connected");
  $("connectionLabel").textContent = "接続済み";
  $("saveState").textContent = "保存済みの設定を読み込みました";
});
bind("draft", async () => {
  draft = await api("draft", {
    method: "POST",
    body: JSON.stringify({
      intent: $("intent").value,
      subject: $("subject").value,
    }),
  });
  $("suggestion").textContent = JSON.stringify(draft, null, 2);
});
bind("useDraft", async () => {
  if (!draft) throw new Error("先に質問案を作成してください");
  $("questions").value = draft.questions.map((q) => q.instructions).join("\n");
  $("campaignIntent").value = draft.intent;
  dirty();
  updatePreview();
});
bind("new", async () => {
  stage();
  const s = site();
  if (!s || s.campaigns.length >= 5)
    throw new Error("サイトを読み込んでください。施策は最大5件です");
  campaignId = "campaign_" + crypto.randomUUID().slice(0, 8);
  s.campaigns.push({
    id: campaignId,
    enabled: false,
    intent: "新しい施策",
    priority: 0,
    questions: [
      { key: "interest", instructions: "関心のテーマを設定してください" },
    ],
    combination: "all",
    threshold: 0.7,
    maxShows: 1,
    presentation: { type: "modal", imageOnly: false },
    target: { mode: "all", paths: [] },
    content: {
      title: "おすすめ情報",
      body: "案内の本文",
      linkLabel: "詳しく見る",
      url: s.origins[0],
    },
  });
  sync();
  listCampaigns();
  tab("campaign");
  dirty();
});
bind("save", async () => {
  if (!revision) throw new Error("先に設定を読み込んでください");
  stage();
  const result = await api("config", {
    method: "PUT",
    headers: { "If-Match": revision },
    body: JSON.stringify(configuration),
  });
  revision = result.revision;
  $("saveState").textContent = "設定を保存しました";
});
bind("importJson", async () => {
  const next = JSON.parse($("config").value);
  if (
    next.version !== 1 ||
    !Array.isArray(next.sites) ||
    !next.sites.length ||
    next.sites.some(
      (s) => !Array.isArray(s.campaigns) || !Array.isArray(s.origins),
    )
  )
    throw new Error("サイト設定JSONの構造を確認してください。");
  configuration = next;
  sync();
  render();
  dirty();
});
bind("resetDesign", async () => {
  if (!site()) throw new Error("先に設定を読み込んでください");
  fillDesign(structuredClone(DEFAULT_DESIGN));
  dirty();
  updatePreview();
});
bind("openPreview", async () => {
  if (!site()) throw new Error("先に設定を読み込んでください");
  const offer = formOffer();
  if (offer.presentation.type === "custom")
    throw new Error("独自コードはテストサイトで確認してください");
  fullPreview?.destroy();
  fullPreview = renderOffer(window, offer, {
    onClose() {
      fullPreview = null;
    },
  });
  await fullPreview.ready;
});
window.addEventListener("pagehide", () => {
  preview?.destroy();
  fullPreview?.destroy();
});
fillDesign(DEFAULT_DESIGN);
updatePreview();

bind("addSite", async () => {
  if (!configuration) throw new Error("先に設定を読み込んでください");
  const id = $("newSiteId").value.trim();
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
    ["__proto__", "constructor", "prototype"].includes(id)
  )
    throw new Error(
      "サイトIDを英数字・ハイフン・アンダースコアで指定してください",
    );
  if (configuration.sites.some((s) => s.id === id))
    throw new Error("そのサイトIDは既に使用されています");
  if (configuration.sites.length >= 100)
    throw new Error("サイト数の上限に達しています");
  stage();
  configuration.sites.push({
    id,
    origins: ["https://example.com"],
    allowedPathPrefixes: ["/"],
    excludedPathPrefixes: ["/account", "/checkout", "/search"],
    metadataEnabled: false,
    actionNames: [],
    factNames: [],
    minVisibleMs: 5000,
    minQualifiedVisits: 2,
    campaigns: [],
    design: structuredClone(DEFAULT_DESIGN),
    allowCustomJavaScript: false,
  });
  siteId = id;
  campaignId = undefined;
  sync();
  render();
  dirty();
});
