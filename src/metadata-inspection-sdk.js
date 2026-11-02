import { extractPage, observePageMetadata } from "./metadata-extractor.js";
import { secureOrLoopback } from "./url-policy.js";
// This mode never starts the ordinary collector, model requests or offer renderer.
export function installMetadataInspection(
  win,
  { siteId, endpoint, credentials = "omit" },
) {
  const marker = "#jevsense-metadata=";
  if (!win.location.hash.startsWith(marker)) return null;
  const blocked = {
    async consent() {},
    async decide() {},
    track() {},
    setFact() {},
  };
  let launch;
  try {
    launch = JSON.parse(
      decodeURIComponent(win.location.hash.slice(marker.length)),
    );
  } catch {
    return blocked;
  }
  if (
    !win.opener ||
    !secureOrLoopback(launch?.origin) ||
    new URL(launch.origin).origin !== launch.origin ||
    !/^[-\w]{43}$/.test(launch.nonce) ||
    typeof launch.hash !== "string" ||
    launch.hash.length > 2048 ||
    (launch.hash && !launch.hash.startsWith("#"))
  )
    return blocked;
  win.history.replaceState(
    win.history.state,
    "",
    win.location.pathname + win.location.search + launch.hash,
  );
  const opener = win.opener,
    initialPath = win.location.pathname;
  let consent = false,
    used = false,
    ended = false,
    policy = null,
    expires = Date.now() + 300000,
    timer,
    mutationTimer,
    observer;
  const host = win.document.createElement("div");
  host.setAttribute("data-jevsense-metadata-inspection", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    '<style>:host{all:initial;position:fixed;left:12px;bottom:12px;z-index:2147483647}div{font:13px system-ui;color:#fff;background:#233c31;padding:12px 18px;border-radius:8px;max-width:350px}button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;margin-left:10px}</style><div><span></span><button type="button">終了</button></div>';
  if (win.CSSStyleSheet && "adoptedStyleSheets" in root) {
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(root.querySelector("style").textContent);
    root.adoptedStyleSheets = [sheet];
    root.querySelector("style").remove();
  }
  (win.document.body || win.document.documentElement).append(host);
  const status = root.querySelector("span");
  const send = (type, data = {}) =>
    opener.postMessage(
      { type, siteId, nonce: launch.nonce, ...data },
      launch.origin,
    );
  const setStatus = (message) => {
    status.textContent = message;
  };
  function end(message = "取得確認を終了しました。通常配信は開始しません。") {
    if (ended) return;
    ended = true;
    policy = null;
    observer?.disconnect();
    win.clearTimeout(timer);
    win.clearTimeout(mutationTimer);
    win.removeEventListener("message", receive);
    win.removeEventListener("popstate", navigation);
    win.removeEventListener("hashchange", navigation);
    for (const restore of restores) restore();
    setStatus(message);
    send("jevsense:metadata-ended");
  }
  const restores = [];
  function navigation() {
    end("ページが変わったため終了しました。管理画面から開き直してください。");
  }
  for (const method of ["pushState", "replaceState"]) {
    const original = win.history[method];
    const wrapped = (...args) => {
      const before = win.location.href;
      const result = original.apply(win.history, args);
      if (before !== win.location.href) navigation();
      return result;
    };
    win.history[method] = wrapped;
    restores.push(() => {
      if (win.history[method] === wrapped) win.history[method] = original;
    });
  }
  root.querySelector("button").onclick = () => {
    end();
    host.remove();
  };
  win.addEventListener("popstate", navigation);
  win.addEventListener("hashchange", navigation);
  let lastResult = "";
  function capture(force = false) {
    if (ended || !consent || !policy) return;
    if (Date.now() >= expires || win.location.pathname !== initialPath) {
      end("取得確認の有効期限が切れました。");
      return;
    }
    const provenance = {},
      page = extractPage(win.document, win.location, provenance, policy),
      result = { page, provenance };
    const serialized = JSON.stringify(result);
    if (force || serialized !== lastResult) {
      lastResult = serialized;
      send("jevsense:metadata-result", result);
    }
    setStatus(
      "取得確認中：結果は管理画面に表示しています。Jev判定・履歴保存は行いません。",
    );
  }
  async function receive(event) {
    if (
      ended ||
      event.source !== opener ||
      event.origin !== launch.origin ||
      event.data?.siteId !== siteId ||
      event.data.nonce !== launch.nonce
    )
      return;
    if (event.data.type === "jevsense:metadata-stop") {
      end();
      return;
    }
    if (event.data.type === "jevsense:metadata-refresh") {
      capture(true);
      return;
    }
    if (event.data.type !== "jevsense:metadata-start" || used || !consent)
      return;
    used = true;
    try {
      const response = await win.fetch(
        `${endpoint}/v1/metadata/redeem?siteId=${encodeURIComponent(siteId)}`,
        {
          method: "POST",
          credentials,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: event.data.token,
            nonce: launch.nonce,
            path: initialPath,
          }),
          signal: AbortSignal.timeout(5000),
        },
      );
      const data = await response.json();
      if (
        !response.ok ||
        data.mode !== "metadata" ||
        data.nonce !== launch.nonce ||
        data.siteId !== siteId ||
        !["standard", "custom"].includes(data.policy?.mode) ||
        !Number.isFinite(data.expiresAt)
      )
        throw Error("rejected");
      if (ended || !consent) return;
      policy = data.policy;
      expires = Math.min(expires, data.expiresAt);
      win.clearTimeout(timer);
      timer = win.setTimeout(
        () => end("取得確認の有効期限が切れました。"),
        Math.max(0, expires - Date.now()),
      );
      observer = observePageMetadata(win, () => {
        win.clearTimeout(mutationTimer);
        mutationTimer = win.setTimeout(() => capture(), 100);
      });
      // Observe metadata only; avoid polling and reacting to the confirmation badge itself.
      capture(true);
    } catch {
      setStatus(
        "取得できませんでした。期限・権限・URL・通信設定を確認し、管理画面から開き直してください。",
      );
      send("jevsense:metadata-error");
      end();
    }
  }
  win.addEventListener("message", receive);
  timer = win.setTimeout(() => end("取得確認の有効期限が切れました。"), 300000);
  setStatus("ページ情報の取得確認：サイトの同意を待っています。");
  send("jevsense:metadata-consent-required");
  return {
    async consent(value) {
      if (ended) return;
      consent = !!value;
      if (!value) {
        end("同意が取り消されたため、取得確認を終了しました。");
        return;
      }
      if (!used) {
        setStatus("管理画面に接続しています…");
        send("jevsense:metadata-ready");
      }
    },
    async decide() {},
    track() {},
    setFact() {},
  };
}
