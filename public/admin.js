const $ = (id) => document.getElementById(id);
let revision, configuration, draft;
const editorFields = [
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
];
function updatePreview() {
  $("previewTitle").textContent =
    $("title").value || "あなたのオファーが、\nここに表示されます。";
  $("previewBody").textContent =
    $("body").value ||
    "タイトルとメッセージを入力すると、ここで内容を確認できます。";
  $("previewLink").textContent = $("linkLabel").value || "リンク文言";
  $("previewState").textContent =
    $("enabled").value === "true" ? "有効" : "停止";
  $("campaignName").textContent = $("campaign").value || "未選択";
}
for (const key of editorFields) {
  $(key).addEventListener("input", () => {
    updatePreview();
    if (configuration)
      $("saveState").textContent =
        "編集中 — 設定に反映してから保存してください";
  });
}
$("config").addEventListener("input", () => {
  if (configuration)
    $("saveState").textContent = "詳細設定に未保存の変更があります";
});
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
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}
function bind(id, action) {
  $(id).onclick = async () => {
    $(id).disabled = true;
    $(id).setAttribute("aria-busy", "true");
    $("status").closest("footer").classList.remove("has-error");
    try {
      await action();
      $("status").textContent = "完了しました";
    } catch (e) {
      $("status").textContent = e.message;
      $("status").closest("footer").classList.add("has-error");
    } finally {
      $(id).disabled = false;
      $(id).removeAttribute("aria-busy");
    }
  };
}
function sync() {
  $("config").value = JSON.stringify(configuration, null, 2);
}
function campaign() {
  return configuration?.sites
    .find((s) => s.id === $("site").value)
    ?.campaigns.find((c) => c.id === $("campaign").value);
}
function fill() {
  const c = campaign();
  if (!c) {
    for (const key of editorFields) $(key).value = "";
    $("enabled").value = "false";
    $("combination").value = "all";
    updatePreview();
    return;
  }
  for (const k of ["priority", "maxShows", "threshold", "combination"])
    $(k).value = c[k];
  $("enabled").value = String(c.enabled);
  $("campaignIntent").value = c.intent;
  for (const k of ["title", "body", "linkLabel", "url"])
    $(k).value = c.content[k];
  $("questions").value = c.questions.map((q) => q.instructions).join("\n");
  updatePreview();
}
function campaigns() {
  const site = configuration.sites.find((s) => s.id === $("site").value);
  $("campaign").replaceChildren(
    ...(site?.campaigns ?? []).map((c) => new Option(c.id, c.id)),
  );
  fill();
}
function render() {
  $("site").replaceChildren(
    ...configuration.sites.map((s) => new Option(s.id, s.id)),
  );
  campaigns();
}
$("site").onchange = campaigns;
$("campaign").onchange = fill;
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
  updatePreview();
  $("saveState").textContent =
    "質問案を取り込みました — 内容を確認してください";
});
bind("new", async () => {
  const site = configuration?.sites.find((s) => s.id === $("site").value);
  if (!site || site.campaigns.length >= 5)
    throw new Error("サイトを読み込んでください。施策は最大5件です");
  const id = "campaign_" + crypto.randomUUID().slice(0, 8);
  site.campaigns.push({
    id,
    enabled: false,
    intent: "新しい施策",
    priority: 0,
    questions: [
      { key: "interest", instructions: "関心のテーマを設定してください" },
    ],
    combination: "all",
    threshold: 0.7,
    maxShows: 1,
    content: {
      title: "おすすめ情報",
      body: "案内の本文",
      linkLabel: "詳しく見る",
      url: site.origins[0],
    },
  });
  sync();
  campaigns();
  $("campaign").value = id;
  fill();
  $("saveState").textContent =
    "新しい施策を作成しました — まだ保存されていません";
});
bind("apply", async () => {
  const c = campaign();
  if (!c) throw new Error("先に設定を読み込んでください");
  c.intent = $("campaignIntent").value;
  c.enabled = $("enabled").value === "true";
  for (const k of ["priority", "maxShows", "threshold"])
    c[k] = Number($(k).value);
  c.combination = $("combination").value;
  for (const k of ["title", "body", "linkLabel", "url"])
    c.content[k] = $(k).value;
  c.questions = $("questions")
    .value.split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((instructions, i) => ({ key: "q" + i, instructions }));
  sync();
  $("saveState").textContent = "設定に反映済み — 保存すると配信に適用されます";
});
bind("save", async () => {
  if (!revision) throw new Error("先に設定を読み込んでください");
  const result = await api("config", {
    method: "PUT",
    headers: { "If-Match": revision },
    body: JSON.stringify(JSON.parse($("config").value)),
  });
  revision = result.revision;
  $("saveState").textContent = "設定を保存しました";
});
