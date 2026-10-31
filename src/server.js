import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { configSchema, inputSchema } from "./schema.js";
import { ALGORITHM_VERSION, prepare, select, draftIntent } from "./engine.js";
import { Store } from "./store.js";
import { createJev } from "./jev.js";
import { publicOffer, customModule } from "./offer-response.js";
import { adminPreviewCSP } from "./admin-preview.js";
import {
  DEBUG_HEADER,
  issueDebugSession,
  verifyDebugSession,
} from "./debug-auth.js";
import {
  createDebugTrace,
  startModelTrace,
  finishModelTrace,
} from "./debug-trace.js";

export async function buildApp({
  store,
  jev,
  adminToken,
  modelName = "jev-1.14.0",
  maxConcurrent = 10,
  dailyRequestBudget = 1000,
}) {
  if (!adminToken || adminToken.length < 32)
    throw new Error("ADMIN_TOKEN must have at least 32 characters");
  const app = Fastify({
    logger: false,
    bodyLimit: 65536,
    requestTimeout: 5000,
    connectionTimeout: 5000,
    trustProxy: false,
  });
  await app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  let active = 0,
    dailyCalls = 0,
    day = new Date().toISOString().slice(0, 10);
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    if (req.url.startsWith("/admin/api/")) {
      const actual = createHash("sha256")
        .update(req.headers.authorization ?? "")
        .digest();
      const wanted = createHash("sha256")
        .update(`Bearer ${adminToken}`)
        .digest();
      if (!timingSafeEqual(actual, wanted))
        return reply.code(401).send({ error: "unauthorized" });
      // Management calls never use ambient browser credentials or CORS.
      if (
        req.headers.origin &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        return reply.code(403).send({ error: "origin_rejected" });
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const code =
      error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    reply.code(code).send({
      error:
        code === 413
          ? "payload_too_large"
          : code === 429
            ? "rate_limited"
            : code === 409
              ? "config_changed_reload"
              : code === 400
                ? "invalid_request"
                : "internal_error",
    });
  });
  app.get("/health", async () => ({ ok: true }));
  app.get("/admin-preview", async (req, reply) => {
    const html = await readFile(
      new URL("../docs/prototypes/admin-v2.html", import.meta.url),
      "utf8",
    );
    return reply
      .header("Content-Security-Policy", await adminPreviewCSP(html))
      .header(
        "Permissions-Policy",
        "publickey-credentials-get=(), publickey-credentials-create=()",
      )
      .type("text/html")
      .send(html);
  });
  app.get("/sdk.js", async (req, reply) =>
    reply
      .type("application/javascript")
      .header("Cache-Control", "public, max-age=300")
      .send(await readFile(new URL("../dist/sdk.js", import.meta.url), "utf8")),
  );
  app.get("/admin", async (req, reply) =>
    reply
      .header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      )
      .type("text/html")
      .send(
        await readFile(
          new URL("../public/admin.html", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.get("/admin.js", async (req, reply) =>
    reply
      .type("application/javascript")
      .send(
        await readFile(new URL("../public/admin.js", import.meta.url), "utf8"),
      ),
  );
  app.get("/offer-renderer.js", async (req, reply) =>
    reply
      .type("application/javascript")
      .send(
        await readFile(
          new URL("../dist/offer-renderer.js", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.get("/admin.css", async (req, reply) =>
    reply
      .type("text/css")
      .send(
        await readFile(new URL("../public/admin.css", import.meta.url), "utf8"),
      ),
  );
  app.get("/admin/api/config", async () => ({
    config: store.get(),
    revision: store.revision(),
  }));
  app.put("/admin/api/config", async (req, reply) => {
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "invalid_config",
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
    // Optimistic concurrency prevents one operator overwriting another's work.
    const revision = createHash("sha256")
      .update(JSON.stringify(store.get()))
      .digest("hex");
    if (req.headers["if-match"] !== revision)
      return reply.code(409).send({ error: "config_changed_reload" });
    await store.save(parsed.data, revision);
    return { ok: true, revision: store.revision() };
  });
  app.get("/admin/api/revision", async () => ({
    revision: createHash("sha256")
      .update(JSON.stringify(store.get()))
      .digest("hex"),
  }));
  app.post("/admin/api/draft", async (req, reply) => {
    const parsed = z
      .object({
        intent: z.string().min(1).max(1000),
        subject: z.string().trim().min(1).max(120),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_request" });
    return draftIntent(parsed.data.intent, parsed.data.subject);
  });
  app.post("/admin/api/debug-session", async (req, reply) => {
    const parsed = z
      .object({ siteId: z.string().max(64), url: z.string().max(2048) })
      .strict()
      .safeParse(req.body);
    const site =
      parsed.success &&
      store.get().sites.find((s) => s.id === parsed.data.siteId);
    if (!site) return reply.code(400).send({ error: "invalid_debug_target" });
    try {
      return await issueDebugSession(adminToken, site, parsed.data.url);
    } catch {
      return reply.code(400).send({ error: "invalid_debug_target" });
    }
  });
  function siteFor(req, reply, id) {
    const site = store.get().sites.find((s) => s.id === id);
    if (!site || !site.origins.includes(req.headers.origin)) {
      reply.code(403).send({ error: "origin_rejected" });
      return null;
    }
    reply
      .header("Access-Control-Allow-Origin", req.headers.origin)
      .header("Vary", "Origin");
    return site;
  }
  app.get(
    "/v1/offer-script/:siteId/:campaignId/:hash.js",
    async (req, reply) => {
      const site = siteFor(req, reply, req.params.siteId);
      if (!site) return;
      const source = await customModule(
        site,
        req.params.campaignId,
        req.params.hash,
      );
      if (source === null) return reply.code(404).send({ error: "not_found" });
      return reply.type("application/javascript").send(source);
    },
  );
  app.options("/v1/decision", async (req, reply) => {
    // The requested site is in the query for preflight; body site must match.
    if (!siteFor(req, reply, req.query.siteId)) return;
    return reply
      .header("Access-Control-Allow-Methods", "POST")
      .header("Access-Control-Allow-Headers", "Content-Type, X-JevSense-Debug")
      .code(204)
      .send();
  });
  app.options("/v1/debug-session", async (req, reply) => {
    if (!siteFor(req, reply, req.query.siteId)) return;
    return reply
      .header("Access-Control-Allow-Methods", "GET")
      .header("Access-Control-Allow-Headers", DEBUG_HEADER)
      .code(204)
      .send();
  });
  app.get("/v1/debug-session", async (req, reply) => {
    if (!siteFor(req, reply, req.query.siteId)) return;
    const session = await verifyDebugSession(
      adminToken,
      req.headers[DEBUG_HEADER.toLowerCase()],
      req.query.siteId,
      req.headers.origin,
    );
    return session
      ? { expiresAt: session.expiresAt }
      : reply.code(401).send({ error: "debug_session_invalid" });
  });
  app.get("/v1/sites/:siteId", async (req, reply) => {
    const s = siteFor(req, reply, req.params.siteId);
    if (!s) return;
    return {
      id: s.id,
      allowedPathPrefixes: s.allowedPathPrefixes,
      excludedPathPrefixes: s.excludedPathPrefixes,
      metadataEnabled: s.metadataEnabled,
      minVisibleMs: s.minVisibleMs,
      actionNames: s.actionNames,
      factNames: s.factNames,
    };
  });
  app.post("/v1/decision", async (req, reply) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_request" });
    const input = parsed.data;
    if (req.query.siteId !== input.siteId)
      return reply.code(400).send({ error: "site_mismatch" });
    const site = siteFor(req, reply, input.siteId);
    if (!site) return;
    const debugToken = req.headers[DEBUG_HEADER.toLowerCase()];
    if (
      debugToken &&
      !(await verifyDebugSession(
        adminToken,
        debugToken,
        site.id,
        req.headers.origin,
      ))
    )
      return reply.code(401).send({ error: "debug_session_invalid" });
    const trace = debugToken ? createDebugTrace(site, input) : null;
    const respond = (body, status = 200) =>
      reply.code(status).send(trace ? { ...body, debug: trace } : body);
    const configVersion = createHash("sha256")
      .update(JSON.stringify(site))
      .digest("hex")
      .slice(0, 16);
    const base = { algorithmVersion: ALGORITHM_VERSION, configVersion };
    if (!site.metadataEnabled)
      return respond({
        ...base,
        decision: "hold",
        reason: "metadata_not_approved",
      });
    const prepared = prepare(site, input);
    if (prepared.reason)
      return respond({ ...base, decision: "hold", reason: prepared.reason });
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) {
      day = today;
      dailyCalls = 0;
    }
    if (dailyCalls >= dailyRequestBudget)
      return respond(
        { ...base, decision: "hold", reason: "budget_exhausted" },
        503,
      );
    if (active >= maxConcurrent)
      return respond({ ...base, decision: "hold", reason: "busy" }, 503);
    active++;
    dailyCalls++;
    const modelStart = performance.now();
    startModelTrace(trace, prepared, modelName);
    try {
      const result = await jev(prepared);
      finishModelTrace(trace, prepared, result, performance.now() - modelStart);
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
      return respond({ ...base, decision: "hold", reason: "model_error" }, 502);
    } finally {
      active--;
    }
  });
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const store = await new Store(
    process.env.CONFIG_PATH ?? "data/config.json",
  ).load();
  const app = await buildApp({
    store,
    adminToken: process.env.ADMIN_TOKEN,
    modelName: process.env.JEV_MODEL ?? "jev-1.14.0",
    jev: createJev({
      apiKey: process.env.JEV_API_KEY,
      model: process.env.JEV_MODEL ?? "jev-1.14.0",
    }),
  });
  await app.listen({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "127.0.0.1",
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => app.close().then(() => process.exit(0)));
}
