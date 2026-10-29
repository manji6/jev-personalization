const $ = (id) => document.getElementById(id);
let revision, configuration, draft;
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
    try {
      await action();
      $("status").textContent = "完了しました";
    } catch (e) {
      $("status").textContent = e.message;
    } finally {
      $(id).disabled = false;
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
  if (!c) return;
  for (const k of ["priority", "maxShows", "threshold", "combination"])
    $(k).value = c[k];
  $("enabled").value = String(c.enabled);
  $("campaignIntent").value = c.intent;
  for (const k of ["title", "body", "linkLabel", "url"])
    $(k).value = c.content[k];
  $("questions").value = c.questions.map((q) => q.instructions).join("\n");
}
function campaigns() {
  const site = configuration.sites.find((s) => s.id === $("site").value);
  $("campaign").replaceChildren(
    ...site.campaigns.map((c) => new Option(c.id, c.id)),
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
});
bind("save", async () => {
  if (!revision) throw new Error("先に設定を読み込んでください");
  const result = await api("config", {
    method: "PUT",
    headers: { "If-Match": revision },
    body: JSON.stringify(JSON.parse($("config").value)),
  });
  revision = result.revision;
});
