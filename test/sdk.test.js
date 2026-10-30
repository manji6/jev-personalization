import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { extractPage, install, restoreState } from "../src/sdk.js";
test("JSON-LD graph mainEntity local reference, without list products becoming visits", () => {
  const dom = new JSDOM(
    `<title>Fallback</title><script type="application/ld+json">{"@graph":[{"@type":"WebPage","url":"https://example.com/a","mainEntity":{"@id":"#subject"}},{"@id":"#subject","@type":"Course","name":"入門講座","description":"受講案内","keywords":["教育"]},{"@type":"ItemList","itemListElement":[{"@type":"Product","name":"無関係"}]}]}</script>`,
    { url: "https://example.com/a?private=yes#x" },
  );
  const p = extractPage(dom.window.document, dom.window.location);
  assert.equal(p.name, "入門講座");
  assert.equal(p.path, "/a");
  assert.equal(p.type, "Course");
  assert.deepEqual(p.themes, ["教育"]);
  dom.window.close();
});
test("malformed LD falls back; personal metadata suppressed; external references never fetched", () => {
  const dom = new JSDOM(
    '<title>Fallback</title><meta property="og:description" content="user@example.com"><script type="application/ld+json">{bad</script>',
    { url: "https://example.com/a" },
  );
  const p = extractPage(dom.window.document, dom.window.location);
  assert.equal(p.name, "Fallback");
  assert.equal(p.description, undefined);
  dom.window.close();
});
test("a single primary object without url is extracted; ambiguous graph falls back", () => {
  const dom = new JSDOM(
    '<title>Fallback</title><script type="application/ld+json">{"@type":"JobPosting","title":"Role","name":"Engineer","description":"採用情報"}</script>',
    { url: "https://example.com/jobs/a" },
  );
  assert.equal(
    extractPage(dom.window.document, dom.window.location).name,
    "Engineer",
  );
  dom.window.document.querySelector("script").textContent =
    '[{"@type":"Product","name":"A"},{"@type":"Product","name":"B"}]';
  assert.equal(
    extractPage(dom.window.document, dom.window.location).name,
    "Fallback",
  );
  dom.window.close();
});
test("consent prevents collection/network; revoke clears tab history; unknown facts ignored", async () => {
  const dom = new JSDOM("<title>Guide</title>", {
    url: "https://example.com/guides/a",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  let calls = 0;
  w.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        metadataEnabled: true,
        allowedPathPrefixes: ["/guides/"],
        excludedPathPrefixes: [],
        actionNames: ["download"],
        factNames: ["registered"],
      }),
    };
  };
  const api = install(w, {
    dataset: { site: "demo", api: "https://api.example.com" },
  });
  assert.equal(calls, 0);
  api.track("download");
  assert.equal(w.sessionStorage.length, 0);
  await api.consent(true);
  api.setFact("email", "private");
  api.setFact("registered", false);
  api.track("download", true);
  let state = JSON.parse(w.sessionStorage.getItem("jev:v1:demo"));
  assert.equal(state.visits.length, 1);
  assert.deepEqual(state.facts, { registered: false });
  assert.equal(state.actions.length, 1);
  await api.consent(false);
  assert.equal(w.sessionStorage.length, 0);
  w.close();
});
test("SPA records distinct visits, strips queries and skips excluded routes", async () => {
  const dom = new JSDOM("<title>A</title>", {
    url: "https://example.com/guides/a",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = async () => ({
    ok: true,
    json: async () => ({
      metadataEnabled: true,
      allowedPathPrefixes: ["/guides/"],
      excludedPathPrefixes: ["/guides/private"],
      actionNames: [],
      factNames: [],
    }),
  });
  const api = install(w, {
    dataset: { site: "demo", api: "https://api.example.com" },
  });
  await api.consent(true);
  w.history.pushState({}, "", "/guides/b?email=x");
  await new Promise((r) => setTimeout(r, 250));
  let state = JSON.parse(w.sessionStorage.getItem("jev:v1:demo"));
  assert.deepEqual(
    state.visits.map((v) => v.page.path),
    ["/guides/a", "/guides/b"],
  );
  w.history.pushState({}, "", "/guides/private");
  await new Promise((r) => setTimeout(r, 250));
  state = JSON.parse(w.sessionStorage.getItem("jev:v1:demo"));
  assert.equal(state.visits.length, 2);
  w.close();
});
test("restore revalidates stored history against current policy and expires old state", () => {
  const config = {
    allowedPathPrefixes: ["/public/"],
    excludedPathPrefixes: [],
    actionNames: [],
    factNames: [],
  };
  const saved = {
    updated: Date.now(),
    visits: [
      { page: { path: "/private/a", name: "Private" }, visibleMs: 6000 },
      { page: { path: "/public/a", name: "Public" }, visibleMs: 6000 },
    ],
    actions: [{ name: "secret", value: true }],
    facts: { secret: true },
    delivery: { guide: { shown: 1, dismissed: true } },
  };
  const state = restoreState(saved, config);
  assert.equal(state.visits.length, 1);
  assert.deepEqual(state.facts, {});
  assert.deepEqual(state.actions, []);
  saved.updated -= 1800001;
  assert.equal(restoreState(saved, config), null);
});

test("metadata provenance is available locally without changing the wire page schema", () => {
  const dom = new JSDOM(
    '<title>Fallback</title><meta property="og:description" content="OG description"><script type="application/ld+json">{"@type":"Product","name":"Polo","keywords":"sports"}</script>',
    { url: "https://www.example.com/products/polo" },
  );
  const sources = {};
  const page = extractPage(dom.window.document, dom.window.location, sources);
  assert.deepEqual(sources, {
    name: "JSON-LD",
    description: "OGP",
    type: "JSON-LD",
    themes: "JSON-LD",
  });
  assert.equal(page.sources, undefined);
  dom.window.close();
});
