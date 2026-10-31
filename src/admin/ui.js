import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { guidedQuestions } from "../questions.js";
import { renderOffer } from "../offer-renderer.js";
import { DEFAULT_DESIGN } from "../offer-model.js";
import { bytesToBase64 } from "./crypto.js";
const $ = (id) => document.getElementById(id);
const esc = (v) =>
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
const paths = {
  home: "M3 10l7-6 7 6M5 9v8h10V9M8 17v-5h4v5",
  campaigns: "M3 5h14v12H3zM6 3v4M14 3v4M3 9h14M6 12h3M6 14h6",
  settings:
    "M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1 1M14 14l1 1M5 15l1-1M14 6l1-1M13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  debug: "M7 3h6M10 3v4M5 8h10v9H5zM3 10h2M15 10h2M3 14h2M15 14h2M8 11h4",
  users:
    "M12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M3 17v-2c0-4 12-4 12 0v2M15 4c4 0 4 5 1 6M17 12l1 4",
  plus: "M10 4v12M4 10h12",
  arrow: "M4 10h12M11 5l5 5-5 5",
  search: "M12 12l5 5M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0",
  key: "M8 12l-5 5M5 15l2 2M11 9a4 4 0 1 1 6-6 4 4 0 0 1-6 6",
  shield: "M10 2l7 3v5c0 4-4 7-7 8-3-1-7-4-7-8V5zM7 10l2 2 4-4",
  finger:
    "M4 12V9a6 6 0 0 1 12 0v3M7 13V9a3 3 0 0 1 6 0v5M10 8v5c0 3-1 5-3 6M4 15l-1 2M13 17l1 2M16 15v2",
  info: "M10 8v6M10 5v.1M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  chart: "M4 16V9M10 16V4M16 16v-5",
  logout: "M8 3H3v14h5M8 10h10M14 6l4 4-4 4",
  device: "M4 3h12v10H4zM2 16h16",
  dots: "M4 10h.1M10 10h.1M16 10h.1",
};
const icon = (name) =>
  `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`;

const state = {
  session: null,
  siteId: null,
  value: null,
  edit: null,
  tab: "audience",
  settingsTab: "general",
  dirty: false,
  busy: false,
};
const roleNames = {
  superuser: "Superuser",
  admin: "サイト管理者",
  editor: "編集者",
  viewer: "閲覧者",
};
const selectWidgets = new WeakMap();
let selectPopup = null,
  selectSequence = 0;
function closeSelectPopup(focus = false) {
  if (!selectPopup) return;
  const { menu, button } = selectPopup;
  menu.remove();
  button.setAttribute("aria-expanded", "false");
  button.removeAttribute("aria-activedescendant");
  selectPopup = null;
  if (focus && button.isConnected) button.focus();
}
function selectName(select) {
  return (
    select.getAttribute("aria-label") ||
    [...(select.labels?.[0]?.childNodes || [])]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join("")
      .trim() ||
    "選択してください"
  );
}
function positionSelectPopup() {
  if (!selectPopup) return;
  const { menu, button } = selectPopup,
    rect = button.getBoundingClientRect();
  const width = Math.min(
    innerWidth - 24,
    Math.max(
      rect.width,
      button.dataset.selectControl === "siteSwitcher" ? 285 : 210,
    ),
  );
  menu.style.width = width + "px";
  menu.style.left =
    Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + "px";
  const below = innerHeight - rect.bottom - 16,
    above = rect.top - 16;
  const height = Math.min(
    320,
    Math.max(100, below >= 150 || below >= above ? below : above),
  );
  menu.style.maxHeight = height + "px";
  menu.style.top =
    (below >= 150 || below >= above
      ? rect.bottom + 7
      : Math.max(8, rect.top - 7 - Math.min(menu.scrollHeight, height))) + "px";
}
function setSelectActive(index) {
  if (!selectPopup) return;
  const rows = selectPopup.rows;
  if (!rows.length) return;
  selectPopup.active = (index + rows.length) % rows.length;
  rows.forEach((row, i) =>
    row.classList.toggle("highlight", i === selectPopup.active),
  );
  const row = rows[selectPopup.active];
  selectPopup.button.setAttribute("aria-activedescendant", row.id);
  row.scrollIntoView({ block: "nearest" });
}
function chooseSelectValue(value) {
  if (!selectPopup) return;
  const { select, button } = selectPopup;
  const changed = select.value !== value;
  closeSelectPopup();
  select.value = value;
  if (changed) {
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  enhanceSelects();
  if (!$("modalRoot").querySelector('[role="dialog"]'))
    document.getElementById(button.id)?.focus();
}
function openSelectPopup(select, button) {
  if (button.disabled) return;
  if (selectPopup?.select === select) {
    closeSelectPopup(true);
    return;
  }
  closeSelectPopup();
  const menu = document.createElement("div");
  menu.className = "select-menu";
  menu.id = select.id + "--listbox";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", selectName(select));
  const rows = [];
  for (const [index, option] of [...select.options].entries()) {
    if (option.disabled) continue;
    const row = document.createElement("div");
    row.className = "select-option";
    row.id = select.id + "--option-" + index;
    row.dataset.value = option.value;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(option.selected));
    const text = document.createElement("span");
    text.className = "select-option-copy";
    const label = document.createElement("span");
    label.textContent = option.textContent;
    text.append(label);
    if (select.id === "siteSwitcher") {
      const current = state.session.sites.find((v) => v.id === option.value);
      const caption = document.createElement("small");
      caption.textContent =
        current.origins[0] + " · " + roleNames[current.role];
      text.append(caption);
    }
    row.append(text);
    const check = document.createElement("span");
    check.className = "select-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = option.selected ? "✓" : "";
    row.append(check);
    row.addEventListener("pointerdown", (e) => e.preventDefault());
    row.addEventListener("click", () => chooseSelectValue(option.value));
    row.addEventListener("pointermove", () => {
      if (selectPopup?.select === select) setSelectActive(rows.indexOf(row));
    });
    rows.push(row);
    menu.append(row);
  }
  document.body.append(menu);
  button.setAttribute("aria-expanded", "true");
  selectPopup = {
    select,
    button,
    menu,
    rows,
    active: 0,
    typed: "",
    typedAt: 0,
  };
  positionSelectPopup();
  setSelectActive(
    Math.max(
      0,
      rows.findIndex((row) => row.dataset.value === select.value),
    ),
  );
}
function enhanceSelects() {
  for (const select of document.querySelectorAll("select")) {
    let widget = selectWidgets.get(select);
    if (!widget) {
      if (!select.id) select.id = "select-" + ++selectSequence;
      const wrap = document.createElement("span");
      wrap.className = "custom-select";
      select.before(wrap);
      wrap.append(select);
      select.classList.add("select-native");
      select.setAttribute("aria-hidden", "true");
      select.tabIndex = -1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "select-trigger";
      button.id = select.id + "--trigger";
      button.dataset.selectControl = select.id;
      button.setAttribute("role", "combobox");
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-controls", select.id + "--listbox");
      button.setAttribute("aria-expanded", "false");
      const label = document.createElement("span");
      label.className = "select-value";
      button.append(label);
      const arrow = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      arrow.setAttribute("viewBox", "0 0 20 20");
      arrow.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(arrow.namespaceURI, "path");
      path.setAttribute("d", "M5 7l5 5 5-5");
      arrow.append(path);
      button.append(arrow);
      wrap.append(button);
      button.addEventListener("click", () => openSelectPopup(select, button));
      button.addEventListener("keydown", (event) => {
        const isOpen = selectPopup?.select === select;
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (!isOpen) openSelectPopup(select, button);
          else
            setSelectActive(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? selectPopup.rows.length - 1
                  : selectPopup.active + (event.key === "ArrowDown" ? 1 : -1),
            );
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (isOpen)
            chooseSelectValue(
              selectPopup.rows[selectPopup.active].dataset.value,
            );
          else openSelectPopup(select, button);
        } else if (event.key === "Escape" && isOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeSelectPopup(true);
        } else if (event.key === "Tab") closeSelectPopup();
        else if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!isOpen) openSelectPopup(select, button);
          const now = Date.now();
          selectPopup.typed =
            (now - selectPopup.typedAt > 700 ? "" : selectPopup.typed) +
            event.key.toLocaleLowerCase();
          selectPopup.typedAt = now;
          const index = selectPopup.rows.findIndex((row) =>
            row
              .querySelector(".select-option-copy>span")
              .textContent.toLocaleLowerCase()
              .startsWith(selectPopup.typed),
          );
          if (index >= 0) setSelectActive(index);
        }
      });
      for (const label of select.labels || [])
        label.addEventListener("click", (event) => {
          if (button.contains(event.target)) return;
          event.preventDefault();
          button.focus();
        });
      widget = { button, label };
      selectWidgets.set(select, widget);
    }
    widget.label.textContent =
      select.selectedOptions[0]?.textContent || "選択してください";
    widget.button.disabled = select.matches(":disabled");
    widget.button.setAttribute("aria-label", selectName(select));
  }
}
document.addEventListener("pointerdown", (event) => {
  if (
    selectPopup &&
    !selectPopup.menu.contains(event.target) &&
    !selectPopup.button.contains(event.target)
  )
    closeSelectPopup();
});
document.addEventListener(
  "scroll",
  (event) => {
    if (selectPopup && !selectPopup.menu.contains(event.target))
      closeSelectPopup();
  },
  true,
);
window.addEventListener("resize", positionSelectPopup);

