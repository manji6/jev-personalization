const clean = (v, max) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const safeText = (v, max) => {
  const s = clean(v, max);
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\d[ -]?){9,}/i.test(s) ? "" : s;
};
export function extractLegacyPage(doc, location, provenance) {
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

export { safeText };
