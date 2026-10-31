const encoder = new TextEncoder();
export const bytesToBase64 = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export const base64ToBytes = (s) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
export const randomToken = () =>
  bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
export async function hash(value) {
  return bytesToBase64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}
export async function equal(a, b) {
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
export function cookies(request) {
  return Object.fromEntries(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((v) => v.trim().split("="))
      .filter((v) => v.length === 2),
  );
}
export const SESSION_COOKIE = "__Host-jevsense_session";
export const FLOW_COOKIE = "__Host-jevsense_flow";
export const sessionCookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
export function authConfiguration(origin, secret) {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    ) ||
    url.username ||
    url.password ||
    !secret ||
    secret.length < 32
  )
    throw Error("Invalid AUTH_ORIGIN or AUTH_SECRET");
  return { origin, rpID: url.hostname, secret };
}
