import { extractLegacyPage, safeText } from "./legacy-metadata.js";
const has = (v, k) => v && typeof v === "object" && Object.hasOwn(v, k);
export function metadataValue(object, key) {
  let value = object;
  for (const part of key.split(".")) {
    if (
      ["__proto__", "constructor", "prototype"].includes(part) ||
      !has(value, part)
    )
      return undefined;
    value = value[part];
  }
  return value;
}
function readPage(doc) {
  const meta = Object.create(null);
  for (const tag of [...doc.querySelectorAll("meta")].slice(0, 200)) {
    for (const key of [tag.getAttribute("property"), tag.getAttribute("name")])
      if (key && !Object.hasOwn(meta, key)) meta[key] = tag.content;
  }
  return { title: doc.title, meta };
}
function readNodes(doc) {
  const nodes = [];
  function walk(v, depth = 0) {
    if (depth > 8 || nodes.length >= 200) return;
    if (Array.isArray(v)) v.slice(0, 100).forEach((n) => walk(n, depth + 1));
    else if (v && typeof v === "object") {
      nodes.push(v);
      if (has(v, "@graph")) walk(v["@graph"], depth + 1);
      if (has(v, "mainEntity")) walk(v.mainEntity, depth + 1);
    }
  }
  for (const tag of [
    ...doc.querySelectorAll('script[type="application/ld+json"]'),
  ].slice(0, 10)) {
    if (tag.textContent.length > 100000) continue;
    try {
      walk(JSON.parse(tag.textContent));
    } catch {}
  }
  return nodes;
}
const nonempty = (v) =>
  v !== undefined &&
  v !== null &&
  (typeof v !== "string" || !!v.trim()) &&
  (!Array.isArray(v) || v.length > 0);
