import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { extractPage } from "../src/metadata-extractor.js";
import {
  metadataPolicySchema,
  standardMetadata,
  defaultMetadataRules,
  metadataRevision,
} from "../src/metadata-policy.js";
import { install, restoreState } from "../src/sdk.js";
const custom = () => ({ mode: "custom", rules: defaultMetadataRules() });
function documentFor({ title = "HTML title", meta = {}, nodes = [] } = {}) {
  const dom = new JSDOM("<title></title>", {
    url: "https://www.example.com/products/a?private=yes#x",
    pretendToBeVisual: true,
  });
  const d = dom.window.document;
  d.title = title;
  for (const [name, content] of Object.entries(meta)) {
    const el = d.createElement("meta");
    el.name = name;
    el.content = content;
    d.head.append(el);
  }
  for (const node of nodes) {
    const el = d.createElement("script");
    el.type = "application/ld+json";
    el.textContent = JSON.stringify(node);
    d.body.append(el);
  }
  return dom;
}
function extracted(data, policy = custom()) {
  const dom = documentFor(data),
    trace = {};
  try {
    return {
      page: extractPage(
        dom.window.document,
        dom.window.location,
        trace,
        policy,
      ),
      trace,
    };
  } finally {
    dom.window.close();
  }
}
test("standard does not inspect JSON-LD, independently falls back after empty/unsafe OGP and omits type/themes", () => {
  const data = {
    meta: {
      "og:title": "OGP",
      "og:description": "OGP説明",
      description: "meta説明",
    },
    nodes: [
      {
        "@type": "Product",
        name: "JSON商品",
        description: "JSON説明",
        keywords: "商品",
        sku: "A",
      },
    ],
  };
  assert.deepEqual(extracted(data, standardMetadata()).page, {
    path: "/products/a",
    name: "OGP",
    description: "OGP説明",
  });
  data.meta["og:title"] = "";
  data.meta["og:description"] = "person@example.com";
  assert.deepEqual(extracted(data, standardMetadata()).page, {
    path: "/products/a",
    name: "HTML title",
    description: "meta説明",
  });
  data.meta = {};
  data.title = "";
  assert.deepEqual(extracted(data, standardMetadata()).page, {
    path: "/products/a",
    name: "Untitled",
  });
});
test("custom candidates bind conditions and output to one object, handle 0/SKU, missing descriptions, OR, ordering and exact types", () => {
  const data = {
    meta: { "og:title": "OGP", "og:description": "OG説明" },
    nodes: [
      { "@type": "Product", name: "無SKU" },
      { "@type": "Article", name: "別記事", sku: "A" },
    ],
  };
  assert.equal(extracted(data).page.name, "OGP");
  data.nodes[1] = {
    "@type": ["Product", "Thing"],
    sku: 0,
    name: "対象",
    keywords: ["a,b", "c"],
  };
  const result = extracted(data);
  assert.equal(result.page.name, "商品詳細：対象");
  assert.deepEqual(result.page.themes, ["a", "b", "c"]);
  assert.equal(result.page.type, "Product");
  assert.equal(JSON.stringify(result).includes('"sku":'), false);
  const policy = custom();
  policy.rules[0].descriptionPolicy = "next";
  assert.equal(extracted(data, policy).page.name, "OGP");
  policy.rules[0].descriptionPolicy = "allow";
  data.nodes[1]["@type"] = "ProductGroup";
  assert.equal(extracted(data, policy).page.name, "OGP");
  policy.rules[0].combination = "any";
  assert.equal(extracted(data, policy).page.name, "OGP");
  data.nodes[0]["@type"] = "Service";
  assert.equal(extracted(data, policy).page.name, "商品詳細：対象");
  [policy.rules[0], policy.rules[1]] = [policy.rules[1], policy.rules[0]];
  assert.equal(extracted(data, policy).page.name, "OGP");
});
test("ambiguous JSON-LD uses a unique mainEntity or matching URL; itemListElement and external @id are not followed", () => {
  const a = { "@id": "#a", "@type": "Product", name: "A", sku: "A" },
    b = { "@id": "#b", "@type": "Product", name: "B", sku: "B" };
  const data = { meta: { "og:title": "OGP" }, nodes: [{ "@graph": [a, b] }] };
  assert.equal(extracted(data).page.name, "OGP");
  data.nodes.push({
    "@type": "WebPage",
    url: "https://www.example.com/products/a",
    mainEntity: { "@id": "#b" },
  });
  assert.equal(extracted(data).page.name, "商品詳細：B");
  data.nodes = [
    { "@type": "ItemList", itemListElement: [a, b] },
    {
      "@type": "WebPage",
      mainEntity: { "@id": "https://external.example/#item" },
    },
  ];
  assert.equal(extracted(data).page.name, "OGP");
});
test("schema rejects code/property traversal, duplicate IDs, excessive rules/conditions and unknown fields; extraction bounds and guards apply", () => {
  const p = custom();
  for (const key of [
    "__proto__.x",
    "constructor.name",
    "a[0]",
    "a..b",
    "$.name",
    "a.prototype.x",
  ]) {
    p.rules[0].nameOutput.key = key;
    assert.equal(metadataPolicySchema.safeParse(p).success, false);
  }
  assert.equal(
    metadataPolicySchema.safeParse({ ...custom(), extra: 1 }).success,
    false,
  );
  const dup = custom();
  dup.rules.push(dup.rules[0]);
  assert.equal(metadataPolicySchema.safeParse(dup).success, false);
  const many = custom();
  many.rules[0].conditions = Array(6).fill(many.rules[0].conditions[0]);
  assert.equal(metadataPolicySchema.safeParse(many).success, false);
  const result = extracted({
    title: "x".repeat(300),
    nodes: [
      {
        "@type": "Product",
        sku: "A",
        name: "person@example.com",
        description: "12345678901",
      },
    ],
  });
  assert.equal(result.page.name.length, 160);
  assert.equal(result.page.description, undefined);
  assert.equal(
    extracted({
      nodes: [
        { "@type": "Product", sku: false, name: "<img onerror=alert(1)>" },
      ],
    }).page.name,
    "商品詳細：<img onerror=alert(1)>",
  );
});
test("revision is stable and policy-specific; changing it discards only visits, retaining delivery and permitted actions/facts", async () => {
  const revision = await metadataRevision(standardMetadata());
  assert.equal(
    revision,
    await metadataRevision({ rules: [], mode: "standard" }),
  );
  assert.notEqual(revision, await metadataRevision(custom()));
  const saved = {
    updated: Date.now(),
    metadataRevision: "old",
    visits: [{ page: { path: "/products/a", name: "Old" }, visibleMs: 6000 }],
    actions: [{ name: "download" }],
    facts: { done: true },
    delivery: { offer: { shown: 1, dismissed: true } },
  };
  const restored = restoreState(saved, {
    metadataRevision: revision,
    allowedPathPrefixes: ["/products/"],
    excludedPathPrefixes: [],
    actionNames: ["download"],
    factNames: ["done"],
  });
  assert.equal(restored.visits.length, 0);
  assert.deepEqual(restored.delivery, saved.delivery);
  assert.deepEqual(restored.actions, saved.actions);
  assert.deepEqual(restored.facts, saved.facts);
});
test("SDK refreshes stale policy locally, preserves delivery and does not repeat the page decision", async () => {
  const dom = documentFor({
      meta: { "og:title": "New" },
      nodes: [{ "@type": "Product", name: "Old", sku: "A" }],
    }),
    w = dom.window;
  const newPolicy = standardMetadata(),
    revision = await metadataRevision(newPolicy),
    sent = [];
  let configs = 0;
  const base = {
    metadataEnabled: true,
    minVisibleMs: 300000,
    allowedPathPrefixes: ["/products/"],
    excludedPathPrefixes: [],
    actionNames: [],
    factNames: [],
  };
  w.sessionStorage.setItem(
    "jev:v1:demo",
    JSON.stringify({
      updated: Date.now(),
      visits: [],
      actions: [],
      facts: {},
      delivery: { offer: { shown: 1, dismissed: true } },
    }),
  );
  w.fetch = async (url, init) => {
    if (url.includes("/v1/sites/")) {
      configs++;
      return {
        ok: true,
        json: async () =>
          configs === 1
            ? base
            : {
                ...base,
                metadataExtraction: newPolicy,
                metadataRevision: revision,
              },
      };
    }
    const body = JSON.parse(init.body);
    sent.push(body);
    return {
      ok: true,
      status: 200,
      json: async () =>
        sent.length === 1
          ? {
              decision: "hold",
              reason: "metadata_revision_changed",
              metadataRevision: revision,
            }
          : { decision: "hold" },
    };
  };
  const api = install(w, {
    dataset: { site: "demo", api: "https://api.example.com" },
  });
  await api.consent(true);
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(configs, 2);
  assert.equal(sent.length, 1);
  const local = JSON.parse(w.sessionStorage.getItem("jev:v1:demo"));
  assert.equal(local.visits.length, 0);
  assert.equal(local.currentVisit.page.name, "New");
  assert.equal(local.metadataRevision, revision);
  assert.equal(local.delivery.offer.shown, 1);
  await api.decide();
  assert.equal(sent.length, 1);
  await api.consent(false);
  w.close();
});

