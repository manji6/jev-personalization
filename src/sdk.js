import { installMetadataInspection } from "./metadata-inspection-sdk.js";
import { installPreview } from "./preview-sdk.js";
import { secureOrLoopback } from "./url-policy.js";
import { pathAllowed } from "./engine.js";
import { renderOffer } from "./offer-renderer.js";
import { createDebugger } from "./debug-panel.js";
import { extractPage, observePageMetadata } from "./metadata-extractor.js";
import { safeText } from "./legacy-metadata.js";
import { pageWithUrl, sanitizePageUrl } from "./page-url.js";
export { extractPage };
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
        (!v.page.url ||
          (sanitizePageUrl(v.page.url, config.excludedQueryKeys) &&
            (!config.collectionOrigin ||
              new URL(v.page.url).origin === config.collectionOrigin) &&
            new URL(v.page.url).pathname === v.page.path)) &&
        Number.isFinite(v.visibleMs) &&
        v.visibleMs >= (config.minVisibleMs ?? 5000),
    )
    .map((v) => ({
      page: {
        ...(sanitizePageUrl(v.page.url, config.excludedQueryKeys)
          ? { url: sanitizePageUrl(v.page.url, config.excludedQueryKeys) }
          : {}),
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
  const normalizeEntry = (value) => {
    if (
      !value ||
      typeof value.path !== "string" ||
      value.path.length > 512 ||
      !pathAllowed(value.path, config)
    )
      return undefined;
    const url = sanitizePageUrl(value.url, config.excludedQueryKeys);
    if (
      (value.url && !url) ||
      (url &&
        config.collectionOrigin &&
        new URL(url).origin !== config.collectionOrigin) ||
      (url && new URL(url).pathname !== value.path)
    )
      return undefined;
    return {
      path: value.path,
      name: safeText(value.name, 160) || "Untitled",
      ...(url ? { url } : {}),
    };
  };
  const entryPage =
    (saved.metadataRevision ?? "legacy") ===
    (config.metadataRevision ?? "legacy")
      ? normalizeEntry(saved.entryPage)
      : undefined;
  return {
    version: 2,
    ...(entryPage ? { entryPage } : {}),
    ...(config.urlPolicyRevision
      ? { urlPolicyRevision: config.urlPolicyRevision }
      : {}),
    updated: saved.updated,
    visits:
      (saved.metadataRevision ?? "legacy") ===
      (config.metadataRevision ?? "legacy")
        ? visits
        : [],
    ...(config.metadataRevision
      ? { metadataRevision: config.metadataRevision }
      : {}),
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
  const inspection = installMetadataInspection(win, {
    siteId,
    endpoint,
    credentials,
  });
  if (inspection) {
    win.JevPersonalization = inspection;
    if (script.dataset.consent === "granted") void inspection.consent(true);
    return inspection;
  }
  const preview = installPreview(win, { siteId, endpoint, credentials });
  if (preview) {
    win.JevPersonalization = preview;
    return preview;
  }
  const key = `jev:v1:${siteId}`;
  const emptyState = () => ({
    version: 2,
    visits: [],
    actions: [],
    facts: {},
    delivery: {},
    updated: Date.now(),
  });
  let state = emptyState(),
    config = null,
    enabled = false,
    current = null,
    recorded = false,
    start = 0,
    epoch = 0,
    view = 0,
    attempted = false,
    inflight = false,
    stateVersion = 0,
    suspended = false,
    overlay = null,
    deferredOffer = null;
  let qualificationTimer, navigationTimer;
  const allowed = (path) => config && pathAllowed(path, config);
  const qualificationMs = () => config?.minVisibleMs ?? 5000;
  const pageNow = (sources) =>
    pageWithUrl(
      extractPage(
        win.document,
        win.location,
        sources,
        config?.metadataExtraction,
      ),
      win.location,
      config?.excludedQueryKeys,
    );
  const debug = createDebugger(win, {
    siteId,
    endpoint,
    credentials,
    snapshot() {
      const sources = {};
      if (enabled && current) {
        pageNow(sources);
        sources.url = current.page.url
          ? "location.href（除外キー・資格情報・fragmentを除去）"
          : "URLを省略（不正または4,096文字超過）";
      }
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
          currentPage: current?.page ?? null,
          entryPage: state.entryPage ?? null,
          currentVisit: current
            ? { page: current.page, visibleMs, qualified: recorded }
            : null,
          visits: state.visits.map((v) =>
            v === current ? { page: v.page, visibleMs } : v,
          ),
        },
      };
    },
  });
  function commitCurrent() {
    if (current && !recorded && current.visibleMs >= qualificationMs()) {
      state.visits.push(current);
      state.visits = state.visits.slice(-50);
      recorded = true;
      debug.record("qualification_local", {
        page: current.page,
        visibleMs: current.visibleMs,
      });
    }
  }
  function persist() {
    state.updated = Date.now();
    const value = { ...state, ...(current ? { currentVisit: current } : {}) };
    try {
      win.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }
  function accrue() {
    if (current && start) {
      current.visibleMs = Math.min(
        86400000,
        current.visibleMs + Math.max(0, win.performance.now() - start),
      );
      start = 0;
      commitCurrent();
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
        }, Math.ceil(remaining));
    }
  }
  function setEntry() {
    if (!state.entryPage && current)
      state.entryPage = {
        path: current.page.path,
        name: current.page.name,
        ...(current.page.url ? { url: current.page.url } : {}),
      };
  }
  function capture(reason = "initial") {
    if (!enabled || !config?.metadataEnabled) return;
    accrue();
    if (!allowed(win.location.pathname)) {
      current = null;
      persist();
      return;
    }
    current = { page: pageNow(), visibleMs: 0 };
    recorded = false;
    view++;
    attempted = false;
    setEntry();
    resume();
    persist();
    debug.record("page", { page: current.page, reason });
    void decide(reason);
  }
  async function loadConfig(generation) {
    const response = await win.fetch(
      `${endpoint}/v1/sites/${encodeURIComponent(siteId)}`,
      {
        credentials,
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) return null;
    const value = await response.json();
    if (generation !== epoch) return null;
    return { ...value, collectionOrigin: win.location.origin };
  }
  function applyConfig(fresh) {
    const oldCurrent = current;
    const saved = {
      ...state,
      visits: state.visits.filter((v) => v !== oldCurrent),
      updated: Date.now(),
    };
    config = fresh;
    state = restoreState(saved, config) || emptyState();
    if (fresh.metadataRevision) state.metadataRevision = fresh.metadataRevision;
    if (fresh.urlPolicyRevision)
      state.urlPolicyRevision = fresh.urlPolicyRevision;
    if (oldCurrent) {
      current = { page: pageNow(), visibleMs: oldCurrent.visibleMs };
      recorded = false;
      commitCurrent();
      setEntry();
    }
  }
  function navigate() {
    if (!enabled) return;
    accrue();
    persist();
    epoch++;
    view++;
    attempted = false;
    current = null;
    recorded = false;
    deferredOffer = null;
    win.clearTimeout(qualificationTimer);
    win.clearTimeout(navigationTimer);
    removeOverlay();
    const generation = epoch;
    navigationTimer = win.setTimeout(async () => {
      try {
        const fresh = await loadConfig(generation);
        if (!fresh || generation !== epoch || !enabled) return;
        applyConfig(fresh);
        if (!fresh.metadataEnabled) {
          current = null;
          persist();
          return;
        }
        capture("navigation");
      } catch {
        debug.record("network_error");
      }
    }, 200);
  }
  function updateMetadata() {
    if (enabled && current && allowed(win.location.pathname)) {
      const page = pageNow();
      if (JSON.stringify(page) !== JSON.stringify(current.page)) {
        if (page.url !== current.page.url) stateVersion++;
        current.page = page;
        persist();
        debug.record("metadata_local", { page });
      }
    }
  }
  for (const method of ["pushState", "replaceState"]) {
    const original = win.history[method];
    win.history[method] = function (...args) {
      const path = win.location.pathname;
      const result = original.apply(this, args);
      if (path !== win.location.pathname) navigate();
      else updateMetadata();
      return result;
    };
  }
  win.addEventListener("popstate", () => {
    if (current?.page.path !== win.location.pathname) navigate();
    else updateMetadata();
  });
  win.document.addEventListener("visibilitychange", () => {
    accrue();
    if (enabled) {
      resume();
      persist();
      if (win.document.visibilityState !== "hidden") void decide("visible");
    }
  });
  win.addEventListener("pagehide", () => {
    accrue();
    suspended = true;
    win.clearTimeout(qualificationTimer);
    removeOverlay();
    if (enabled) persist();
  });
  win.addEventListener("pageshow", () => {
    accrue();
    suspended = false;
    if (enabled) {
      resume();
      void decide("visible");
    }
  });
  observePageMetadata(win, updateMetadata);
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
    if (deferredOffer) {
      const saved = deferredOffer;
      deferredOffer = null;
      if (
        saved.view === view &&
        saved.epoch === epoch &&
        saved.stateVersion === stateVersion
      ) {
        display(saved.campaign);
        return;
      }
    }
    if (attempted) return;
    attempted = true;
    const generation = epoch,
      requestView = view,
      version = stateVersion,
      path = win.location.pathname;
    const payload = {
      protocolVersion: 2,
      siteId,
      ...(config.metadataRevision
        ? { metadataRevision: config.metadataRevision }
        : {}),
      ...(config.urlPolicyRevision
        ? { urlPolicyRevision: config.urlPolicyRevision }
        : {}),
      currentPage: current.page,
      ...(state.entryPage ? { entryPage: state.entryPage } : {}),
      visits: state.visits.filter((v) => v !== current),
      actions: state.actions,
      facts: state.facts,
      delivery: state.delivery,
    };
    let body = JSON.stringify(payload);
    while (
      new TextEncoder().encode(body).length > 64000 &&
      payload.visits.length
    ) {
      payload.visits.shift();
      body = JSON.stringify(payload);
    }
    if (new TextEncoder().encode(body).length > 64000) {
      debug.record("request_too_large");
      return;
    }
    inflight = true;
    await debug.waitForAuthorization();
    if (!enabled || generation !== epoch || requestView !== view) {
      inflight = false;
      if (enabled && current && !attempted) void decide("navigation_queued");
      return;
    }
    const started = win.performance.now();
    debug.record("request", { reason, body: JSON.parse(body) });
    try {
      const response = await win.fetch(
        `${endpoint}/v1/decision?siteId=${encodeURIComponent(siteId)}`,
        {
          method: "POST",
          mode: "cors",
          credentials,
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json", ...debug.headers() },
          body,
          signal: AbortSignal.timeout(3000),
        },
      );
      const result = await response.json();
      if (generation === epoch && requestView === view)
        debug.record("response", {
          status: response.status,
          elapsedMs: Math.round(win.performance.now() - started),
          reason: result.reason ?? result.error,
          result,
        });
      if (!response.ok) return;
      if (
        ["metadata_revision_changed", "url_policy_revision_changed"].includes(
          result.reason,
        ) &&
        generation === epoch &&
        requestView === view &&
        enabled
      ) {
        const fresh = await loadConfig(generation);
        if (!fresh || generation !== epoch || requestView !== view || !enabled)
          return;
        if (
          result.metadataRevision &&
          fresh.metadataRevision !== result.metadataRevision
        )
          return;
        if (
          result.urlPolicyRevision &&
          fresh.urlPolicyRevision !== result.urlPolicyRevision
        )
          return;
        accrue();
        applyConfig(fresh);
        persist();
        debug.record("settings_local", { reason: result.reason });
        return;
      }
      if (
        enabled &&
        generation === epoch &&
        requestView === view &&
        path === win.location.pathname &&
        version === stateVersion &&
        result.decision === "show"
      ) {
        if (suspended || win.document.visibilityState === "hidden")
          deferredOffer = {
            epoch: generation,
            view: requestView,
            stateVersion: version,
            campaign: result.campaign,
          };
        else display(result.campaign);
      } else if (result.decision === "show")
        debug.record("stale", {
          reason: "ページ・同意・連携された状態が更新されたため表示しません",
        });
    } catch {
      if (generation === epoch) debug.record("network_error");
    } finally {
      inflight = false;
      if (enabled && current && !attempted) void decide("navigation_queued");
    }
  }
  async function consent(value) {
    if (value && enabled) return;
    epoch++;
    enabled = false;
    accrue();
    win.clearTimeout(qualificationTimer);
    win.clearTimeout(navigationTimer);
    current = null;
    recorded = false;
    attempted = false;
    deferredOffer = null;
    removeOverlay();
    if (!value) {
      state = emptyState();
      debug.clear();
      try {
        win.sessionStorage.removeItem(key);
      } catch {}
      debug.record("consent", { granted: false });
      return;
    }
    const generation = epoch;
    try {
      const fresh = await loadConfig(generation);
      if (!fresh || generation !== epoch || !fresh.metadataEnabled) return;
      config = fresh;
      let saved = state;
      try {
        saved = JSON.parse(win.sessionStorage.getItem(key)) ?? state;
      } catch {}
      state = restoreState(saved, config) || emptyState();
      if (config.metadataRevision)
        state.metadataRevision = config.metadataRevision;
      if (config.urlPolicyRevision)
        state.urlPolicyRevision = config.urlPolicyRevision;
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
        (config.actionNames ?? []).includes(name) &&
        ["boolean", "number", "undefined"].includes(typeof value) &&
        (typeof value !== "number" || Number.isFinite(value))
      ) {
        state.actions.push(value === undefined ? { name } : { name, value });
        state.actions = state.actions.slice(-30);
        stateVersion++;
        persist();
        debug.record("action_local", { name, value });
      }
    },
    setFact(name, value) {
      if (
        enabled &&
        (config.factNames ?? []).includes(name) &&
        ["boolean", "number"].includes(typeof value) &&
        (typeof value !== "number" || Number.isFinite(value)) &&
        state.facts[name] !== value
      ) {
        state.facts[name] = value;
        stateVersion++;
        persist();
        debug.record("fact_local", { name, value });
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
  if (script.dataset.consent === "granted") void consent(true);
  return api;
}
if (typeof window !== "undefined" && document.currentScript)
  install(window, document.currentScript);