function matches(v, c) {
  if (c.op === "exists") return v !== undefined;
  if (c.op === "nonempty") return nonempty(v);
  if (c.op === "includes")
    return []
      .concat(v ?? [])
      .some(
        (x) =>
          ["string", "number", "boolean"].includes(typeof x) &&
          String(x) === c.value,
      );
  return (
    ["string", "number", "boolean"].includes(typeof v) && String(v) === c.value
  );
}
function samePage(value, url) {
  if (typeof value !== "string" || !value) return false;
  try {
    const v = new URL(value, url);
    return (
      v.origin === url.origin &&
      v.pathname.replace(/\/$/, "") === url.pathname.replace(/\/$/, "")
    );
  } catch {
    return false;
  }
}
function selectNode(candidates, nodes, url) {
  if (candidates.length < 2) return candidates[0];
  const pages = nodes.filter(
    (n) =>
      [].concat(n["@type"] ?? []).includes("WebPage") &&
      (samePage(n.url, url) || samePage(n["@id"], url)),
  );
  const linked = [];
  for (const p of pages)
    for (const e of [].concat(p.mainEntity ?? [])) {
      if (!e || typeof e !== "object") continue;
      if (candidates.includes(e)) linked.push(e);
      else if (typeof e["@id"] === "string")
        linked.push(...candidates.filter((n) => n["@id"] === e["@id"]));
    }
  const unique = [...new Set(linked)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return undefined;
  const attached = candidates.filter(
    (n) =>
      samePage(n.url, url) ||
      samePage(n.mainEntityOfPage?.["@id"] ?? n.mainEntityOfPage, url),
  );
  return attached.length === 1 ? attached[0] : undefined;
}
export function extractPage(doc, location, provenance, policy) {
  if (!policy) return extractLegacyPage(doc, location, provenance);
  const url = new URL(location.href),
    data = readPage(doc),
    trace = [];
  let sources = {},
    page = { path: url.pathname, name: "Untitled" };
  const read = (spec, node) =>
    spec.source === "title"
      ? data.title
      : spec.source === "meta"
        ? data.meta[spec.key]
        : metadataValue(node, spec.key);
  const formatted = (spec, node, max) => {
    const value = safeText(read(spec, node), max);
    return value ? safeText((spec.prefix || "") + value, max) : "";
  };
  const source = (spec) =>
    spec.source === "title"
      ? "HTML title"
      : `${spec.source === "meta" ? "meta" : "JSON-LD"}.${spec.key}`;
  if (policy.mode === "standard") {
    const choose = (list, max) => {
      for (const [v, s] of list) {
        const value = safeText(v, max);
        if (value) return { value, source: s };
      }
      return { value: "" };
    };
    const name = choose(
      [
        [data.meta["og:title"], "meta.og:title"],
        [data.title, "HTML title"],
      ],
      160,
    );
    const description = choose(
      [
        [data.meta["og:description"], "meta.og:description"],
        [data.meta.description, "meta.description"],
      ],
      400,
    );
    page.name = name.value || "Untitled";
    if (description.value) page.description = description.value;
    sources = {
      name: name.source || "既定値",
      ...(description.value ? { description: description.source } : {}),
    };
    trace.push({
      name: "標準の自動取得",
      adopted: true,
      reason: "OGP → HTML title・meta description。JSON-LDは参照しません。",
    });
  } else {
    const rules = policy.rules.slice(0, 10);
    const needsNodes = rules.some(
      (r) =>
        r.enabled &&
        [...r.conditions, r.nameOutput, r.descriptionOutput].some(
          (v) => v.source === "jsonld",
        ),
    );
    const nodes = needsNodes ? readNodes(doc) : [];
    let adopted = false;
    for (const [index, r] of rules.entries()) {
      const row = {
        rank: index + 1,
        id: r.id,
        name: r.name,
        adopted: false,
        reason: "",
      };
      trace.push(row);
      if (!r.enabled) {
        row.reason = "無効な候補";
        continue;
      }
      if (adopted) {
        row.reason = "上位の候補を採用したため未評価";
        continue;
      }
      const usesJson = [
        ...r.conditions,
        r.nameOutput,
        r.descriptionOutput,
      ].some((v) => v.source === "jsonld");
      const test = (n) => {
        const values = r.conditions.map((c) => matches(read(c, n), c));
        return r.combination === "all"
          ? values.every(Boolean)
          : values.some(Boolean);
      };
      const candidates = usesJson ? nodes.filter(test) : [];
      const node = usesJson ? selectNode(candidates, nodes, url) : undefined;
      if (usesJson && !node) {
        row.reason =
          candidates.length > 1
            ? "候補が複数あり、ページの対象を特定できません"
            : "条件に一致するJSON-LDがありません";
        continue;
      }
      if (!usesJson && !test(undefined)) {
        row.reason = "条件を満たしません";
        continue;
      }
      const name = formatted(r.nameOutput, node, 160),
        description = formatted(r.descriptionOutput, node, 400);
      row.conditions = r.conditions.map((c) => ({
        source: source(c),
        op: c.op,
        matched: matches(read(c, node), c),
      }));
      if (!name) {
        row.reason = "ページ名が空、または共通ガードで除外されました";
        continue;
      }
      if (!description && r.descriptionPolicy === "next") {
        row.reason = "説明がないため次の候補へ進みます";
        continue;
      }
      page.name = name;
      if (description) page.description = description;
      sources = {
        name: source(r.nameOutput),
        ...(description ? { description: source(r.descriptionOutput) } : {}),
      };
      if (node) {
        const type = safeText(
          [].concat(node["@type"] ?? []).find((v) => typeof v === "string"),
          80,
        );
        if (type) {
          page.type = type;
          sources.type = "JSON-LD.@type";
        }
        const themes = []
          .concat(node.articleSection ?? node.keywords ?? [])
          .filter((v) => typeof v === "string")
          .flatMap((v) => v.split(","))
          .map((v) => safeText(v, 80))
          .filter(Boolean)
          .slice(0, 8);
        if (themes.length) {
          page.themes = themes;
          sources.themes = "JSON-LD.articleSection / keywords";
        }
      }
      row.adopted = true;
      row.reason = "条件と取得値を確認できました";
      adopted = true;
    }
  }
  if (provenance) Object.assign(provenance, { ...sources, trace });
  return page;
}

// Watch metadata in head and JSON-LD in body, including insertion/removal after navigation.
// Ordinary body content and form changes are not observation triggers.
export function observePageMetadata(win, callback) {
  const relevant = (node) => {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return !!el?.closest('head,script[type="application/ld+json"]');
  };
  const addedMetadata = (node) =>
    relevant(node) ||
    (node?.nodeType === 1 &&
      !!node.querySelector?.('script[type="application/ld+json"]'));
  const observer = new win.MutationObserver((records) => {
    if (
      records.some(
        (r) =>
          relevant(r.target) ||
          (r.type === "attributes" &&
            r.attributeName === "type" &&
            r.target.tagName === "SCRIPT") ||
          [...r.addedNodes, ...r.removedNodes].some(addedMetadata),
      )
    )
      callback();
  });
  observer.observe(win.document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  return observer;
}