test("JSON-LD size/node/depth limits skip oversized and deeply nested values without expanding item lists", () => {
  const data = {
    meta: { "og:title": "fallback" },
    nodes: [
      {
        "@graph": Array.from({ length: 210 }, (_, i) => ({
          "@type": "Product",
          name: "Item " + i,
          ...(i === 209 ? { sku: "last" } : {}),
        })),
      },
    ],
  };
  assert.equal(extracted(data).page.name, "fallback");
  data.nodes = [
    {
      "@type": "Product",
      sku: "A",
      name: "Oversize",
      ignored: "x".repeat(100001),
    },
  ];
  assert.equal(extracted(data).page.name, "fallback");
  let nested = { "@type": "Product", sku: "A", name: "Too deep" };
  for (let i = 0; i < 10; i++) nested = { mainEntity: nested };
  data.nodes = [nested];
  assert.equal(extracted(data).page.name, "fallback");
});

test("a delayed settings body cannot overwrite a newer consent generation or restore revoked collection", async () => {
  const dom = documentFor(),
    w = dom.window;
  let resolve,
    calls = 0;
  const base = {
    metadataEnabled: true,
    allowedPathPrefixes: ["/products/"],
    excludedPathPrefixes: [],
    actionNames: [],
    factNames: [],
    minVisibleMs: 300000,
  };
  w.fetch = async (url) => {
    if (url.includes("/v1/sites/")) {
      calls++;
      if (calls === 1)
        return { ok: true, json: () => new Promise((r) => (resolve = r)) };
      return {
        ok: true,
        json: async () => ({ ...base, metadataExtraction: standardMetadata() }),
      };
    }
    return { ok: true, json: async () => ({ decision: "hold" }) };
  };
  const api = install(w, {
    dataset: { site: "demo", api: "https://api.example.com" },
  });
  const first = api.consent(true);
  await new Promise((r) => setTimeout(r, 0));
  await api.consent(false);
  await api.consent(true);
  resolve({ ...base, metadataEnabled: false });
  await first;
  w.document.title = "Updated after consent";
  await new Promise((r) => setTimeout(r, 150));
  const saved = JSON.parse(w.sessionStorage.getItem("jev:v1:demo"));
  assert.equal(saved.currentVisit.page.name, "Updated after consent");
  await api.consent(false);
  w.close();
});