const names = {
  home: "ホーム",
  campaigns: "施策一覧",
  settings: "サイト設定",
  diagnostics: "動作確認",
  members: "メンバー",
  account: "アカウント",
  installation: "JevSense管理",
};
const types = {
  modal: "モーダル",
  floating: "フローティング",
  bar: "通知バー",
  custom: "独自JavaScript",
};
const brand = () =>
  '<div class="brand"><span class="brandmark">j.</span><span class="brand-word">JevSense<span class="dot">.</span></span></div>';
const button = (label, action, kind = "", disabled = false) =>
  `<button type="button" class="button ${kind}" data-action="${esc(action)}" ${disabled ? "disabled" : ""}>${label}</button>`;
const info = (text) =>
  `<div class="info">${icon("info")}<span>${text}</span></div>`;
const heading = (eyebrow, title, description, action = "") =>
  `<div class="heading"><div><p class="eyebrow">${eyebrow}</p><h1>${esc(title)}</h1><p class="desc">${description}</p></div>${action}</div>`;
const field = (label, name, value = "", hint = "", options = {}) =>
  `<label class="field">${esc(label)}${options.area ? `<textarea name="${name}" aria-label="${esc(label)}" ${options.max ? `maxlength="${options.max}"` : ""} ${options.code ? 'class="code"' : ""}>${esc(value)}</textarea>` : `<input name="${name}" aria-label="${esc(label)}" type="${options.type || "text"}" value="${esc(value)}" ${options.required ? "required" : ""} ${options.max ? `maxlength="${options.max}"` : ""} ${options.min !== undefined ? `min="${options.min}"` : ""} ${options.step ? `step="${options.step}"` : ""} ${options.readonly ? "readonly" : ""}>`}${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;
const select = (label, name, value, values, hint = "") =>
  `<label class="field">${esc(label)}<select name="${name}" aria-label="${esc(label)}">${Object.entries(
    values,
  )
    .map(
      ([key, text]) =>
        `<option value="${esc(key)}" ${String(value) === key ? "selected" : ""}>${esc(text)}</option>`,
    )
    .join(
      "",
    )}</select>${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;
const check = (label, name, value, hint = "") =>
  `<label class="field"><span><input type="checkbox" name="${name}" ${value ? "checked" : ""}> ${esc(label)}</span>${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;
const lines = (value) =>
  String(value)
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
const sitePath = () =>
  `/admin/api/v2/sites/${encodeURIComponent(state.siteId)}`;
const canEdit = () => state.value && state.value.role !== "viewer";
const canManage = () => ["superuser", "admin"].includes(state.value?.role);
const globalAdmin = () => state.session?.user.globalRole === "superuser";
const errors = {
  unauthorized: "ログインが必要です。",
  csrf_rejected: "認証情報が変わりました。画面を再読み込みしてください。",
  forbidden: "この操作に必要な権限がありません。",
  config_changed_reload:
    "別の変更が保存されています。一覧へ戻り、再読み込みしてから編集してください。",
  last_superuser: "最後の有効なSuperuserは無効化・降格できません。",
  last_passkey:
    "最後のパスキーは削除できません。先に別のパスキーを追加してください。",
  authentication_failed:
    "パスキーで本人確認できませんでした。メールとパスキーを確認してください。",
  challenge_expired: "認証の有効期限が切れました。もう一度お試しください。",
  invitation_expired: "招待が期限切れ、使用済み、または取り消されています。",
  invitation_account_mismatch:
    "招待されたメールアドレスのアカウントでログインしてください。",
  recovery_invalid:
    "メールアドレス、復旧コードまたは復旧リンクを確認してください。",
  content_title_required: "表示タイトルを入力してください。",
  invalid_request: "入力内容を確認してください。",
  setup_unauthorized: "初回登録用の管理トークンを確認してください。",
  rate_limited: "操作が集中しています。少し待ってお試しください。",
  preview_target_rejected:
    "サイトの許可URL・収集範囲・施策の表示対象に一致するURLを指定してください。",
};
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").hidden = true), 6000);
}
let dialogResolve, previousFocus;
function closeDialog(value = false) {
  closeSelectPopup();
  $("modalRoot").replaceChildren();
  const resolve = dialogResolve;
  dialogResolve = null;
  resolve?.(value);
  previousFocus?.focus?.();
}
function dialog(
  title,
  body,
  actions = button("閉じる", "dialog-close"),
  extra = "",
) {
  closeDialog();
  previousFocus = document.activeElement;
  $("modalRoot").innerHTML =
    `<div class="modal-shade"><section class="modal ${extra}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><h2>${esc(title)}</h2>${body}<div class="actions">${actions}</div></section></div>`;
  enhanceSelects();
  $("modalRoot").querySelector('[role="dialog"]').focus();
}
function confirmAction(title, body, label = "実行する") {
  dialog(
    title,
    body,
    button("キャンセル", "dialog-close") +
      button(label, "dialog-yes", "primary"),
  );
  return new Promise((resolve) => (dialogResolve = resolve));
}
document.addEventListener("keydown", (event) => {
  const modal = $("modalRoot").querySelector('[role="dialog"]');
  if (!modal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeDialog();
  }
  if (event.key === "Tab") {
    const items = [
      ...modal.querySelectorAll(
        "button:not(:disabled),input:not(:disabled),textarea,select:not(.select-native),a[href]",
      ),
    ].filter((v) => v.getClientRects().length);
    if (!items.length) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const i = items.indexOf(document.activeElement);
    if (event.shiftKey && i <= 0) {
      event.preventDefault();
      items.at(-1).focus();
    } else if (!event.shiftKey && (i < 0 || i === items.length - 1)) {
      event.preventDefault();
      items[0].focus();
    }
  }
});
async function api(path, method = "GET", body, revision, retry = true) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (state.session?.csrf) headers["X-JevSense-CSRF"] = state.session.csrf;
  if (revision) headers["If-Match"] = revision;
  const r = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const data = await r.json();
  if (r.status === 428 && retry) {
    if (
      await confirmAction(
        "もう一度、本人確認をお願いします",
        "<p>重要な変更の前に、パスキーで本人確認します。</p>",
        "パスキーで確認",
      )
    ) {
      await authenticate("/auth/reauth");
      return api(path, method, body, revision, false);
    }
    throw Error("操作を取り消しました。");
  }
  if (!r.ok) {
    if (r.status === 401 && state.session) {
      state.session = null;
      state.dirty = false;
      renderAuth("login");
    }
    throw Error(
      (errors[data.error] ||
        `操作できませんでした（${data.error || r.status}）。`) +
        (data.issues?.length
          ? "\n" +
            data.issues
              .map((v) => v.path.join(".") + ": " + v.message)
              .join("\n")
          : ""),
    );
  }
  return data;
}
async function authenticate(prefix, email) {
  const request = await api(
    prefix + "/options",
    "POST",
    email ? { email } : {},
  );
  const response = await startAuthentication({ optionsJSON: request.options });
  return api(prefix + "/verify", "POST", {
    challengeId: request.challengeId,
    response,
  });
}
async function register(path, body) {
  const request = await api(path, "POST", body);
  const response = await startRegistration({ optionsJSON: request.options });
  return api("/auth/register/verify", "POST", {
    challengeId: request.challengeId,
    response,
  });
}
let authKind = "login",
  inviteToken = null,
  recoveryToken = null,
  invite = null;
