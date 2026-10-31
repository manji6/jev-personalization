import { renderOffer } from "./offer-renderer.js";
import { secureOrLoopback } from "./url-policy.js";
// Only a non-secret launch marker is put in the fragment. The ticket stays in the opener.
export function installPreview(win, { siteId, endpoint }) {
  if (!win.location.hash.startsWith("#jevsense-preview=")) return null;
  let launch;
  try {
    launch = JSON.parse(decodeURIComponent(win.location.hash.slice(18)));
  } catch {
    return null;
  }
  if (
    !win.opener ||
    !secureOrLoopback(launch.origin) ||
    !/^[-\w]{43}$/.test(launch.nonce) ||
    typeof launch.hash !== "string" ||
    (launch.hash && !launch.hash.startsWith("#")) ||
    launch.hash.length > 2048 ||
    new URL(launch.origin).origin !== launch.origin
  )
    return null;
  win.history.replaceState(
    win.history.state,
    "",
    win.location.pathname + win.location.search + (launch.hash || ""),
  );
  const opener = win.opener;
  let used = false;
  const host = win.document.createElement("div");
  host.setAttribute("data-jevsense-preview", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    '<style>:host{all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483647}div{font:13px system-ui;background:#233c31;color:white;padding:12px 18px;border-radius:8px;box-shadow:0 4px 24px #0003;max-width:330px}button{color:inherit;background:none;border:0;cursor:pointer;margin-left:12px}</style><div><span>JevSense・確認表示に接続しています…</span><button type="button">閉じる</button></div>';
  if (win.CSSStyleSheet && "adoptedStyleSheets" in root) {
    const style = root.querySelector("style"),
      sheet = new win.CSSStyleSheet();
    sheet.replaceSync(style.textContent);
    root.adoptedStyleSheets = [sheet];
    style.remove();
  }
  (win.document.body || win.document.documentElement).append(host);
  const status = root.querySelector("span");
  let handle,
    ended = false;
  const restoreHistory = [];
  function end() {
    if (ended) return;
    ended = true;
    handle?.destroy();
    for (const restore of restoreHistory) restore();
    host.remove();
    win.removeEventListener("message", receive);
    win.removeEventListener("popstate", end);
    win.removeEventListener("hashchange", end);
  }
  root.querySelector("button").onclick = end;
  win.addEventListener("popstate", end);
  win.addEventListener("hashchange", end);
  for (const method of ["pushState", "replaceState"]) {
    const original = win.history[method];
    const wrapped = (...args) => {
      const prior = win.location.href;
      const result = original.apply(win.history, args);
      if (prior !== win.location.href) end();
      return result;
    };
    win.history[method] = wrapped;
    restoreHistory.push(() => {
      if (win.history[method] === wrapped) win.history[method] = original;
    });
  }
  const send = (type, extra = {}) =>
    opener.postMessage(
      { type, siteId, nonce: launch.nonce, ...extra },
      launch.origin,
    );
  const timer = win.setTimeout(() => {
    if (!used)
      status.textContent =
        "接続できませんでした。管理画面から再度開いてください。";
    win.removeEventListener("message", receive);
  }, 10000);
  async function receive(event) {
    if (
      used ||
      event.source !== opener ||
      event.origin !== launch.origin ||
      event.data?.type !== "jevsense:preview-start" ||
      event.data.siteId !== siteId ||
      event.data.nonce !== launch.nonce
    )
      return;
    used = true;
    win.clearTimeout(timer);
    win.removeEventListener("message", receive);
    try {
      const r = await win.fetch(
        `${endpoint}/v1/preview/redeem?siteId=${encodeURIComponent(siteId)}`,
        {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: event.data.token,
            path: win.location.pathname,
            nonce: launch.nonce,
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      const data = await r.json();
      if (!r.ok || data.nonce !== launch.nonce || data.mode !== "preview")
        throw Error("rejected");
      if (ended) return;
      handle = renderOffer(win, data.campaign, {
        mode: "preview",
        async loadModule(path) {
          const u = new URL(path, endpoint);
          if (
            u.origin !== endpoint ||
            !/^\/v1\/preview\/module\/[-\w]{43}\.js$/.test(u.pathname) ||
            u.searchParams.get("siteId") !== siteId
          )
            throw Error("Invalid preview module");
          return import(u.href);
        },
        onShown() {
          status.textContent = "確認表示中：判定・回数記録は行っていません。";
          send("jevsense:preview-shown");
        },
        onClose() {
          status.textContent =
            "確認表示を閉じました。このページでは通常配信しません。";
        },
      });
      if (!handle || !(await handle.ready)) throw Error("render");
    } catch {
      status.textContent =
        "表示できませんでした。期限・URL・権限・サイトのCSPをご確認ください。";
      send("jevsense:preview-error");
    }
  }
  win.addEventListener("message", receive);
  send("jevsense:preview-ready");
  return {
    consent: async () => {},
    decide: async () => {},
    track() {},
    setFact() {},
  };
}
