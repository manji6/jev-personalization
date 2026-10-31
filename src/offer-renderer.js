import { DEFAULT_DESIGN, designWithDefaults } from "./offer-model.js";
const color = (v, f) => (/^#[\da-f]{6}$/i.test(v) ? v : f);
const number = (v, min, max, f) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.max(min, Math.min(max, v))
    : f;
function https(v) {
  try {
    const u = new URL(v);
    if (u.protocol === "https:" && !u.username && !u.password) return u.href;
  } catch {}
  return null;
}
export function renderOffer(win, offer, options = {}) {
  const doc = win.document,
    preview = !!options.preview,
    type = offer.presentation?.type ?? "floating";
  if (!["modal", "floating", "bar", "custom"].includes(type))
    throw new Error("Unknown offer type");
  const target = options.mount ?? doc.body;
  const host = doc.createElement("aside");
  host.dataset.jevOffer = offer.id ?? "preview";
  const root = host.attachShadow({ mode: "open" });
  const controller = new win.AbortController();
  let ended = false,
    shown = false,
    cleanup,
    dialog;
  const previous = doc.activeElement;
  const destroy = () => {
    if (ended) return;
    ended = true;
    controller.abort();
    options.signal?.removeEventListener("abort", destroy);
    try {
      cleanup?.();
    } catch {}
    if (dialog?.open) dialog.close();
    host.remove();
    if (type === "modal" && !preview && previous?.isConnected)
      previous.focus?.();
  };
  const close = () => {
    if (ended) return;
    destroy();
    options.onClose?.();
  };
  const reportShown = () => {
    if (!ended && !shown && host.isConnected) {
      shown = true;
      options.onShown?.();
    }
  };
  const context = {
    mode: options.mode === "preview" ? "preview" : "delivery",
    content: structuredClone(offer.content),
    variables: structuredClone(offer.custom?.variables ?? {}),
    mount: root,
    signal: controller.signal,
    close,
    reportShown,
  };
  options.signal?.addEventListener("abort", destroy, { once: true });
  target.append(host);
  if (options.signal?.aborted) {
    destroy();
    return { host, destroy, ready: Promise.resolve(false) };
  }
  if (type === "custom") {
    const ready = (async () => {
      try {
        if (preview || !options.loadModule)
          throw new Error(
            "独自JavaScriptのプレビューはテストサイトで実施してください",
          );
        const mod = await options.loadModule(offer.custom?.modulePath);
        if (ended) return false;
        if (typeof mod.render !== "function")
          throw new Error("render export required");
        const fn = await mod.render(context);
        if (typeof fn === "function") {
          if (ended) fn();
          else cleanup = fn;
        }
        return !ended;
      } catch (error) {
        destroy();
        options.onError?.(error);
        return false;
      }
    })();
    return { host, destroy, ready };
  }
  const d = designWithDefaults(offer.design),
    defaults = DEFAULT_DESIGN;
  const bg = color(d.colors.background, defaults.colors.background),
    fg = color(d.colors.text, defaults.colors.text),
    accent = color(d.colors.accent, defaults.colors.accent),
    buttonText = color(d.colors.buttonText, defaults.colors.buttonText);
  const font =
    d.font === "serif"
      ? 'Georgia, "Noto Serif JP", serif'
      : "system-ui, sans-serif";
  const size = number(d.fontSize, 12, 24, 16),
    padding = number(d.padding, 12, 48, 24),
    radius = number(d.radius, 0, 32, 12);
  const width =
    type === "modal"
      ? number(d.modal.width, 280, 800, 480)
      : number(d.floating.width, 200, 480, 320);
  const offset = number(d.floating.offset, 8, 64, 20),
    opacity = number(d.modal.backdropOpacity, 0, 0.9, 0.5);
  const left = d.floating.position === "bottom-left",
    bottom = d.bar.position === "bottom";
  const css = `:host{all:initial;display:block;${preview ? "position:relative;height:380px;min-width:0;" : "position:relative;z-index:2147483647;"}}*{box-sizing:border-box}.frame{position:${preview ? "absolute" : "fixed"};font:${size}px/1.65 ${font};color:${fg};background:${bg};padding:${padding}px;border-radius:${radius}px;border:1px solid ${fg}26;box-shadow:0 12px 42px #0002;overflow-wrap:anywhere;max-height:${preview ? "100%" : "calc(100dvh - 32px)"};overflow:auto;z-index:2147483647}.floating{bottom:${offset}px;${left ? "left" : "right"}:${offset}px;width:${width}px;max-width:calc(100% - ${offset * 2}px)}.bar{${bottom ? "bottom" : "top"}:0;left:0;right:0;width:100%;border-radius:0;display:flex;align-items:center;gap:20px;padding:14px 52px 14px 24px}.bar .copy{flex:1}.bar h2{font-size:1em;margin:0}.bar p{margin:3px 0 0;font-size:.9em}.bar .image-link{max-width:100px;flex-shrink:0}.modal{width:${width}px;max-width:calc(100% - 32px);margin:auto;inset:0;height:fit-content}.modal::backdrop{background:rgba(0,0,0,${opacity})}.preview-shade{position:absolute;inset:0;background:rgba(0,0,0,${opacity});display:grid;grid-template-columns:minmax(0,1fr);place-items:center;border-radius:8px}.preview-shade .modal{position:relative;inset:auto;min-width:0;width:min(${width}px,calc(100% - 24px));max-height:calc(100% - 24px)}h2{font-size:1.25em;line-height:1.5;margin:4px 24px 10px 0;font-weight:650}p{margin:0 0 18px;white-space:pre-line}a.cta{display:inline-flex;align-items:center;justify-content:center;gap:12px;background:${accent};color:${buttonText};text-decoration:none;border-radius:${Math.min(radius, 12)}px;padding:10px 16px;font:600 .9em/1.5 ${font};max-width:100%;text-align:center}.dismiss{position:absolute;top:8px;right:8px;width:32px;height:32px;border:0;border-radius:50%;background:${bg};color:${fg};font:24px/1 ${font};cursor:pointer}.dismiss:hover{filter:brightness(.94)}a:focus-visible,button:focus-visible{outline:3px solid ${accent};outline-offset:3px}.image-link{display:block;margin:0 0 14px}.image-link img{display:block;width:100%;height:auto;border-radius:${Math.max(0, radius - 4)}px}.image-only{padding:0}.image-only .image-link{margin:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:480px){.bar{gap:10px;flex-wrap:wrap;padding-right:46px}.bar .copy{min-width:150px}.bar .image-link{max-width:60px}.frame{font-size:${Math.min(size, 18)}px}}`;
  if (win.CSSStyleSheet && "adoptedStyleSheets" in root) {
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } else {
    const style = doc.createElement("style");
    style.textContent = css;
    root.append(style);
  }
  let container = root;
  if (type === "modal" && preview) {
    container = doc.createElement("div");
    container.className = "preview-shade";
    root.append(container);
  }
  const box = doc.createElement(
    type === "modal" && !preview ? "dialog" : "section",
  );
  box.className = `frame ${type}${offer.presentation?.imageOnly ? " image-only" : ""}`;
  box.setAttribute("aria-label", offer.content.title || "おすすめ情報");
  if (type !== "modal" || preview) box.setAttribute("role", "region");
  const dismiss = doc.createElement("button");
  dismiss.className = "dismiss";
  dismiss.type = "button";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", "オファーを閉じる");
  dismiss.addEventListener("click", close);
  const copy = doc.createElement("div");
  copy.className = "copy";
  const title = doc.createElement("h2");
  title.textContent = offer.content.title;
  const body = doc.createElement("p");
  body.textContent = offer.content.body;
  copy.append(title, body);
  const link = https(offer.content.url);
  const cta = doc.createElement("a");
  cta.className = "cta";
  cta.textContent = offer.content.linkLabel;
  if (link) cta.href = link;
  cta.rel = "noopener noreferrer";
  const imageUrl = https(offer.content.imageUrl);
  let image;
  if (imageUrl) {
    const imageLink = doc.createElement(link ? "a" : "div");
    imageLink.className = "image-link";
    if (link) {
      imageLink.href = link;
      imageLink.rel = "noopener noreferrer";
    }
    image = doc.createElement("img");
    image.alt = offer.content.imageAlt || offer.content.title;
    image.referrerPolicy = "no-referrer";
    imageLink.append(image);
    box.append(imageLink);
  }
  if (!offer.presentation?.imageOnly) {
    box.append(copy);
    if (link) box.append(cta);
  } else {
    title.className = "sr-only";
    box.append(title);
  }
  box.append(dismiss);
  container.append(box);
  if (type === "modal" && !preview) {
    dialog = box;
    if (typeof dialog.showModal !== "function") {
      destroy();
      return { host, destroy, ready: Promise.resolve(false) };
    }
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const items = [
        ...dialog.querySelectorAll("a[href],button:not([disabled])"),
      ];
      const first = items[0],
        last = items.at(-1),
        active = root.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          close();
      }
    });
    dialog.showModal();
    dismiss.focus();
  }
  let ready;
  if (image && offer.presentation?.imageOnly) {
    ready = new Promise((resolve) => {
      const timer = win.setTimeout(() => {
        destroy();
        resolve(false);
      }, 5000);
      const finish = (ok) => {
        win.clearTimeout(timer);
        if (ok && !ended) {
          reportShown();
          resolve(true);
        } else {
          destroy();
          resolve(false);
        }
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      controller.signal.addEventListener(
        "abort",
        () => {
          win.clearTimeout(timer);
          resolve(false);
        },
        { once: true },
      );
      image.src = imageUrl;
    });
  } else {
    if (image) {
      image.onerror = () => image.parentElement?.remove();
      image.src = imageUrl;
    }
    reportShown();
    ready = Promise.resolve(true);
  }
  return { host, destroy, ready };
}

export { DEFAULT_DESIGN, designWithDefaults } from "./offer-model.js";