function renderAuth(kind = "login") {
  authKind = kind;
  closeSelectPopup();
  let fields = "";
  let title = "おかえりなさい。",
    desc = "パスキーでログインして、あなたのサイトの施策を管理しましょう。";
  if (kind === "setup") {
    title = "JevSenseを、はじめる。";
    desc =
      "この環境の最初のSuperuserを登録します。既存サイトと施策は引き継がれます。";
    fields =
      field(
        "表示名",
        "displayName",
        "",
        "メンバー一覧などに表示する名前です。登録後にアカウント設定で変更できます。",
        { required: true, max: 80 },
      ) +
      field(
        "メールアドレス",
        "email",
        "",
        "ログインIDです。この段階ではメール所有確認は行いません。",
        { required: true, type: "email" },
      ) +
      field(
        "初回登録用の管理トークン",
        "bootstrapToken",
        "",
        "運用者が設定したADMIN_TOKENです。初回登録後はログインに使えません。",
        { required: true, type: "password" },
      );
  } else if (kind === "invite") {
    title = "チームに参加しませんか。";
    desc = "招待リンクを確認しました。";
    fields =
      info(
        `${esc(invite?.siteName)} · ${esc(invite?.email)} · ${roleNames[invite?.role] || ""}`,
      ) +
      (invite?.existingAccount
        ? field(
            "メールアドレス",
            "email",
            invite.email,
            "登録済みのパスキーでログインして参加します。",
            { type: "email", readonly: true },
          )
        : field(
            "表示名",
            "displayName",
            "",
            "環境内で共通の表示名です。後から変更できます。",
            { required: true, max: 80 },
          ));
  } else if (kind === "recover") {
    title = "パスキーが使えないとき。";
    desc =
      "事前に保存した復旧コード、またはSuperuserから受け取った復旧リンクで新しいパスキーを登録します。登録後は、以前のパスキーとログイン状態が無効になります。";
    fields =
      field("メールアドレス", "email", "", "", {
        required: true,
        type: "email",
      }) +
      (recoveryToken
        ? info("期限付きの復旧リンクを使用します。")
        : field("リカバリーコード", "code", "", "一度だけ使えます。", {
            required: true,
          }));
  } else
    fields = field(
      "メールアドレス",
      "email",
      "",
      "Face ID・Touch ID・端末のPIN、セキュリティキー等で本人確認します。",
      { required: true, type: "email" },
    );
  $("app").innerHTML =
    `<div class="login"><section class="login-art">${brand()}<div class="login-copy"><p class="eyebrow">SENSE THE MOMENT.</p><h1>その人の、いまを。<br>ちょうどいい<br>コミュニケーションに。</h1><p>行動の先にある関心や文脈を捉えて、<br>ひとりひとりに、意味のある出会いを。</p></div><p class="login-bottom">JevSense · Personalization, with a sense of purpose.</p></section><section class="login-form"><div class="login-inner"><div class="fingerprint">${icon("finger")}</div><p class="eyebrow">${kind === "login" ? "WELCOME BACK" : "YOUR ACCOUNT"}</p><h1>${title}</h1><p class="desc">${desc}</p><form data-form="auth">${fields}<button class="button primary wide" type="submit">${kind === "login" ? "パスキーでログイン" : kind === "invite" && invite?.existingAccount ? "ログインして招待を受ける" : "パスキーを登録する"} ${icon("arrow")}</button><p id="authError" class="error-note" role="alert"></p></form><div class="login-foot">${button(kind === "recover" ? "ログインに戻る" : "パスキーが使えない場合", kind === "recover" ? "auth-login" : "auth-recover", "text-button")}</div></div></section></div>`;
}
async function refreshSession() {
  state.session = await api("/auth/session");
  if (!state.session.sites.some((s) => s.id === state.siteId))
    state.siteId = state.session.sites[0]?.id || null;
}
async function loadSite() {
  state.value = state.siteId ? await api(sitePath()) : null;
}
async function enter() {
  await refreshSession();
  if (inviteToken) {
    await api("/auth/invitation/accept", "POST", { token: inviteToken });
    inviteToken = null;
    await refreshSession();
  }
  await loadSite();
  state.dirty = false;
  state.edit = null;
  history.replaceState(null, "", "/admin#/home");
  await render();
}
async function navigate(route) {
  if (
    state.dirty &&
    !(await confirmAction(
      "未保存の変更があります",
      "<p>移動すると、保存していない変更は破棄されます。</p>",
      "破棄して移動",
    ))
  )
    return;
  state.dirty = false;
  state.edit = null;
  state.tab = "audience";
  if (location.hash === "#/" + route) await render();
  else location.hash = "/" + route;
}
function shell(route, body) {
  const current = state.session.sites.find((s) => s.id === state.siteId);
  const user = state.session.user;
  const nav = ["home", "campaigns", "settings", "diagnostics", "members"];
  return `<aside class="sidebar">${brand()}<p class="nav-label">SITE WORKSPACE</p><nav class="nav" aria-label="サイトのメニュー">${nav.map((r) => `<a href="#/${r}" data-nav="${r}" class="${route === r ? "active" : ""}">${icon({ members: "users", diagnostics: "debug" }[r] || r)}<span class="nav-text">${names[r]}</span></a>`).join("")}</nav><div class="sidebar-bottom"><p class="sidebar-note">A little sense.<br>A better connection.</p>${globalAdmin() ? `<nav class="nav"><a href="#/installation" data-nav="installation" class="${route === "installation" ? "active" : ""}">${icon("shield")}<span class="nav-text">JevSense管理</span></a></nav>` : ""}<a class="account-link" href="#/account" data-nav="account" aria-label="アカウント・パスキー"><span class="avatar">${esc(user.displayName.slice(0, 2))}</span><span class="account-text">${esc(user.displayName)}<small>${esc(user.email)}</small></span></a></div></aside><div class="shell"><header class="topbar"><div class="site-picker"><span class="site-avatar">${esc((current?.name || "J").slice(0, 1))}</span><div><small>選択中のサイト</small><select id="siteSwitcher" aria-label="サイトを切り替える">${state.session.sites.map((s) => `<option value="${s.id}" ${s.id === state.siteId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div></div><div class="top-actions"><span class="environment-label">${esc(state.session.environmentName || "JevSense")}</span><span class="role-chip">${roleNames[state.value?.role || user.globalRole] || "メンバー"}</span>${button("ログアウト", "logout", "small")}</div></header><main class="main"><div class="crumb"><span>${esc(current?.name || "JevSense")}</span><span>/</span><span>${names[route] || "施策の編集"}</span></div>${body}</main></div>`;
}
function allCampaigns() {
  const result = new Map(
    state.value.site.campaigns.map((c) => [
      c.id,
      { campaign: c, published: c, draft: null },
    ]),
  );
  for (const d of state.value.drafts)
    result.set(d.campaignId, {
      campaign: d.campaign,
      published: result.get(d.campaignId)?.published,
      draft: d,
    });
  return [...result.values()];
}
function campaignTable(rows) {
  return `<div class="table-wrap"><table><thead><tr><th>状態</th><th>施策名 / 対象者</th><th>表示形式</th><th>対象ページ</th><th>操作</th></tr></thead><tbody>${rows.length ? rows.map(({ campaign: c, published, draft }) => `<tr><td><span class="badge ${published?.enabled ? "active" : draft ? "draft" : "paused"}">${published?.enabled ? "配信中" : draft ? "下書き" : "停止中"}</span>${draft && published ? "<small>変更の下書きあり</small>" : ""}</td><td class="title"><button class="row-link" data-open="${c.id}">${esc(c.name || c.content.title)}</button><small>${esc(c.judgment?.conditions.join(" / ") || c.intent)}</small></td><td><span class="pill">${types[c.presentation.type]}</span></td><td>${c.target.mode === "all" ? "すべて" : esc(c.target.paths.join(", "))}</td><td><div class="row-actions"><button class="button small" data-open="${c.id}">${canEdit() ? "編集" : "表示"}</button><button class="button small" data-preview="${c.id}" ${canEdit() && (c.presentation.type !== "custom" || canManage()) ? "" : "disabled"}>プレビュー</button>${published && canEdit() ? `<button class="button small" data-toggle="${c.id}">${published.enabled ? "停止" : "再開"}</button>` : ""}</div></td></tr>`).join("") : '<tr><td colspan="5" class="empty">まだ施策がありません。新しい施策から作成してください。</td></tr>'}</tbody></table></div>`;
}
function newCampaign() {
  return {
    id: "c_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
    name: "",
    enabled: false,
    intent: "判定条件を入力してください",
    judgment: { offer: "", conditions: [""] },
    questions: [{ key: "draft", instructions: "下書き" }],
    combination: "all",
    threshold: 0.7,
    priority: 50,
    maxShows: 1,
    target: { mode: "all", paths: [] },
    presentation: { type: "modal", imageOnly: false },
    content: { title: "", body: "", linkLabel: "" },
  };
}
function editor() {
  const c = state.edit;
  const disabled =
    !canEdit() || (c.presentation.type === "custom" && !canManage());
  let fields = "";
  if (state.tab === "audience") {
    fields = field(
      "施策名",
      "name",
      c.name || c.content.title,
      "管理するための名前です。サイト上には表示されません。",
      { max: 120 },
    );
    if (c.judgment)
      fields +=
        field(
          "何を伝えたいですか？",
          "judgment.offer",
          c.judgment.offer,
          "案内する商品・サービス・記事などを具体的に。例：吸汗速乾ポロシャツの特集を案内する。",
          { area: true, max: 400 },
        ) +
        c.judgment.conditions
          .map(
            (condition, i) =>
              field(
                `どんな関心・状態に当てはまる人ですか？${i ? `（条件${i + 1}）` : ""}`,
                `judgment.conditions.${i}`,
                condition,
                "1つの関心・状態を、そのまま「〜が当てはまりますか？」と聞ける文章で書きます。",
                { area: true, max: 400 },
              ) +
              (i
                ? button(
                    "この条件を削除",
                    `condition-remove:${i}`,
                    "small",
                    disabled,
                  )
                : ""),
          )
          .join("") +
        button(
          "判定する関心・状態を追加",
          "condition-add",
          "small",
          disabled || c.judgment.conditions.length >= 5,
        ) +
        `<details class="question-examples"><summary>書き方の例</summary><p>EC：吸汗速乾機能のあるポロシャツに関心がある。<br>BtoB：複数部門で顧客情報を共有する課題に関心がある。<br>メディア：家庭向けの省エネ対策に関心がある。<br>採用：エンジニアの開発環境に関心がある。</p><p>「買ってくれそう」「施策が効きそう」という予測は避けてください。確定条件と複数条件のAND/ORはコードで扱います。生成AIによる文章変換は行いません。</p></details><div id="questionPreview"></div>`;
    else
      fields +=
        info(
          "既存の施策は登録済みの判定質問を保持しています。入力支援へ切り替えると、入力した案内内容と条件から質問を組み立てます。",
        ) +
        field("既存の意図メモ", "intent", c.intent, "", {
          area: true,
          max: 1000,
        }) +
        field(
          "判定質問（JSON）",
          "questionsJSON",
          JSON.stringify(c.questions, null, 2),
          "質問ごとに独立した1つの判断を聞きます。",
          { area: true, code: true },
        ) +
        button("入力支援に切り替える", "guided", "small", disabled);
    fields +=
      select("複数の判定の組み合わせ", "combination", c.combination, {
        all: "すべてに該当（AND）",
        any: "いずれかに該当（OR）",
      }) +
      field(
        "判定の閾値",
        "threshold",
        c.threshold,
        "この値を上回る判定値を対象とします。購入率や施策効果の予測ではありません。",
        { type: "number", min: 0.5, step: 0.01 },
      );
  } else if (state.tab === "content")
    fields =
      select(
        "表示形式",
        "presentation.type",
        c.presentation.type,
        Object.fromEntries(
          Object.entries(types).filter(
            ([key]) => key !== "custom" || canManage(),
          ),
        ),
        "基本デザインはサイト設定で共通管理します。",
      ) +
      field(
        "表示タイトル",
        "content.title",
        c.content.title,
        "実際にサイト上へ表示するタイトルです。",
        { required: true, max: 120 },
      ) +
      field("メッセージ", "content.body", c.content.body, "", {
        area: true,
        max: 500,
      }) +
      field("ボタンの文言", "content.linkLabel", c.content.linkLabel, "", {
        max: 60,
      }) +
      field(
        "リンク先URL",
        "content.url",
        c.content.url || "",
        "HTTPSのURLを指定してください。",
        { type: "url" },
      ) +
      field(
        "画像URL",
        "content.imageUrl",
        c.content.imageUrl || "",
        "HTTPS画像。サイトのCSPでも許可してください。",
        { type: "url" },
      ) +
      field(
        "画像の代替テキスト",
        "content.imageAlt",
        c.content.imageAlt || "",
        "画像の内容を説明してください。",
        { max: 160 },
      ) +
      check(
        "画像のみで表示する",
        "presentation.imageOnly",
        c.presentation.imageOnly,
      ) +
      (c.presentation.type === "custom"
        ? info(
            "独自JavaScriptはサイトと同じ権限で実行されます。信頼できるコードのみ登録してください。自動でサンドボックス化されません。",
          ) +
          field(
            "独自JavaScript",
            "custom.code",
            c.custom?.code ||
              'export function render(context) {\n  const box = context.mount.ownerDocument.createElement("div");\n  box.textContent = context.variables.message || context.content.title;\n  context.mount.append(box);\n  context.reportShown();\n}',
            "export function render(context) を記述。APIはマニュアルを参照してください。",
            { area: true, code: true },
          ) +
          field(
            "JavaScriptへ渡す文字列（JSON）",
            "variablesJSON",
            JSON.stringify(c.custom?.variables || {}, null, 2),
            '例：{"message":"ご案内"}。個人情報や秘密情報は入れないでください。',
            { area: true, code: true },
          )
        : "");
  else
    fields =
      select("表示するページ", "target.mode", c.target.mode, {
        all: "許可された全ページ",
        exact: "完全一致",
        prefix: "前方一致",
      }) +
      field(
        "対象のパス",
        "target.paths",
        c.target.paths.join("\n"),
        "1行に1つ。例：/ja/。クエリ・フラグメントは含めません。",
        { area: true },
      ) +
      field(
        "表示回数の上限",
        "maxShows",
        c.maxShows,
        "同じブラウザの履歴が有効な間の上限です。",
        { type: "number", min: 1 },
      ) +
      field(
        "優先順位",
        "priority",
        c.priority,
        "複数が対象の場合は大きい値を優先します（0〜100）。",
        { type: "number", min: 0 },
      ) +
      select(
        "配信を除外する確定状態",
        "excludeFact",
        c.excludeFact || "",
        {
          "": "指定しない",
          ...Object.fromEntries(state.value.site.factNames.map((v) => [v, v])),
        },
        "任意連携された状態がtrueなら除外します。",
      ) +
      info(
        "下書き保存では配信されません。「配信内容を確認」で内容を確認してから配信開始します。公開中の施策を編集しても、配信開始まで以前の内容が使われます。",
      );
  return (
    heading(
      "CAMPAIGN EDITOR",
      c.name || "新しい施策をつくる。",
      "対象者を決めて、伝える内容と配信条件を整えます。",
      button("一覧へ戻る", "back"),
    ) +
    `<div class="grid2"><div><section class="card"><div class="tabs">${Object.entries(
      {
        audience: "対象者・条件",
        content: "表示コンテンツ",
        delivery: "配信設定",
      },
    )
      .map(([key, label]) =>
        button(label, "tab:" + key, state.tab === key ? "selected" : ""),
      )
      .join(
        "",
      )}</div><form id="campaignForm" class="card-body"><fieldset ${disabled ? "disabled" : ""}>${fields}</fieldset></form></section><div class="editor-footer"><span id="dirtyState">${state.dirty ? "未保存の変更があります" : "保存済みの内容です"}</span><div class="actions">${state.value.drafts.some((d) => d.campaignId === c.id) ? button("下書きを破棄", "discard-draft", "", disabled) : ""}${button("下書き保存", "save-draft", "", disabled)}${button("配信内容を確認", "review-campaign", "primary", disabled)}</div></div></div><aside class="card preview-card"><header class="card-header"><h3>表示のイメージ</h3><span class="pill">プレビュー</span></header><div class="preview-stage" id="previewStage"></div><p class="preview-caption">サイトの共通デザインを適用します。独自JavaScriptは実ページで確認してください。</p></aside></div>`
  );
}
function updateQuestionPreview() {
  if (!$("questionPreview")) return;
  let questions;
  try {
    questions = guidedQuestions(state.edit.judgment);
  } catch {
    questions = [];
  }
  $("questionPreview").innerHTML =
    `<div class="question-panel"><h3>Jevに送る判定質問</h3><p class="hint">入力した文章を固定の型へ当てはめます。別の質問の回答は参照しません。</p>${questions.length ? questions.map((q, i) => `<pre>${i + 1}. ${esc(q.instructions)}</pre>`).join("") : "<p>案内する内容と関心・状態を入力すると表示されます。</p>"}${state.edit.judgment?.conditions.some((c) => /かつ|または|あるいは|および/.test(c)) ? '<p class="review-warning">複数の判断が含まれていないか確認してください。必要なら条件を分け、AND/ORを設定します。</p>' : ""}</div>`;
}
let previewHandle;
function updateMiniPreview() {
  previewHandle?.destroy?.();
  if (!$("previewStage")) return;
  try {
    const isDesign =
      location.hash === "#/settings" && state.settingsTab === "design";
    let design = structuredClone(state.value.site.design);
    if (isDesign) {
      const form = document.querySelector('form[data-form="settings"]');
      for (const [key, value] of new FormData(form)) {
        const parts = key.split(".").slice(1);
        let dest = design;
        for (const part of parts.slice(0, -1)) dest = dest[part];
        dest[parts.at(-1)] =
          ["font", "position"].includes(parts.at(-1)) || parts[0] === "colors"
            ? value
            : Number(value);
      }
    }
    const offer = isDesign
      ? {
          id: "design-preview",
          presentation: { type: state.designType || "modal" },
          content: {
            title: "その人に、ちょうどいいご案内。",
            body: "色・余白・フォントの調整を、このサイト共通のデザインとして確認できます。",
            linkLabel: "詳しく見る",
            url: "https://example.com",
          },
        }
      : structuredClone(state.edit);
    offer.design = design;
    offer.content.title ||= "表示タイトル";
    offer.content.body ||=
      "「表示コンテンツ」で入力すると、ここに表示のイメージを確認できます。";
    previewHandle = renderOffer(window, offer, {
      preview: true,
      mount: $("previewStage"),
    });
  } catch {
    $("previewStage").textContent =
      "コンテンツを入力すると表示イメージが確認できます。";
  }
}
function settingsPage() {
  const site = state.value.site;
  const d = site.design;
  let body = "";
  if (state.settingsTab === "general")
    body =
      field(
        "サイト名",
        "name",
        site.name || site.id,
        "ヘッダーに表示する名前です。",
        { required: true, max: 80 },
      ) +
      field(
        "サイトID",
        "id",
        site.id,
        "設置タグと連携するIDです。変更できません。",
        { readonly: true },
      ) +
      field(
        "許可するオリジン",
        "origins",
        site.origins.join("\n"),
        "1行に1つ。パスは含めません。例：https://adobe.customer-experience.dev",
        { area: true },
      ) +
      field(
        "収集する経路",
        "allowedPathPrefixes",
        site.allowedPathPrefixes.join("\n"),
        "前方一致。例：/ja/。ページ別の設定は不要です。",
        { area: true },
      ) +
      field(
        "収集しない経路",
        "excludedPathPrefixes",
        site.excludedPathPrefixes.join("\n"),
        "フォーム・マイページ等の経路を指定してください。",
        { area: true },
      ) +
      check(
        "メタデータ送信を有効にする",
        "metadataEnabled",
        site.metadataEnabled,
        "公開するページの名称・説明・種類・テーマ等を確認したうえで有効にしてください。",
      ) +
      field(
        "有効な閲覧とみなす表示時間（ミリ秒）",
        "minVisibleMs",
        site.minVisibleMs,
        "生の表示時間はブラウザとAPIで扱い、Jevへの入力はAPIで整形します。",
        { type: "number", min: 1000 },
      ) +
      field(
        "判定に必要な有効閲覧数",
        "minQualifiedVisits",
        site.minQualifiedVisits,
        "1〜10。新しいページを開いたときは過去の有効閲覧も使ってすぐ確認します。",
        { type: "number", min: 1 },
      ) +
      field(
        "追加連携するイベント名",
        "actionNames",
        site.actionNames.join("\n"),
        "任意。1行に1つ。",
        { area: true },
      ) +
      field(
        "追加連携する状態名",
        "factNames",
        site.factNames.join("\n"),
        "任意。応募完了・カートあり等をsetFactで連携します。",
        { area: true },
      ) +
      check(
        "独自JavaScriptの登録・実行を許可する",
        "allowCustomJavaScript",
        site.allowCustomJavaScript,
        "サイト管理者・Superuserだけがコードを登録できます。信頼できるコードを使用してください。",
      );
  else
    body =
      info(
        "このサイトのすべての施策へ共通で適用するベースデザインです。保存すると配信中の施策にも反映されます。",
      ) +
      Object.entries({
        background: "背景色",
        text: "文字色",
        accent: "アクセント色",
        buttonText: "ボタン文字色",
      })
        .map(([key, label]) =>
          field(label, "design.colors." + key, d.colors[key], "", {
            type: "color",
          }),
        )
        .join("") +
      select("フォント", "design.font", d.font, {
        system: "システム標準",
        serif: "明朝系",
      }) +
      Object.entries({
        fontSize: "文字サイズ",
        radius: "角丸",
        padding: "内側の余白",
        "modal.width": "モーダルの幅",
        "modal.backdropOpacity": "モーダル背景の不透明度",
        "floating.width": "フローティングの幅",
        "floating.offset": "フローティングの余白",
      })
        .map(([key, label]) =>
          field(
            label,
            "design." + key,
            key.split(".").reduce((v, k) => v[k], d),
            "",
            { type: "number", step: key.includes("Opacity") ? 0.05 : 1 },
          ),
        )
        .join("") +
      select(
        "フローティングの位置",
        "design.floating.position",
        d.floating.position,
        { "bottom-right": "右下", "bottom-left": "左下" },
      ) +
      select("通知バーの位置", "design.bar.position", d.bar.position, {
        top: "上部",
        bottom: "下部",
      });
  return (
    heading(
      "SITE SETTINGS",
      "サイトの、らしさを整える。",
      "計測する範囲と共通デザインを管理します。",
    ) +
    `<div class="${state.settingsTab === "design" ? "grid2" : ""}"><section class="card"><div class="tabs">${button("基本設定", "settings-tab:general", state.settingsTab === "general" ? "selected" : "")}${button("共通デザイン", "settings-tab:design", state.settingsTab === "design" ? "selected" : "")}</div><form data-form="settings" class="card-body"><fieldset ${canManage() ? "" : "disabled"}>${body}<button class="button primary" type="submit">設定を保存</button></fieldset></form></section>${state.settingsTab === "design" ? `<aside class="card preview-card"><header class="card-header"><h3>共通デザインのプレビュー</h3></header><div class="card-body segmented">${["modal", "floating", "bar"].map((type) => button(types[type], "design-type:" + type, (state.designType || "modal") === type ? "selected" : "")).join("")}</div><div class="preview-stage" id="previewStage"></div><p class="preview-caption">入力の変更をここで確認できます。サイトへは保存した時点で反映します。</p></aside>` : ""}</div>`
  );
}
function diagnosticsPage() {
  const site = state.value.site;
  return (
    heading(
      "LIVE DIAGNOSTICS",
      "実際のサイトで、確かめる。",
      "自動取得した情報・送信内容・判定結果を、操作しているブラウザで確認できます。",
    ) +
    `<section class="card card-body"><h2>診断パネルを開く</h2>${info("サイト側に最新版のSDKタグが必要です。診断は通常の判定を観測します。履歴のサーバー保存や追加のJev呼び出しは行いません。サイトでの同意取得は別途必要です。")}<form data-form="debug">${field("確認するページURL", "url", site.origins[0] + site.allowedPathPrefixes[0], "登録済みのオリジンを指定してください。", { type: "url", required: true })}<button class="button primary" ${canEdit() ? "" : "disabled"} type="submit">実サイトで診断を開始</button></form><p id="launchStatus" role="status"></p><h3>ページに設置するタグ</h3><pre><code>${esc(`<script src="${location.origin}/sdk.js" data-site="${site.id}" data-api="${location.origin}"></script>`)}</code></pre><p class="hint">利用者の同意取得後に window.JevPersonalization.consent(true) を呼んでください。すでに同意取得が済むサイトでは data-consent="granted" を指定できます。閲覧者の履歴・表示済み状態はブラウザのsessionStorageに保持します。</p></section>`
  );
}
async function membersPage() {
  const data = await api(sitePath() + "/members");
  return (
    heading(
      "YOUR TEAM",
      "一緒につくる、メンバー。",
      "ユーザーは複数サイトに所属できます。権限はサイトごとに設定します。",
      canManage() ? button("メンバーを招待", "invite", "primary") : "",
    ) +
    info(
      "メール送信は行いません。有効期限24時間・1回限りの招待リンクを管理者が本人へ共有してください。メールアドレスはログインIDであり、メール所有確認済みを意味しません。",
    ) +
    `<section class="card"><div class="table-wrap"><table><thead><tr><th>メンバー</th><th>メール</th><th>権限</th><th></th></tr></thead><tbody>${data.members.map((m) => `<tr><td>${esc(m.displayName)}${m.status === "disabled" ? "（無効）" : ""}</td><td>${esc(m.email)}</td><td>${roleNames[m.role]}</td><td>${canManage() && m.role !== "superuser" ? `<button class="button small" data-member="${m.id}">権限を変更</button><button class="button small" data-member-remove="${m.id}">所属解除</button>` : ""}</td></tr>`).join("")}</tbody></table></div></section>${data.invitations.length ? `<h2>招待中</h2><section class="card card-body">${data.invitations.map((i) => `<div class="meta-row"><span>${esc(i.email)} · ${roleNames[i.role]} · ${new Date(i.expiresAt).toLocaleString()}</span><button class="button small" data-invite-revoke="${i.id}">取り消す</button></div>`).join("")}</section>` : ""}`
  );
}
async function accountPage() {
  const [keys, sessions] = await Promise.all([
    api("/admin/api/v2/passkeys"),
    api("/admin/api/v2/sessions"),
  ]);
  return (
    heading(
      "YOUR ACCOUNT",
      "あなたの、アカウント。",
      "表示名・パスキー・復旧方法を管理します。",
    ) +
    `<div class="grid2"><section class="card card-body"><h2>プロフィール</h2><form data-form="profile">${field("表示名", "displayName", state.session.user.displayName, "この環境の全サイトで共通です。", { required: true, max: 80 })}${field("メールアドレス", "email", state.session.user.email, "ログインIDです。この画面では変更できません。", { readonly: true })}<button class="button primary" type="submit">プロフィールを保存</button>${button("変更を取り消す", "profile-cancel")}</form><h2>パスキー</h2>${keys.passkeys.map((k) => `<div class="meta-row"><span>${esc(k.label)}<small>${k.backed_up ? "同期可能なパスキー" : "端末またはセキュリティキー"}</small></span><button class="button small" data-key-remove="${k.id}" ${keys.passkeys.length <= 1 ? "disabled" : ""}>削除</button></div>`).join("")}${button("別のパスキーを追加", "add-passkey")}<p class="hint">最後の1つは削除できません。別の端末やセキュリティキーも登録しておくと安心です。</p></section><section class="card card-body"><h2>復旧コード</h2><p>端末を失った場合に新しいパスキーを登録できます。コードは発行時に一度だけ表示します。再発行すると以前のコードは無効になります。</p>${button("復旧コードを発行・再発行", "recovery-codes")}<h2>ログイン中のセッション</h2>${sessions.sessions.map((s) => `<div class="meta-row"><span>${s.current ? "このブラウザ" : "別のログイン"}<small>最終利用 ${new Date(s.lastSeen).toLocaleString()}</small></span></div>`).join("")}${button("他のログインをすべて終了", "revoke-sessions")}<p class="hint">30分間操作しない場合、またはログインから12時間で再ログインが必要です。</p></section></div>`
  );
}
async function installationPage() {
  if (!globalAdmin()) return info("この画面はSuperuser専用です。");
  const [system, users, audit] = await Promise.all([
    api("/admin/api/v2/system"),
    api("/admin/api/v2/users"),
    api("/admin/api/v2/audit"),
  ]);
  state.system = system.settings;
  state.users = users.users;
  const settings = system.settings;
  return (
    heading(
      "INSTALLATION",
      "JevSense全体を、管理する。",
      "Superuserはすべてのサイト・ユーザー・環境設定を管理できます。",
      button("サイトを追加", "new-site", "primary"),
    ) +
    `<section class="card card-body"><h2>サイト一覧</h2>${state.session.sites.map((site) => `<div class="meta-row"><span><strong>${esc(site.name)}</strong><small>${esc(site.origins.join(", "))}</small></span><button class="button small" data-site="${site.id}">設定を開く</button></div>`).join("")}</section><h2>全ユーザー</h2><section class="card"><div class="table-wrap"><table><thead><tr><th>ユーザー</th><th>全体権限</th><th>状態</th><th>操作</th></tr></thead><tbody>${users.users.map((u) => `<tr><td>${esc(u.displayName)}<small>${esc(u.email)}</small></td><td>${u.globalRole === "superuser" ? "Superuser" : "一般ユーザー"}</td><td>${u.status === "active" ? "有効" : "無効"}</td><td><button class="button small" data-user="${u.id}">変更</button><button class="button small" data-user-recover="${u.id}" ${u.status === "active" ? "" : "disabled"}>復旧リンク</button></td></tr>`).join("")}</tbody></table></div></section><h2>環境設定</h2><section class="card card-body"><form data-form="system">${field("環境名", "name", settings.name, "", { required: true, max: 80 })}${field("Jevモデル名", "model", settings.model, "利用可能な実モデル名を指定してください。変更は次の判定から適用されます。", { required: true })}${field("1日あたりのAPI呼び出し上限", "dailyRequestBudget", settings.dailyRequestBudget, "0で新しい判定を停止します。", { type: "number", min: 0 })}${field("同時実行数の上限", "maxConcurrent", settings.maxConcurrent, "1〜100。", { type: "number", min: 1 })}<button class="button primary" type="submit">環境設定を保存</button></form><p class="hint">JEV_API_KEY・AUTH_SECRETは実行環境のシークレットで管理します。この画面から値を閲覧・保存しません。</p></section><h2>最近の管理操作</h2><section class="card card-body"><p class="hint">直近100件の管理操作です。閲覧者の行動履歴は記録しません。</p>${audit.events.map((e) => `<div class="meta-row"><span>${esc(e.action)}${e.siteId ? " · " + esc(e.siteId) : ""}</span><small>${new Date(e.createdAt).toLocaleString()}</small></div>`).join("")}</section>`
  );
}
let renderVersion = 0;
async function render() {
  if (!state.session) return;
  const generation = ++renderVersion;
  closeSelectPopup();
  previewHandle?.destroy?.();
  const route = location.hash.slice(2) || "home";
  let body;
  if (route === "account") body = await accountPage();
  else if (route === "installation") body = await installationPage();
  else if (!state.value)
    body = heading(
      "YOUR WORKSPACE",
      "所属サイトがありません。",
      "管理者からの招待を受けるか、SuperuserはJevSense管理からサイトを追加してください。",
    );
  else if (route.startsWith("campaign/")) {
    const id = route.slice(9);
    if (!state.edit || (id !== "new" && state.edit.id !== id)) {
      state.edit =
        id === "new"
          ? newCampaign()
          : structuredClone(
              allCampaigns().find((v) => v.campaign.id === id)?.campaign,
            );
      state.dirty = id === "new";
    }
    body = state.edit ? editor() : info("施策が見つかりません。");
  } else if (route === "settings") body = settingsPage();
  else if (route === "diagnostics") body = diagnosticsPage();
  else if (route === "members") body = await membersPage();
  else {
    const rows = allCampaigns();
    body =
      heading(
        route === "campaigns" ? "CAMPAIGNS" : "YOUR WORKSPACE",
        route === "campaigns"
          ? "伝えたいことを、ちょうどいい人へ。"
          : `こんにちは、${state.session.user.displayName}さん。`,
        "施策の対象者・内容・配信状況を確認できます。",
        button(
          icon("plus") + "新しい施策",
          "new-campaign",
          "primary",
          !canEdit(),
        ),
      ) +
      (route === "campaigns"
        ? `<div class="filters">${field("施策を検索", "campaignSearch", "", "名前や対象者で検索")}${select("配信状態", "campaignFilter", "all", { all: "すべて", active: "配信中", draft: "下書きあり", paused: "停止中" })}</div>`
        : `<div class="stats"><div class="card stat"><label>配信中の施策</label><div class="number">${rows.filter((v) => v.published?.enabled).length}<small>件</small></div><span class="stat-icon">${icon("campaigns")}</span></div><div class="card stat"><label>変更の下書き</label><div class="number">${state.value.drafts.length}<small>件</small></div><span class="stat-icon">${icon("settings")}</span></div><div class="card stat"><label>登録されている施策</label><div class="number">${rows.length}<small>件</small></div><span class="stat-icon">${icon("chart")}</span></div></div>`) +
      `<section class="card" id="campaignTable">${campaignTable(rows)}</section>`;
  }
  if (generation !== renderVersion) return;
  $("app").innerHTML = shell(
    route.startsWith("campaign/") ? "campaigns" : route,
    body,
  );
  enhanceSelects();
  updateQuestionPreview();
  updateMiniPreview();
}
function readEditor() {
  const form = $("campaignForm");
  if (!form) return;
  for (const [key, value] of new FormData(form)) {
    if (key === "questionsJSON") {
      try {
        state.edit.questions = JSON.parse(value);
      } catch {
        throw Error("判定質問のJSONを確認してください。");
      }
      continue;
    }
    if (key === "variablesJSON") {
      state.edit.custom ??= { code: "", variables: {} };
      try {
        state.edit.custom.variables = JSON.parse(value);
      } catch {
        throw Error("JavaScriptへ渡す文字列のJSONを確認してください。");
      }
      continue;
    }
    let parsed = value;
    if (["threshold", "priority", "maxShows"].includes(key))
      parsed = Number(value);
    if (key === "target.paths") parsed = lines(value);
    if (
      [
        "content.url",
        "content.imageUrl",
        "content.imageAlt",
        "excludeFact",
      ].includes(key) &&
      !value
    ) {
      const path = key.split(".");
      if (path.length === 1) delete state.edit[key];
      else delete state.edit[path[0]][path[1]];
      continue;
    }
    let dest = state.edit;
    const parts = key.split(".");
    for (const part of parts.slice(0, -1)) dest = dest[part] ??= {};
    dest[parts.at(-1)] = parsed;
  }
  if (state.tab === "content") {
    state.edit.presentation.imageOnly = form.elements.namedItem(
      "presentation.imageOnly",
    ).checked;
    if (state.edit.presentation.type === "custom")
      state.edit.custom ??= { code: "", variables: {} };
  }
  if (state.edit.judgment) {
    state.edit.intent =
      (
        state.edit.judgment.offer +
        " / " +
        state.edit.judgment.conditions.join(" / ")
      ).slice(0, 1000) || "判定条件を入力してください";
  }
}
async function saveDraft() {
  readEditor();
  const c = state.edit;
  const draft = state.value.drafts.find((d) => d.campaignId === c.id);
  await api(
    sitePath() + `/campaigns/${c.id}/draft`,
    "PUT",
    c,
    draft?.revision || state.value.revision,
  );
  state.dirty = false;
  await loadSite();
  state.edit = structuredClone(
    state.value.drafts.find((d) => d.campaignId === c.id).campaign,
  );
  if (location.hash === "#/campaign/new")
    history.replaceState(null, "", "#/campaign/" + c.id);
  toast("下書きを保存しました。配信中の内容は配信開始まで維持されます。");
  await render();
}
let launch;
async function launchPage(kind, id, url, tab) {
  try {
    const data = await api(
      sitePath() + (kind === "preview" ? `/campaigns/${id}/preview` : "/debug"),
      "POST",
      { url },
    );
    const nonce = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    launch = { ...data, kind, tab, nonce, connected: false };
    const target = new URL(data.url);
    if (kind === "preview")
      target.hash =
        "jevsense-preview=" +
        encodeURIComponent(
          JSON.stringify({ origin: location.origin, nonce, hash: target.hash }),
        );
    tab.location.href = target.href;
    toast("確認するページを開きました。管理画面も開いたままにしてください。");
    setTimeout(() => {
      if (launch?.tab === tab && !launch.connected)
        toast(
          "SDKへ接続できません。タグの更新、CSP、ポップアップ、Cross-Origin-Opener-Policyを確認してください。",
        );
    }, 10000);
  } catch (e) {
    tab.close();
    throw e;
  }
}
window.addEventListener("message", (event) => {
  if (
    !launch ||
    Date.now() >= launch.expiresAt ||
    event.source !== launch.tab ||
    event.origin !== launch.origin ||
    event.data?.siteId !== launch.siteId
  )
    return;
  if (launch.kind === "preview") {
    if (event.data.nonce !== launch.nonce) return;
    if (event.data.type === "jevsense:preview-ready")
      launch.tab.postMessage(
        {
          type: "jevsense:preview-start",
          siteId: launch.siteId,
          nonce: launch.nonce,
          token: launch.token,
        },
        launch.origin,
      );
    if (event.data.type === "jevsense:preview-shown") {
      launch.connected = true;
      toast(
        "実ページへ確認表示しました。Jev呼び出しと表示回数の記録は行っていません。",
      );
    }
    if (event.data.type === "jevsense:preview-error")
      toast("確認表示ができませんでした。開いたページの案内をご確認ください。");
  } else {
    if (event.data.type === "jevsense:debug-ready")
      launch.tab.postMessage(
        {
          type: "jevsense:debug-start",
          siteId: launch.siteId,
          token: launch.token,
        },
        launch.origin,
      );
    if (event.data.type === "jevsense:debug-connected") {
      launch.connected = true;
      toast("診断パネルに接続しました。15分間有効です。");
    }
  }
});
function secretDialog(title, value, description) {
  dialog(
    title,
    `<p>${description}</p><textarea id="secretOutput" readonly aria-label="${esc(title)}">${esc(value)}</textarea><p class="hint">この画面を閉じると再表示できません。信頼できる方法で保管・共有してください。</p>`,
    button("コピー", "copy-secret") + button("閉じる", "dialog-close"),
  );
}
function markDirty() {
  state.dirty = true;
  if ($("dirtyState")) $("dirtyState").textContent = "未保存の変更があります";
}
async function handleAction(action) {
  if (action === "dialog-close") return closeDialog();
  if (action === "dialog-yes") return closeDialog(true);
  if (action === "auth-login" || action === "auth-recover")
    return renderAuth(action === "auth-login" ? "login" : "recover");
  if (action === "copy-secret") {
    await navigator.clipboard.writeText($("secretOutput").value);
    return toast("コピーしました。");
  }
  if (action.startsWith("design-type:")) {
    state.designType = action.slice(12);
    for (const btn of document.querySelectorAll(
      '[data-action^="design-type:"]',
    ))
      btn.classList.toggle(
        "selected",
        btn.dataset.action === "design-type:" + state.designType,
      );
    updateMiniPreview();
    return;
  }
  if (action === "profile-cancel") {
    state.dirty = false;
    return render();
  }
  if (action === "logout") {
    if (
      state.dirty &&
      !(await confirmAction(
        "未保存の変更があります",
        "<p>変更を破棄してログアウトします。</p>",
        "ログアウト",
      ))
    )
      return;
    await api("/auth/logout", "POST", {});
    state.session = null;
    state.dirty = false;
    renderAuth("login");
    return;
  }
  if (action === "new-campaign") return navigate("campaign/new");
  if (action === "back") return navigate("campaigns");
  if (action.startsWith("tab:")) {
    readEditor();
    state.tab = action.slice(4);
    return render();
  }
  if (action.startsWith("settings-tab:")) {
    if (
      state.dirty &&
      !(await confirmAction(
        "未保存の変更があります",
        "<p>設定の変更を破棄してタブを切り替えます。</p>",
        "切り替える",
      ))
    )
      return;
    state.dirty = false;
    state.settingsTab = action.slice(13);
    return render();
  }
  if (action === "condition-add") {
    readEditor();
    state.edit.judgment.conditions.push("");
    markDirty();
    return render();
  }
  if (action.startsWith("condition-remove:")) {
    readEditor();
    state.edit.judgment.conditions.splice(Number(action.slice(17)), 1);
    markDirty();
    return render();
  }
  if (action === "guided") {
    readEditor();
    state.edit.judgment = { offer: "", conditions: [""] };
    markDirty();
    return render();
  }
  if (action === "discard-draft") {
    if (
      !(await confirmAction(
        "下書きを破棄",
        "<p>保存済みの下書きと未保存の編集を破棄します。配信中の内容は維持されます。</p>",
        "破棄する",
      ))
    )
      return;
    const draft = state.value.drafts.find(
      (d) => d.campaignId === state.edit.id,
    );
    await api(
      sitePath() + `/campaigns/${state.edit.id}/draft`,
      "DELETE",
      undefined,
      draft.revision,
    );
    state.dirty = false;
    state.edit = null;
    await loadSite();
    toast("下書きを破棄しました。");
    return navigate("campaigns");
  }
  if (action === "save-draft") return saveDraft();
  if (action === "review-campaign") {
    readEditor();
    if (state.edit.judgment) guidedQuestions(state.edit.judgment);
    await saveDraft();
    const c = state.edit;
    if (
      await confirmAction(
        "配信内容を確認",
        `<p><strong>${esc(c.name || c.content.title)}</strong></p><p>表示：${types[c.presentation.type]}<br>対象：${c.target.mode === "all" ? "許可された全ページ" : esc(c.target.paths.join(", "))}</p><p>${esc(c.judgment?.offer || c.intent)}</p><p>この内容で配信を開始します。実サイトでの確認は、一覧のプレビューから実行できます。</p>`,
        "この内容で配信開始",
      )
    ) {
      const draft = state.value.drafts.find((d) => d.campaignId === c.id);
      await api(
        sitePath() + `/campaigns/${c.id}/publish`,
        "POST",
        {},
        draft.revision,
      );
      await loadSite();
      state.edit = null;
      state.dirty = false;
      toast("配信を開始しました。");
      return navigate("campaigns");
    }
    return;
  }
  if (action === "invite") {
    dialog(
      "メンバーを招待",
      `<form id="inviteForm">${field("メールアドレス", "email", "", "リンクを本人へ共有してください。", { type: "email", required: true })}${select("サイトの権限", "role", "editor", { admin: "サイト管理者", editor: "編集者", viewer: "閲覧者" }, "サイト管理者：設定・メンバー・コードを管理。編集者：通常の施策を編集。閲覧者：参照のみ。")}</form>`,
      button("キャンセル", "dialog-close") +
        button("招待リンクを発行", "issue-invite", "primary"),
    );
    return;
  }
  if (action === "issue-invite") {
    const form = $("inviteForm");
    if (!form.reportValidity()) return;
    const data = await api(
      sitePath() + "/invitations",
      "POST",
      Object.fromEntries(new FormData(form)),
    );
    secretDialog(
      "招待リンク",
      data.url,
      "有効期限は24時間、使用できるのは1回です。メールは自動送信しません。",
    );
    return;
  }
  if (action === "add-passkey") {
    dialog(
      "パスキーを追加",
      field(
        "パスキーの名前",
        "passkeyLabel",
        "",
        "例：仕事用PC、予備のセキュリティキー",
        { required: true, max: 80 },
      ),
      button("キャンセル", "dialog-close") +
        button("パスキーを登録", "register-passkey", "primary"),
    );
    return;
  }
  if (action === "register-passkey") {
    const label = document.querySelector('[name="passkeyLabel"]').value;
    await register("/admin/api/v2/passkeys/options", { label });
    closeDialog();
    toast("パスキーを追加しました。");
    return render();
  }
  if (action === "recovery-codes") {
    if (
      !(await confirmAction(
        "復旧コードを発行",
        "<p>以前の復旧コードはすべて無効になります。新しいコードを安全に保管してください。</p>",
        "発行する",
      ))
    )
      return;
    const data = await api("/admin/api/v2/recovery-codes", "POST", {});
    secretDialog(
      "復旧コード",
      data.codes.join("\n"),
      "各コードは1回だけ使用できます。復旧時には以前のパスキーとセッション、残りの復旧コードもすべて無効になります。復旧後に新しく発行してください。",
    );
    return;
  }
  if (action === "revoke-sessions") {
    if (
      await confirmAction(
        "他のログインを終了",
        "<p>このブラウザ以外のログイン状態を終了します。</p>",
      )
    ) {
      await api("/admin/api/v2/sessions/revoke-others", "POST", {});
      toast("他のログインを終了しました。");
      await render();
    }
    return;
  }
  if (action === "new-site") {
    dialog(
      "サイトを追加",
      `<form id="siteForm">${field("サイトID", "id", "", "英数字・ハイフン・アンダースコア。後から変更できません。", { required: true, max: 64 })}${field("サイト名", "name", "", "", { required: true, max: 80 })}${field("オリジン", "origin", "", "例：https://example.com", { required: true, type: "url" })}${field("収集する経路", "path", "/", "前方一致。フォーム等は追加後に除外経路を設定してください。", { required: true })}</form>`,
      button("キャンセル", "dialog-close") +
        button("サイトを追加", "create-site", "primary"),
    );
    return;
  }
  if (action === "create-site") {
    const form = $("siteForm");
    if (!form.reportValidity()) return;
    const f = Object.fromEntries(new FormData(form));
    await api("/admin/api/v2/sites", "POST", {
      id: f.id,
      name: f.name,
      origins: [f.origin],
      allowedPathPrefixes: [f.path],
      excludedPathPrefixes: [],
      metadataEnabled: false,
      actionNames: [],
      factNames: [],
      minVisibleMs: 8000,
      minQualifiedVisits: 1,
      campaigns: [],
      design: structuredClone(DEFAULT_DESIGN),
      allowCustomJavaScript: false,
    });
    closeDialog();
    await refreshSession();
    state.siteId = f.id;
    await loadSite();
    return navigate("settings");
  }
  if (action.startsWith("member-save:")) {
    const uid = action.slice(12);
    const role = document.querySelector('[name="memberRole"]').value;
    await api(sitePath() + "/members/" + uid, "PUT", { role });
    closeDialog();
    await refreshSession();
    await loadSite();
    return render();
  }
  if (action.startsWith("user-save:")) {
    const uid = action.slice(10);
    const f = Object.fromEntries(new FormData($("userForm")));
    await api("/admin/api/v2/users/" + uid, "PUT", f);
    closeDialog();
    if (uid === state.session.user.id) {
      state.session = null;
      state.dirty = false;
      return renderAuth("login");
    }
    toast("ユーザーを更新し、対象ユーザーのログインを終了しました。");
    return render();
  }
  if (action.startsWith("launch-preview:")) {
    const id = action.slice(15);
    const form = $("previewForm");
    if (!form.reportValidity()) return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) throw Error("ポップアップを許可してください。");
    const url = form.elements.url.value;
    closeDialog();
    return launchPage("preview", id, url, tab);
  }
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("button,a[data-nav]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "dialog-close" || action === "dialog-yes") {
    event.preventDefault();
    handleAction(action);
    return;
  }
  const nav = target.dataset.nav;
  if (nav) {
    event.preventDefault();
    run(() => navigate(nav));
    return;
  }
  if (target.dataset.open) {
    run(() => navigate("campaign/" + target.dataset.open));
    return;
  }
  if (target.dataset.action) {
    event.preventDefault();
    run(() => handleAction(action));
    return;
  }
  if (target.dataset.preview) {
    const id = target.dataset.preview;
    dialog(
      "実ページでプレビュー",
      `<p>保存済みの下書きがあれば、その内容を優先します。登録済みのサイトと表示対象に一致するページでのみ確認できます。サイトに最新版のSDKが必要です。</p><form id="previewForm">${field("確認するページURL", "url", state.value.site.origins[0] + state.value.site.allowedPathPrefixes[0], "判定・回数記録を行わず、このリンクで開いた1回だけ表示します。", { required: true, type: "url" })}</form>`,
      button("キャンセル", "dialog-close") +
        button("ページを開いて確認", `launch-preview:${id}`, "primary"),
    );
    return;
  }
  run(async () => {
    if (target.dataset.toggle) {
      const c = state.value.site.campaigns.find(
        (c) => c.id === target.dataset.toggle,
      );
      if (
        await confirmAction(
          c.enabled ? "施策を停止" : "配信を再開",
          `<p>${esc(c.name || c.content.title)}</p>`,
          c.enabled ? "停止する" : "再開する",
        )
      ) {
        await api(
          sitePath() + `/campaigns/${c.id}/stop`,
          "POST",
          { enabled: !c.enabled },
          state.value.revision,
        );
        await loadSite();
        await render();
      }
    }
    if (
      target.dataset.keyRemove &&
      (await confirmAction(
        "パスキーを削除",
        "<p>このパスキーではログインできなくなります。</p>",
        "削除する",
      ))
    ) {
      await api(
        "/admin/api/v2/passkeys/" +
          encodeURIComponent(target.dataset.keyRemove),
        "DELETE",
      );
      await render();
    }
    if (target.dataset.member) {
      dialog(
        "メンバーの権限を変更",
        select("サイトの権限", "memberRole", "editor", {
          admin: "サイト管理者",
          editor: "編集者",
          viewer: "閲覧者",
        }),
        button("キャンセル", "dialog-close") +
          button(
            "権限を変更",
            "member-save:" + target.dataset.member,
            "primary",
          ),
      );
    }
    if (
      target.dataset.memberRemove &&
      (await confirmAction(
        "サイトから所属を解除",
        "<p>このサイトへのアクセス権を失います。他サイトの所属は維持されます。</p>",
        "所属を解除",
      ))
    ) {
      await api(
        sitePath() + "/members/" + target.dataset.memberRemove,
        "DELETE",
      );
      await render();
    }
    if (target.dataset.inviteRevoke) {
      await api(
        sitePath() + "/invitations/" + target.dataset.inviteRevoke,
        "DELETE",
      );
      await render();
    }
    if (target.dataset.site) {
      if (
        state.dirty &&
        !(await confirmAction(
          "未保存の変更があります",
          "<p>変更を破棄して移動します。</p>",
        ))
      )
        return;
      state.siteId = target.dataset.site;
      state.dirty = false;
      await loadSite();
      await navigate("settings");
    }
    if (target.dataset.user) {
      const user = state.users.find((u) => u.id === target.dataset.user);
      dialog(
        "ユーザーの全体権限を変更",
        `<p>${esc(user.displayName)} · ${esc(user.email)}</p><form id="userForm">${select("全体権限", "globalRole", user.globalRole, { member: "一般ユーザー", superuser: "Superuser" })}${select("状態", "status", user.status, { active: "有効", disabled: "無効" })}</form><p class="hint">変更すると対象ユーザーのセッションをすべて終了します。最後の有効なSuperuserは保護されます。</p>`,
        button("キャンセル", "dialog-close") +
          button("変更を保存", "user-save:" + user.id, "primary"),
      );
    }
    if (
      target.dataset.userRecover &&
      (await confirmAction(
        "アカウント復旧リンクを発行",
        "<p>本人確認を行ってから共有してください。リンク使用後は以前のパスキーとログインが無効になります。</p>",
        "発行する",
      ))
    ) {
      const data = await api(
        "/admin/api/v2/users/" + target.dataset.userRecover + "/recovery",
        "POST",
        {},
      );
      secretDialog(
        "アカウント復旧リンク",
        data.url,
        "有効期限は5分間、使用できるのは1回です。",
      );
    }
  });
});
async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
  } catch (e) {
    toast(
      e.name === "NotAllowedError"
        ? "パスキー操作を取り消したか、認証できませんでした。"
        : e.message,
    );
  } finally {
    state.busy = false;
  }
}
document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  run(async () => {
    const f = Object.fromEntries(new FormData(form));
    if (form.dataset.form === "auth") {
      try {
        if (authKind === "setup") await register("/auth/setup/options", f);
        else if (authKind === "invite") {
          if (invite.existingAccount)
            await authenticate("/auth/login", invite.email);
          else {
            await register("/auth/invitation/register", {
              token: inviteToken,
              displayName: f.displayName,
            });
            inviteToken = null;
          }
        } else if (authKind === "recover")
          await register("/auth/recovery/options", {
            email: f.email,
            ...(recoveryToken ? { token: recoveryToken } : { code: f.code }),
          });
        else await authenticate("/auth/login", f.email);
        await enter();
      } catch (e) {
        $("authError").textContent =
          e.name === "NotAllowedError"
            ? "パスキー操作を取り消したか、認証できませんでした。"
            : e.message;
      }
      return;
    }
    if (form.dataset.form === "profile") {
      await api("/admin/api/v2/profile", "PUT", { displayName: f.displayName });
      state.dirty = false;
      await refreshSession();
      toast("表示名を保存しました。");
      return render();
    }
    if (form.dataset.form === "settings") {
      let settings = {};
      if (state.settingsTab === "general")
        settings = {
          name: f.name,
          origins: lines(f.origins),
          allowedPathPrefixes: lines(f.allowedPathPrefixes),
          excludedPathPrefixes: lines(f.excludedPathPrefixes),
          metadataEnabled: form.elements.metadataEnabled.checked,
          allowCustomJavaScript: form.elements.allowCustomJavaScript.checked,
          minVisibleMs: Number(f.minVisibleMs),
          minQualifiedVisits: Number(f.minQualifiedVisits),
          actionNames: lines(f.actionNames),
          factNames: lines(f.factNames),
        };
      else {
        const d = structuredClone(state.value.site.design);
        for (const [key, v] of Object.entries(f)) {
          const parts = key.split(".").slice(1);
          let dest = d;
          for (const part of parts.slice(0, -1)) dest = dest[part];
          dest[parts.at(-1)] =
            ["font", "position"].includes(parts.at(-1)) || parts[0] === "colors"
              ? v
              : Number(v);
        }
        settings.design = d;
      }
      await api(
        sitePath() + "/settings",
        "PUT",
        { settings },
        state.value.revision,
      );
      state.dirty = false;
      await refreshSession();
      await loadSite();
      toast("サイト設定を保存しました。");
      return render();
    }
    if (form.dataset.form === "system") {
      await api(
        "/admin/api/v2/system",
        "PUT",
        {
          ...f,
          dailyRequestBudget: Number(f.dailyRequestBudget),
          maxConcurrent: Number(f.maxConcurrent),
        },
        state.system.revision,
      );
      state.dirty = false;
      toast("環境設定を保存しました。");
      return render();
    }
    if (form.dataset.form === "debug") {
      const tab = window.open("about:blank", "_blank");
      if (!tab) throw Error("ポップアップを許可してください。");
      return launchPage("debug", null, f.url, tab);
    }
  });
});
document.addEventListener("input", (event) => {
  if (event.target.name?.startsWith("design.")) updateMiniPreview();
  if (event.target.closest("#campaignForm")) {
    markDirty();
    try {
      readEditor();
      updateQuestionPreview();
    } catch {}
  } else if (
    event.target.closest(
      'form[data-form="settings"],form[data-form="profile"],form[data-form="system"]',
    )
  )
    markDirty();
  if (["campaignSearch", "campaignFilter"].includes(event.target.name))
    filterCampaigns();
});
function filterCampaigns() {
  const query =
    document.querySelector('[name="campaignSearch"]')?.value.toLowerCase() ||
    "";
  const status =
    document.querySelector('[name="campaignFilter"]')?.value || "all";
  $("campaignTable").innerHTML = campaignTable(
    allCampaigns().filter(
      (v) =>
        (v.campaign.name + " " + v.campaign.intent)
          .toLowerCase()
          .includes(query) &&
        (status === "all" ||
          (status === "draft" && v.draft) ||
          (status === "active" && v.published?.enabled) ||
          (status === "paused" && v.published && !v.published.enabled)),
    ),
  );
}
document.addEventListener("change", (event) => {
  if (event.target.id === "siteSwitcher") {
    const id = event.target.value;
    event.target.value = state.siteId;
    enhanceSelects();
    run(async () => {
      if (
        state.dirty &&
        !(await confirmAction(
          "未保存の変更があります",
          "<p>変更を破棄してサイトを切り替えます。</p>",
          "切り替える",
        ))
      )
        return;
      state.siteId = id;
      state.dirty = false;
      state.edit = null;
      await loadSite();
      location.hash = "/home";
      await render();
    });
  }
  if (event.target.name === "presentation.type") {
    try {
      readEditor();
      markDirty();
      render();
    } catch (e) {
      toast(e.message);
    }
  } else if (event.target.closest("#campaignForm")) {
    try {
      readEditor();
      updateMiniPreview();
    } catch {}
  }
  if (event.target.name === "campaignFilter") filterCampaigns();
});
window.addEventListener("hashchange", () =>
  render().catch((e) => toast(e.message)),
);
window.addEventListener("beforeunload", (event) => {
  if (state.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
async function boot() {
  try {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (location.pathname === "/admin/invite") {
      inviteToken = fragment.get("token");
      history.replaceState(null, "", "/admin/invite");
      if (!inviteToken)
        throw Error("招待リンクを管理者から受け取って開いてください。");
      invite = await api("/auth/invitation/inspect", "POST", {
        token: inviteToken,
      });
      renderAuth("invite");
      return;
    }
    if (location.pathname === "/admin/recover") {
      recoveryToken = fragment.get("token");
      history.replaceState(null, "", "/admin/recover");
      renderAuth("recover");
      return;
    }
    const status = await api("/auth/status");
    if (!status.initialized) {
      renderAuth("setup");
      return;
    }
    try {
      await refreshSession();
      await loadSite();
      await render();
    } catch {
      renderAuth("login");
    }
  } catch (e) {
    $("app").innerHTML =
      `<main class="main">${brand()}<h1>JevSense</h1><p role="alert">${esc(e.message)}</p><a class="button" href="/admin">ログインへ戻る</a></main>`;
  }
}
boot();
