import { z } from "zod";
import { configSchema, inputSchema } from "../schema.js";
import { prepare, select, draftIntent, ALGORITHM_VERSION } from "../engine.js";
import { createJev } from "../jev.js";
import { D1Store, revisionOf } from "./store.js";
export { ModelBudget } from "./budget.js";
import { publicOffer, customModule } from "../offer-response.js";
import { adminPreviewCSP } from "../admin-preview.js";
import {
  DEBUG_HEADER,
  issueDebugSession,
  verifyDebugSession,
} from "../debug-auth.js";
import {
  createDebugTrace,
  startModelTrace,
  finishModelTrace,
} from "../debug-trace.js";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const assets = new Map([
  ["/admin", "/admin.html"],
  ["/admin/", "/admin.html"],
  ["/admin.js", "/admin.js"],
  ["/admin.css", "/admin.css"],
  ["/sdk.js", "/sdk.js"],
  ["/offer-renderer.js", "/offer-renderer.js"],
  ["/admin-preview", "/admin-preview.html"],
]);
function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers });
}
function fail(error, status) {
  const e = new Error(error);
  e.status = status;
  throw e;
}
async function readJSON(request) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") ?? "",
    )
  )
    fail("unsupported_media_type", 415);
  if (Number(request.headers.get("Content-Length")) > 65536)
    fail("payload_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) fail("invalid_request", 400);
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 65536) {
      await reader.cancel();
      fail("payload_too_large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    fail("invalid_request", 400);
  }
}
async function authenticated(request, token) {
  const actual = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(request.headers.get("Authorization") ?? ""),
  );
  const expected = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`Bearer ${token}`),
  );
  return crypto.subtle.timingSafeEqual(actual, expected);
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error("Invalid server configuration");
  return n;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url),
      path = url.pathname;
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    try {
      if (path === "/health" && request.method === "GET")
        return finish(json({ ok: true }), headers);
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        assets.has(path)
      ) {
        const assetURL = new URL(request.url);
        assetURL.pathname = assets.get(path);
        assetURL.search = "";
        const response = await env.ASSETS.fetch(
          new Request(assetURL, {
            method: path === "/admin-preview" ? "GET" : request.method,
          }),
        );
        if (path === "/admin-preview") {
          const html = await response.text();
          headers.set("Content-Security-Policy", await adminPreviewCSP(html));
          headers.set(
            "Permissions-Policy",
            "publickey-credentials-get=(), publickey-credentials-create=()",
          );
          return finish(
            new Response(request.method === "HEAD" ? null : html, {
              status: response.status,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
            headers,
          );
        }
        if (path === "/admin" || path === "/admin/")
          headers.set("Content-Security-Policy", CSP);
        if (path === "/sdk.js")
          headers.set("Cache-Control", "public, max-age=300");
        return finish(response, headers);
      }
      if (path === "/")
        return finish(Response.redirect(new URL("/admin", url), 302), headers);
      const admin = path.startsWith("/admin/api/");
      const scriptMatch = path.match(
        /^\/v1\/offer-script\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/([a-f0-9]{64})\.js$/,
      );
      const publicApi =
        scriptMatch ||
        path === "/v1/decision" ||
        path === "/v1/debug-session" ||
        /^\/v1\/sites\/[^/]+$/.test(path);
      if (!admin && !publicApi)
        return finish(json({ error: "not_found" }, 404), headers);
      // Missing bindings/secrets fail closed, never use example credentials.
      if (
        !env.ADMIN_TOKEN ||
        env.ADMIN_TOKEN.length < 32 ||
        !env.DB ||
        !env.MODEL_BUDGET ||
        !env.RATE_LIMITER
      )
        fail("server_not_configured", 503);
      // CF-Connecting-IP is platform-provided in production, never persisted by this app.
      const { success } = await env.RATE_LIMITER.limit({
        key: request.headers.get("CF-Connecting-IP") ?? "unknown",
      });
      if (!success) {
        headers.set("Retry-After", "60");
        fail("rate_limited", 429);
      }
      if (admin) {
        if (!(await authenticated(request, env.ADMIN_TOKEN)))
          fail("unauthorized", 401);
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin) fail("origin_rejected", 403);
      }
      const store = new D1Store(env.DB);
      if (admin) {
        if (path === "/admin/api/debug-session" && request.method === "POST") {
          const parsed = z
            .object({ siteId: z.string().max(64), url: z.string().max(2048) })
            .strict()
            .safeParse(await readJSON(request));
          const site =
            parsed.success &&
            (await store.load()).config.sites.find(
              (s) => s.id === parsed.data.siteId,
            );
          if (!site) fail("invalid_debug_target", 400);
          let session;
          try {
            session = await issueDebugSession(
              env.ADMIN_TOKEN,
              site,
              parsed.data.url,
            );
          } catch {
            fail("invalid_debug_target", 400);
          }
          return finish(json(session), headers);
        }
        if (path === "/admin/api/config" && request.method === "GET")
          return finish(json(await store.load()), headers);
        if (path === "/admin/api/revision" && request.method === "GET")
          return finish(
            json({ revision: (await store.load()).revision }),
            headers,
          );
        if (path === "/admin/api/config" && request.method === "PUT") {
          const parsed = configSchema.safeParse(await readJSON(request));
          if (!parsed.success)
            return finish(
              json(
                {
                  error: "invalid_config",
                  issues: parsed.error.issues.map((i) => ({
                    path: i.path,
                    message: i.message,
                  })),
                },
                400,
              ),
              headers,
            );
          const expected = request.headers.get("If-Match");
          if (!expected) fail("config_changed_reload", 409);
          const saved = await store.save(parsed.data, expected);
          return finish(json({ ok: true, revision: saved.revision }), headers);
        }
        if (path === "/admin/api/draft" && request.method === "POST") {
          const parsed = z
            .object({
              intent: z.string().min(1).max(1000),
              subject: z.string().trim().min(1).max(120),
            })
            .strict()
            .safeParse(await readJSON(request));
          if (!parsed.success) fail("invalid_request", 400);
          return finish(
            json(draftIntent(parsed.data.intent, parsed.data.subject)),
            headers,
          );
        }
        return finish(json({ error: "not_found" }, 404), headers);
      }
      const siteId = scriptMatch
        ? scriptMatch[1]
        : path.startsWith("/v1/sites/")
          ? decodeURIComponent(path.slice(10))
          : url.searchParams.get("siteId");
      const { config } = await store.load();
      const site = config.sites.find((s) => s.id === siteId);
      const origin = request.headers.get("Origin");
      if (!site || !site.origins.includes(origin)) fail("origin_rejected", 403);
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
      if (scriptMatch && request.method === "GET") {
        const source = await customModule(site, scriptMatch[2], scriptMatch[3]);
        return finish(
          source === null
            ? json({ error: "not_found" }, 404)
            : new Response(source, {
                headers: {
                  "Content-Type": "application/javascript; charset=utf-8",
                },
              }),
          headers,
        );
      }
      if (
        ["/v1/decision", "/v1/debug-session"].includes(path) &&
        request.method === "OPTIONS"
      ) {
        headers.set(
          "Access-Control-Allow-Methods",
          path === "/v1/decision" ? "POST" : "GET",
        );
        headers.set(
          "Access-Control-Allow-Headers",
          "Content-Type, X-JevSense-Debug",
        );
        return finish(new Response(null, { status: 204 }), headers);
      }
      if (path === "/v1/debug-session" && request.method === "GET") {
        const session = await verifyDebugSession(
          env.ADMIN_TOKEN,
          request.headers.get(DEBUG_HEADER),
          siteId,
          origin,
        );
        return finish(
          session
            ? json({ expiresAt: session.expiresAt })
            : json({ error: "debug_session_invalid" }, 401),
          headers,
        );
      }
      if (path.startsWith("/v1/sites/") && request.method === "GET") {
        const {
          id,
          allowedPathPrefixes,
          excludedPathPrefixes,
          metadataEnabled,
          minVisibleMs,
          actionNames,
          factNames,
        } = site;
        return finish(
          json({
            id,
            allowedPathPrefixes,
            excludedPathPrefixes,
            metadataEnabled,
            minVisibleMs,
            actionNames,
            factNames,
          }),
          headers,
        );
      }
      if (path !== "/v1/decision" || request.method !== "POST")
        return finish(json({ error: "method_not_allowed" }, 405), headers);
      const parsed = inputSchema.safeParse(await readJSON(request));
      if (!parsed.success) fail("invalid_request", 400);
      if (parsed.data.siteId !== siteId) fail("site_mismatch", 400);
      const debugToken = request.headers.get(DEBUG_HEADER);
      if (
        debugToken &&
        !(await verifyDebugSession(env.ADMIN_TOKEN, debugToken, siteId, origin))
      )
        fail("debug_session_invalid", 401);
      const trace = debugToken ? createDebugTrace(site, parsed.data) : null;
      const respond = (body, status = 200) =>
        finish(json(trace ? { ...body, debug: trace } : body, status), headers);
      const base = {
        algorithmVersion: ALGORITHM_VERSION,
        configVersion: (await revisionOf(site)).slice(0, 16),
      };
      if (!site.metadataEnabled)
        return respond({
          ...base,
          decision: "hold",
          reason: "metadata_not_approved",
        });
      const prepared = prepare(site, parsed.data);
      if (prepared.reason)
        return respond({ ...base, decision: "hold", reason: prepared.reason });
      if (!env.JEV_API_KEY)
        return respond(
          { ...base, decision: "hold", reason: "model_not_configured" },
          503,
        );
      const budget = env.MODEL_BUDGET.get(
        env.MODEL_BUDGET.idFromName("global"),
      );
      const permit = await budget.acquire({
        dailyLimit: integer(env.DAILY_REQUEST_BUDGET, 1000, 0, 1000000),
        maxConcurrent: integer(env.MAX_CONCURRENT, 10, 1, 100),
      });
      if (!permit.token)
        return respond(
          { ...base, decision: "hold", reason: permit.reason },
          503,
        );
      const modelStart = performance.now();
      startModelTrace(trace, prepared, env.JEV_MODEL ?? "jev-1.14.0");
      try {
        const result = await createJev({
          apiKey: env.JEV_API_KEY,
          model: env.JEV_MODEL ?? "jev-1.14.0",
        })(prepared);
        finishModelTrace(
          trace,
          prepared,
          result,
          performance.now() - modelStart,
        );
        const selected = select(prepared, result);
        return respond({
          ...base,
          model: result.model,
          decision: selected ? "show" : "hold",
          reason: selected ? "qualified" : "no_match_or_uncertain",
          campaign: await publicOffer(site, selected),
        });
      } catch {
        if (trace) {
          trace.model.elapsedMs = Math.round(performance.now() - modelStart);
          trace.model.error = "model_error";
        }
        return respond(
          { ...base, decision: "hold", reason: "model_error" },
          502,
        );
      } finally {
        await budget.release(permit.token);
      }
    } catch (error) {
      const known = [400, 401, 403, 409, 413, 415, 429, 503].includes(
        error.status,
      );
      return finish(
        json(
          {
            error: known
              ? error.status === 409
                ? "config_changed_reload"
                : error.message
              : "internal_error",
          },
          known ? error.status : 500,
        ),
        headers,
      );
    }
  },
};
function finish(response, headers) {
  const result = new Response(response.body, response);
  for (const [key, value] of headers) result.headers.set(key, value);
  return result;
}
