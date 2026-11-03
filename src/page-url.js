export const MAX_PAGE_URL = 4096;
export function queryKeys(keys = []) {
  return [
    ...new Set(
      keys.filter(
        (k) => typeof k === "string" && k.length > 0 && k.length <= 100,
      ),
    ),
  ];
}
export function sanitizePageUrl(value, excluded = []) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      (url.protocol === "http:" && url.hostname !== "localhost")
    )
      return undefined;
    url.username = "";
    url.password = "";
    url.hash = "";
    const blocked = new Set(queryKeys(excluded));
    // Keep the original encoding/order of parameters that remain in the URL.
    if (blocked.size && url.search) {
      const parts = url.search
        .slice(1)
        .split("&")
        .filter((part) => {
          const keys = [...new URLSearchParams(part).keys()];
          return !keys.some((key) => blocked.has(key));
        });
      url.search = parts.length ? "?" + parts.join("&") : "";
    }
    return url.href.length <= MAX_PAGE_URL ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function pageWithUrl(page, location, excluded = []) {
  const url = sanitizePageUrl(
    typeof location === "string" ? location : location.href,
    excluded,
  );
  return { ...page, ...(url ? { url } : {}) };
}
export function sanitizePage(page, excluded = []) {
  if (!page) return page;
  const { url, ...rest } = page;
  const clean = sanitizePageUrl(url, excluded);
  return { ...rest, ...(clean ? { url: clean } : {}) };
}
export function sanitizeDecisionInput(site, input) {
  return {
    ...input,
    ...(input.currentPage
      ? { currentPage: sanitizePage(input.currentPage, site.excludedQueryKeys) }
      : {}),
    ...(input.entryPage
      ? { entryPage: sanitizePage(input.entryPage, site.excludedQueryKeys) }
      : {}),
    visits: input.visits.map((v) => ({
      ...v,
      page: sanitizePage(v.page, site.excludedQueryKeys),
    })),
  };
}
export function pageUrlMatchesSite(page, site) {
  if (!page?.url) return true;
  try {
    const u = new URL(page.url);
    return site.origins.includes(u.origin) && u.pathname === page.path;
  } catch {
    return false;
  }
}
export function urlConditionMatches(c, input) {
  if (!c.value) return false;
  const page = c.source === "entry" ? input.entryPage : input.currentPage;
  if (!page?.url) return false;
  try {
    const url = new URL(page.url);
    const values =
      c.field === "query" ? url.searchParams.getAll(c.key) : [url.href];
    return values.some((v) =>
      c.operator === "equals"
        ? v === c.value
        : c.operator === "prefix"
          ? v.startsWith(c.value)
          : v.includes(c.value),
    );
  } catch {
    return false;
  }
}
export function urlTargetingMatches(targeting, input) {
  if (!targeting?.conditions?.length) return true;
  const matched = targeting.conditions.map((c) =>
    urlConditionMatches(c, input),
  );
  return targeting.combination === "any"
    ? matched.some(Boolean)
    : matched.every(Boolean);
}
