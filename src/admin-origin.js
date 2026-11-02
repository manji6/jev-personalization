import { secureOrLoopback } from "./url-policy.js";
// Navigation uses a fixed configured origin; request Host never chooses a passkey RP ID.
export function canonicalAdminRedirect(request, origin) {
  if (!["GET", "HEAD"].includes(request.method) || !secureOrLoopback(origin))
    return null;
  const canonical = new URL(origin),
    url = new URL(request.url);
  if (canonical.origin !== origin || url.origin === canonical.origin)
    return null;
  const adminPath =
    url.pathname === "/" ||
    /^\/(?:admin(?:\/|$)|auth(?:\/|$)|control\.(?:js|css)$)/.test(url.pathname);
  if (!adminPath) return null;
  canonical.pathname = url.pathname === "/" ? "/admin" : url.pathname;
  canonical.search = url.search;
  return new Response(null, {
    status: 302,
    headers: {
      Location: canonical.href,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
