import { secureOrLoopback } from "./url-policy.js";
// Shared Web Crypto implementation for Node and Workers. No diagnostic sessions
// or browsing histories are stored on the server.
export const DEBUG_HEADER = "X-JevSense-Debug";
export const DEBUG_TTL_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();
const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const decode = (s) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function issueDebugSession(
  secret,
  site,
  target,
  now = Date.now(),
  identity = {},
) {
  const url = new URL(target);
  if (
    !secureOrLoopback(url.href) ||
    url.username ||
    url.password ||
    !site.origins.includes(url.origin)
  )
    throw new Error("invalid_debug_target");
  // The launcher accepts a page path, never transports credentials in its URL.
  url.search = "";
  url.hash = "";
  const claims = {
    audience: "jevsense-debug-v1",
    siteId: site.id,
    origin: url.origin,
    expiresAt: now + DEBUG_TTL_MS,
    nonce: crypto.randomUUID(),
    ...(identity.actor
      ? { actor: identity.actor, version: identity.version }
      : {}),
  };
  const payload = encode(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    encoder.encode("jevsense-debug-v1." + payload),
  );
  return {
    token: payload + "." + encode(new Uint8Array(signature)),
    expiresAt: claims.expiresAt,
    url: url.href,
    siteId: site.id,
    origin: url.origin,
  };
}
export async function verifyDebugSession(
  secret,
  token,
  siteId,
  origin,
  now = Date.now(),
) {
  try {
    if (
      !secret ||
      typeof token !== "string" ||
      token.length > 2048 ||
      !/^[\w-]+\.[\w-]+$/.test(token)
    )
      return null;
    const [payload, signature] = token.split(".");
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(secret),
        decode(signature),
        encoder.encode("jevsense-debug-v1." + payload),
      ))
    )
      return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
    return claims.audience === "jevsense-debug-v1" &&
      claims.siteId === siteId &&
      claims.origin === origin &&
      Number.isSafeInteger(claims.expiresAt) &&
      claims.expiresAt > now &&
      claims.expiresAt <= now + DEBUG_TTL_MS
      ? claims
      : null;
  } catch {
    return null;
  }
}
