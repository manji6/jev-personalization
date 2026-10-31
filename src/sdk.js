import { installPreview } from "./preview-sdk.js";
import { secureOrLoopback } from "./url-policy.js";
import { pathAllowed } from "./engine.js";
import { renderOffer } from "./offer-renderer.js";
import { createDebugger } from "./debug-panel.js";
const clean = (v, max) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const safeText = (v, max) => {
  const s = clean(v, max);
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\d[ -]?){9,}/i.test(s) ? "" : s;
};
export function extractPage(doc, location, provenance) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  const meta = (key) =>
    doc.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content;
  const nodes = [];
  function walk(v, depth = 0) {
    if (depth > 8 || nodes.length > 200) return;
    if (Array.isArray(v)) v.slice(0, 100).forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === "object") {
      nodes.push(v);
      if (v["@graph"]) walk(v["@graph"], depth + 1);
      if (v.mainEntity) walk(v.mainEntity, depth + 1);
    }
  }
  for (const s of [
    ...doc.querySelectorAll('script[type="application/ld+json"]'),
  ].slice(0, 10)) {
    if (s.textContent.length > 100000) continue;
    try {
      walk(JSON.parse(s.textContent));
    } catch {}
  }
  const resolve = (v) =>
    v?.["@id"]
      ? (nodes.find(
          (n) => n["@id"] === v["@id"] && Object.keys(n).length > 1,
        ) ?? v)
      : v;
  const same = (v) => {
    try {
      const u = new URL(v, url);
      return (
        u.origin === url.origin &&
        u.pathname.replace(/\/$/, "") === url.pathname.replace(/\/$/, "")
      );
    } catch {
      return false;
    }
  };
  const types = [
    "WebPage",
    "Article",
    "NewsArticle",
    "BlogPosting",
    "Product",
    "Service",
    "JobPosting",
    "Course",
    "Event",
  ];
  const kind = (n) =>
    [].concat(n?.["@type"] ?? []).find((t) => types.includes(t));
  const webPages = nodes.filter((n) => kind(n) === "WebPage");
  const pageNode =
    webPages.find((n) => same(n.url) || same(n["@id"])) ??
    (webPages.length === 1 ? webPages[0] : undefined);
  // Only top-level/@graph nodes and explicit mainEntity are considered, never itemListElement.
  let entity = resolve(pageNode?.mainEntity);
  if (!kind(entity))
    entity = nodes.find(
      (n) =>
        kind(n) &&
        kind(n) !== "WebPage" &&
        (same(n.url) ||
          same(n.mainEntityOfPage?.["@id"] ?? n.mainEntityOfPage)),
    );
  if (!entity) entity = pageNode;
  if (!entity) {
    const primary = nodes.filter((n) => kind(n) && kind(n) !== "WebPage");
    if (primary.length === 1) entity = primary[0];
  }
  const name = safeText(
    entity?.name ??
      entity?.headline ??
      entity?.title ??
      meta("og:title") ??
      doc.title,
    160,
  );
  const description = safeText(
    entity?.description ?? meta("og:description") ?? meta("description"),
    400,
  );
  const page = { path: url.pathname, name: name || "Untitled" };
  if (description) page.description = description;
  if (kind(entity)) page.type = kind(entity);
  const themes = []
    .concat(entity?.articleSection ?? entity?.keywords ?? [])
    .filter((x) => typeof x === "string")
    .flatMap((x) => x.split(","))
    .map((x) => safeText(x, 80))
    .filter(Boolean)
    .slice(0, 8);
  if (themes.length) page.themes = themes;
  if (provenance)
    Object.assign(provenance, {
      name:
        entity?.name != null ||
        entity?.headline != null ||
        entity?.title != null
          ? "JSON-LD"
          : meta("og:title") != null
            ? "OGP"
            : "title",
      ...(description
        ? {
            description:
              entity?.description != null
                ? "JSON-LD"
                : meta("og:description") != null
                  ? "OGP"
                  : "meta",
          }
        : {}),
      ...(page.type ? { type: "JSON-LD" } : {}),
      ...(themes.length ? { themes: "JSON-LD" } : {}),
    });
  return page;
}
export function restoreState(saved, config) {
  if (
    !saved ||
    !Number.isFinite(saved.updated) ||
    Date.now() - saved.updated >= 1800000 ||
    saved.updated > Date.now() + 1000 ||
    !Array.isArray(saved.visits) ||
    !Array.isArray(saved.actions) ||
    !saved.facts ||
    !saved.delivery
  )
    return null;
  const validKey = (k) =>
    /^[a-zA-Z0-9_-]{1,64}$/.test(k) &&
    !["__proto__", "constructor", "prototype"].includes(k);
  const scalar = (v) =>
    typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
  const visits = saved.visits
    .slice(-50)
    .filter(
      (v) =>
        v?.page &&
        typeof v.page.path === "string" &&
        v.page.path.length <= 512 &&
        pathAllowed(v.page.path, config) &&
        Number.isFinite(v.visibleMs) &&
        v.visibleMs >= 0,
    )
    .map((v) => ({
      page: {
        path: v.page.path,
        name: safeText(v.page.name, 160) || "Untitled",
        ...(safeText(v.page.description, 400)
          ? { description: safeText(v.page.description, 400) }
          : {}),
        ...(safeText(v.page.type, 80)
          ? { type: safeText(v.page.type, 80) }
          : {}),
        ...(Array.isArray(v.page.themes)
          ? {
              themes: v.page.themes
                .map((t) => safeText(t, 80))
                .filter(Boolean)
                .slice(0, 8),
            }
          : {}),
      },
      visibleMs: Math.min(86400000, v.visibleMs),
    }));
  return {
    updated: saved.updated,
    visits,
    actions: saved.actions
      .slice(-30)
      .filter(
        (a) =>
          a &&
          config.actionNames.includes(a.name) &&
          (a.value === undefined || scalar(a.value)),
      )
      .map((a) =>
        a.value === undefined
          ? { name: a.name }
          : { name: a.name, value: a.value },
      ),
    facts: Object.fromEntries(
      Object.entries(saved.facts)
        .filter(
          ([k, v]) => validKey(k) && config.factNames.includes(k) && scalar(v),
        )
        .slice(0, 20),
    ),
    delivery: Object.fromEntries(
      Object.entries(saved.delivery)
        .filter(
          ([k, v]) =>
            validKey(k) &&
            Number.isInteger(v?.shown) &&
            v.shown >= 0 &&
            v.shown <= 1000 &&
            typeof v.dismissed === "boolean",
        )
        .slice(-100),
    ),
  };
}
export function install(win, script) {
  if (win.JevPersonalization) return win.JevPersonalization;
  const siteId = script?.dataset.site;
  const endpoint = new URL(
    script?.dataset.api ?? script?.src ?? "",
    win.location.href,
  ).origin;
  if (!siteId || !secureOrLoopback(endpoint)) return;
  const credentials =
    script.dataset.previewEnvironment === "true" &&
    win.location.origin === endpoint
      ? "same-origin"
      : "omit";
  const preview = installPreview(win, { siteId, endpoint, credentials });
  if (preview) {
    win.JevPersonalization = preview;
    return preview;
  }
  const key = `jev:v1:${siteId}`;
  let enabled = false,
    config = null,
    current = null,
    start = 0,
    inflight = false,
    epoch = 0,
    observationVersion = 0,
    lastDecisionKey = null,
    suspended = false,
    deferredOffer = null,
    overlay = null;
  let qualificationTimer, decisionTimer;
  let state = {
    visits: [],
    actions: [],
    facts: {},
    delivery: {},
    updated: Date.now(),
  };
  const debug = createDebugger(win, {
    siteId,
    endpoint,
    credentials,
    snapshot() {
      const sources = {};
      if (enabled && current) extractPage(win.document, win.location, sources);
      const visibleMs = current
        ? Math.min(
            86400000,
            current.visibleMs +
              (start ? Math.max(0, win.performance.now() - start) : 0),
          )
        : 0;
      return {
        enabled,
        hidden: suspended || win.document.visibilityState === "hidden",
        offerVisible: !!overlay,
        minVisibleMs: qualificationMs(),
        current: current ? { path: current.page.path, visibleMs } : null,
        sources,
        state: {
          ...state,
          visits: state.visits.map((v) =>
            v === current ? { ...v, visibleMs } : v,
          ),
        },
      };
    },
  });
  const allowed = (path) => config && pathAllowed(path, config);
  const qualificationMs = () => config?.minVisibleMs ?? 5000;
  // Continuous dwell time is still sent raw, but is not a reason to query again.
  // Only crossing the configured qualification boundary changes this key.
  const decisionKey = () =>
    JSON.stringify([
      epoch,
      observationVersion,
      state.visits.map((v) => v.visibleMs >= qualificationMs()),
    ]);
  function requestDecision(reason = "queued") {
    win.clearTimeout(decisionTimer);
    decisionTimer = win.setTimeout(() => decide(reason), 100);
  }
  function persist() {
    state.updated = Date.now();
    try {
      win.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }
  function accrue() {
    if (current && start) {
      current.visibleMs = Math.min(
        86400000,
        current.visibleMs + Math.max(0, win.performance.now() - start),
      );
      start = 0;
    }
  }
  function resume() {
    win.clearTimeout(qualificationTimer);
    if (current && !suspended && win.document.visibilityState !== "hidden") {
      start = win.performance.now() || 0.001;
      const remaining = qualificationMs() - current.visibleMs;
      if (remaining > 0)
        qualificationTimer = win.setTimeout(() => {
          accrue();
          resume();
          persist();
          requestDecision("qualification");
        }, Math.ceil(remaining));
    }
  }
  function capture(reason = "initial") {
    if (!enabled || !config?.metadataEnabled) return;
    accrue();
    const path = win.location.pathname;
    if (!allowed(path)) {
      current = null;
      persist();
      return;
    }
    current = { page: extractPage(win.document, win.location), visibleMs: 0 };
    observationVersion++;
    state.visits.push(current);
    state.visits = state.visits.slice(-50);
    resume();
    persist();
    debug.record("page", { page: current.page, reason });
    void decide(reason);
  }
  let navigationTimer;
  function navigate() {
    accrue();
    observationVersion++;
    current = null;
    deferredOffer = null;
    win.clearTimeout(qualificationTimer);
    removeOverlay();
    win.clearTimeout(navigationTimer);
    navigationTimer = win.setTimeout(() => capture("navigation"), 200);
  }
  for (const method of ["pushState", "replaceState"]) {
    const original = win.history[method];
    win.history[method] = function (...args) {
      const before = win.location.pathname;
      const r = original.apply(this, args);
      if (before !== win.location.pathname) navigate();
      return r;
    };
  }
  win.addEventListener("popstate", navigate);
  win.document.addEventListener("visibilitychange", () => {
    accrue();
    if (enabled) {
      resume();
      persist();
      requestDecision("visible");
    }
  });
  win.addEventListener("pagehide", () => {
    accrue();
    suspended = true;
    win.clearTimeout(qualificationTimer);
    win.clearTimeout(decisionTimer);
    removeOverlay();
    if (enabled) persist();
  });
  win.addEventListener("pageshow", () => {
    suspended = false;
    if (enabled) {
      accrue();
      resume();
      requestDecision("visible");
    }
  });
  // Keep asynchronously updated standard metadata current, without starting a new visit.
  const observer = new win.MutationObserver(() => {
    if (enabled && current && allowed(win.location.pathname)) {
      const page = extractPage(win.document, win.location);
      if (JSON.stringify(page) !== JSON.stringify(current.page)) {
        current.page = page;
        observationVersion++;
        debug.record("metadata", { page });
        requestDecision("metadata");
      }
    }
  });
  if (win.document.head)
    observer.observe(win.document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
  function removeOverlay() {
    if (overlay) debug.record("removed");
    overlay?.destroy();
    overlay = null;
  }
  function display(campaign) {
    if (overlay || !campaign?.id || state.delivery[campaign.id]?.dismissed)
      return;
    let handle;
    try {
      handle = renderOffer(win, campaign, {
        onShown() {
          debug.record("shown", { campaignId: campaign.id });
          const prev = state.delivery[campaign.id] ?? {
            shown: 0,
            dismissed: false,
          };
          state.delivery[campaign.id] = {
            ...prev,
            shown: Math.min(1000, prev.shown + 1),
          };
          persist();
          win.dispatchEvent(
            new win.CustomEvent("jev:shown", {
              detail: { campaignId: campaign.id },
            }),
          );
        },
        onClose() {
          debug.record("closed", { campaignId: campaign.id });
          const prev = state.delivery[campaign.id] ?? {
            shown: 0,
            dismissed: false,
          };
          state.delivery[campaign.id] = { ...prev, dismissed: true };
          persist();
          overlay = null;
        },
        async loadModule(path) {
          const url = new URL(path, endpoint);
          if (
            url.origin !== endpoint ||
            !/^\/v1\/offer-script\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-f0-9]{64}\.js$/.test(
              url.pathname,
            ) ||
            url.search ||
            url.hash
          )
            throw new Error("Invalid module URL");
          return import(url.href);
        },
      });
      overlay = handle;
      handle.ready.then((ok) => {
        if (!ok) debug.record("render_failed", { campaignId: campaign.id });
        if (!ok && overlay === handle) overlay = null;
      });
    } catch {
      debug.record("render_failed", { campaignId: campaign.id });
      handle?.destroy();
    }
  }
  async function decide(reason = "manual") {
    if (
      !enabled ||
      !current ||
      inflight ||
      suspended ||
      overlay ||
      win.document.visibilityState === "hidden"
    )
      return;
    accrue();
    resume();
    persist();
    if (!allowed(win.location.pathname)) return;
    const key = decisionKey();
    if (deferredOffer) {
      const saved = deferredOffer;
      deferredOffer = null;
      if (saved.key === key) {
        display(saved.campaign);
        return;
      }
    }
    if (key === lastDecisionKey) return;
    const generation = epoch,
      path = win.location.pathname;
    const payload = { siteId, ...state };
    delete payload.updated;
    let body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).length > 64000) return;
    inflight = true;
    lastDecisionKey = key;
    const requestStarted = win.performance.now();
    debug.record("request", { reason, body: JSON.parse(body) });
    try {
      const r = await win.fetch(
        `${endpoint}/v1/decision?siteId=${encodeURIComponent(siteId)}`,
        {
          method: "POST",
          mode: "cors",
          credentials,
          headers: { "Content-Type": "application/json", ...debug.headers() },
          body,
          signal: AbortSignal.timeout(3000),
        },
      );
      const result = await r.json();
      if (generation === epoch)
        debug.record("response", {
          status: r.status,
          elapsedMs: Math.round(win.performance.now() - requestStarted),
          reason: result.reason ?? result.error,
          result,
        });
      if (!r.ok) return;
      if (
        enabled &&
        generation === epoch &&
        path === win.location.pathname &&
        key === decisionKey() &&
        result.decision === "show"
      ) {
        if (suspended || win.document.visibilityState === "hidden")
          deferredOffer = { key, campaign: result.campaign };
        else display(result.campaign);
      } else if (result.decision === "show")
        debug.record("stale", {
          reason: "ページ・同意・判断材料が更新されたため表示しません",
        });
    } catch {
      if (generation === epoch) debug.record("network_error");
    } finally {
      inflight = false;
      if (enabled && current && decisionKey() !== lastDecisionKey)
        requestDecision();
    }
  }
  async function consent(value) {
    epoch++;
    enabled = false;
    accrue();
    win.clearTimeout(qualificationTimer);
    win.clearTimeout(decisionTimer);
    lastDecisionKey = null;
    deferredOffer = null;
    current = null;
    removeOverlay();
    if (!value) {
      state = {
        visits: [],
        actions: [],
        facts: {},
        delivery: {},
        updated: Date.now(),
      };
      debug.clear();
      try {
        win.sessionStorage.removeItem(key);
      } catch {}
      debug.record("consent", { granted: false });
      return;
    }
    const generation = epoch;
    try {
      const r = await win.fetch(
        `${endpoint}/v1/sites/${encodeURIComponent(siteId)}`,
        { credentials, signal: AbortSignal.timeout(3000) },
      );
      if (!r.ok) return;
      config = await r.json();
      if (generation !== epoch || !config.metadataEnabled) return;
      try {
        const saved = restoreState(
          JSON.parse(win.sessionStorage.getItem(key)),
          config,
        );
        if (saved) state = saved;
      } catch {}
      enabled = true;
      debug.record("consent", { granted: true });
      capture();
    } catch {}
  }
  const api = {
    consent,
    decide,
    track(name, value) {
      if (
        enabled &&
        config.actionNames.includes(name) &&
        ["boolean", "number", "undefined"].includes(typeof value) &&
        (typeof value !== "number" || Number.isFinite(value))
      ) {
        state.actions.push(value === undefined ? { name } : { name, value });
        state.actions = state.actions.slice(-30);
        observationVersion++;
        persist();
        debug.record("action", { name, value });
        requestDecision("action");
      }
    },
    setFact(name, value) {
      if (
        enabled &&
        config.factNames.includes(name) &&
        ["boolean", "number"].includes(typeof value) &&
        Number.isFinite(typeof value === "number" ? value : 0) &&
        state.facts[name] !== value
      ) {
        state.facts[name] = value;
        observationVersion++;
        persist();
        debug.record("fact", { name, value });
        requestDecision("fact_changed");
      }
    },
  };
  win.JevPersonalization = api;
  win.setInterval(() => {
    if (enabled && !suspended && win.document.visibilityState !== "hidden") {
      accrue();
      resume();
      persist();
    }
  }, 5000);
  if (script.dataset.consent === "granted") consent(true);
  return api;
}
if (typeof window !== "undefined" && document.currentScript)
  install(window, document.currentScript);
