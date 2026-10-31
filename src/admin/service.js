import { z } from "zod";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { AdminDatabase } from "./database.js";
import {
  randomToken,
  hash,
  equal,
  cookies,
  sessionCookie,
  SESSION_COOKIE,
  FLOW_COOKIE,
  bytesToBase64,
  base64ToBytes,
  authConfiguration,
} from "./crypto.js";
import { siteSchema, campaignSchema, id } from "../schema.js";
import { guidedJudgmentSchema, guidedQuestions } from "../questions.js";
import { pathAllowed, targetMatches } from "../engine.js";
import { publicOffer, codeHash } from "../offer-response.js";
import {
  issueDebugSession,
  verifyDebugSession,
  DEBUG_HEADER,
} from "../debug-auth.js";

const emailSchema = z
  .email()
  .trim()
  .max(254)
  .transform((v) => v.toLowerCase());
const nameSchema = z.string().trim().min(1).max(80);
const roleSchema = z.enum(["admin", "editor", "viewer"]);
const registrationResponseSchema = z
  .object({
    challengeId: z.uuid(),
    response: z.record(z.string(), z.unknown()),
  })
  .strict();
const FIVE = 300000,
  DAY = 86400000,
  SESSION_AGE = 12 * 3600000,
  IDLE = 30 * 60000;
const errors = {
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  428: "reauthentication_required",
};
function fail(status, code = errors[status]) {
  const e = new Error(code);
  e.status = status;
  throw e;
}
export async function readAdminJSON(request) {
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  )
    fail(415, "json_required");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_request");
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) {
      await reader.cancel();
      fail(413, "payload_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(400, "invalid_request");
  }
}
const actorPermission = `EXISTS(SELECT 1 FROM admin_users a WHERE a.id=? AND a.status='active' AND (a.global_role='superuser' OR EXISTS(SELECT 1 FROM admin_memberships m WHERE m.user_id=a.id AND m.site_id=? AND m.role IN ('admin','editor'))))`;
const actorAdmin = `EXISTS(SELECT 1 FROM admin_users a WHERE a.id=? AND a.status='active' AND (a.global_role='superuser' OR EXISTS(SELECT 1 FROM admin_memberships m WHERE m.user_id=a.id AND m.site_id=? AND m.role='admin')))`;
const validIssuer = `EXISTS(SELECT 1 FROM admin_users a WHERE a.id=i.created_by AND a.status='active' AND (a.global_role='superuser' OR (i.kind='invite' AND EXISTS(SELECT 1 FROM admin_memberships m WHERE m.user_id=a.id AND m.site_id=i.site_id AND m.role='admin'))))`;
export function createAdministration({
  db,
  origin,
  secret,
  bootstrapToken,
  assets,
  clock = Date.now,
  defaults = {},
}) {
  const config = authConfiguration(origin, secret),
    repo = new AdminDatabase(db);
  const initialDefaults = z
    .object({
      model: z
        .string()
        .regex(/^[\w.-]{1,80}$/)
        .optional(),
      dailyRequestBudget: z.number().int().min(0).max(1000000).optional(),
      maxConcurrent: z.number().int().min(1).max(100).optional(),
    })
    .strict()
    .parse(
      Object.fromEntries(
        Object.entries(defaults).filter(([, v]) => v !== undefined),
      ),
    );
  async function runtimeSettings() {
    const settings = await repo.settings();
    return settings.initialized
      ? settings
      : { ...settings, ...initialDefaults };
  }
  const out = (value, status = 200, extra = {}) =>
    Response.json(value, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        ...extra,
      },
    });
  async function actor(request, required = true) {
    const token = cookies(request)[SESSION_COOKIE];
    let row = null;
    if (token && token.length < 128)
      row = await repo.one(
        `SELECT s.*,u.email,u.display_name,u.global_role,u.status,u.version FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=? AND u.status='active' AND u.version=s.user_version AND s.expires_at>? AND s.last_seen>?`,
        await hash(token),
        clock(),
        clock() - IDLE,
      );
    if (!row) {
      if (required) fail(401);
      return null;
    }
    if (clock() - row.last_seen > 60000)
      await repo.run(
        "UPDATE admin_sessions SET last_seen=? WHERE token_hash=?",
        clock(),
        row.token_hash,
      );
    return row;
  }
  async function csrf(request, session) {
    if (
      request.headers.get("origin") !== origin ||
      !(await equal(request.headers.get("X-JevSense-CSRF") || "", session.csrf))
    )
      fail(403, "csrf_rejected");
  }
  function recent(session) {
    if (clock() - session.authenticated_at > FIVE) fail(428);
  }
  function superuser(session) {
    if (session.global_role !== "superuser") fail(403);
  }
  const profile = (row) => ({
    id: row.user_id || row.id,
    email: row.email,
    displayName: row.display_name,
    globalRole: row.global_role,
    status: row.status,
  });
  async function permission(session, siteId, kind = "view") {
    const current = await repo.one(
      "SELECT * FROM admin_users WHERE id=? AND status='active'",
      session.user_id || session.id,
    );
    if (!current) fail(401);
    let role =
      current.global_role === "superuser"
        ? "superuser"
        : (
            await repo.one(
              "SELECT role FROM admin_memberships WHERE user_id=? AND site_id=?",
              current.id,
              siteId,
            )
          )?.role;
    if (
      !role ||
      (kind === "admin" && !["superuser", "admin"].includes(role)) ||
      (kind === "edit" && role === "viewer")
    )
      fail(403);
    return role;
  }
  async function allowedSite(session, siteId, kind = "view") {
    const role = await permission(session, siteId, kind);
    const value = await repo.site(siteId);
    if (!value) fail(404);
    return { ...value, role };
  }
  async function sessionResponse(userId, request) {
    const user = await repo.one(
      "SELECT * FROM admin_users WHERE id=? AND status='active'",
      userId,
    );
    if (!user) fail(401);
    const token = randomToken(),
      csrfToken = randomToken(),
      now = clock();
    const old = cookies(request)[SESSION_COOKIE];
    if (old)
      await repo.run(
        "DELETE FROM admin_sessions WHERE token_hash=?",
        await hash(old),
      );
    await repo.run(
      "INSERT INTO admin_sessions(token_hash,user_id,user_version,csrf,created_at,last_seen,expires_at,authenticated_at) VALUES(?,?,?,?,?,?,?,?)",
      await hash(token),
      userId,
      user.version,
      csrfToken,
      now,
      now,
      now + SESSION_AGE,
      now,
    );
    return out({ user: profile(user), csrf: csrfToken }, 200, {
      "Set-Cookie": sessionCookie(SESSION_COOKIE, token, SESSION_AGE / 1000),
    });
  }
  async function challenge(request, kind, context, options) {
    const now = clock();
    await repo.run("DELETE FROM admin_challenges WHERE expires_at<?", now);
    await repo.run(
      "DELETE FROM admin_sessions WHERE expires_at<? OR last_seen<?",
      now,
      now - IDLE,
    );
    let browser = cookies(request)[FLOW_COOKIE];
    if (!browser || !/^[-\w]{43}$/.test(browser)) browser = randomToken();
    const challengeId = crypto.randomUUID();
    await repo.run(
      "INSERT INTO admin_challenges(id,challenge,browser_hash,kind,context,expires_at) VALUES(?,?,?,?,?,?)",
      challengeId,
      options.challenge,
      await hash(browser),
      kind,
      JSON.stringify(context),
      now + FIVE,
    );
    return out({ options, challengeId }, 200, {
      "Set-Cookie": sessionCookie(FLOW_COOKIE, browser, 600),
    });
  }
  async function consumeChallenge(request, body, kinds) {
    const row = await repo.one(
      "SELECT * FROM admin_challenges WHERE id=?",
      body.challengeId,
    );
    if (
      !row ||
      !kinds.includes(row.kind) ||
      row.used ||
      row.expires_at <= clock() ||
      !(await equal(
        row.browser_hash,
        await hash(cookies(request)[FLOW_COOKIE] || ""),
      ))
    )
      fail(400, "challenge_expired");
    if (
      !(await repo.run(
        "UPDATE admin_challenges SET used=1 WHERE id=? AND used=0 AND expires_at>?",
        row.id,
        clock(),
      ))
    )
      fail(400, "challenge_expired");
    return { ...row, data: JSON.parse(row.context) };
  }
  async function registrationOptions(request, kind, data) {
    const uid = data.userId || crypto.randomUUID();
    data.userId = uid;
    const credentials =
      kind === "add"
        ? await repo.all(
            "SELECT id,transports FROM admin_credentials WHERE user_id=?",
            uid,
          )
        : [];
    if (credentials.length >= 10) fail(409, "passkey_limit");
    const options = await generateRegistrationOptions({
      rpName: "JevSense",
      rpID: config.rpID,
      userID: new TextEncoder().encode(uid),
      userName: data.email,
      userDisplayName: data.name,
      attestationType: "none",
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      excludeCredentials: credentials.map((c) => ({
        id: c.id,
        transports: JSON.parse(c.transports),
      })),
    });
    return challenge(request, kind, data, options);
  }
  async function validInvitation(tokenHash, kind) {
    return repo.one(
      `SELECT i.* FROM admin_invitations i WHERE i.token_hash=? AND i.kind=? AND i.used=0 AND i.expires_at>? AND ${validIssuer}`,
      tokenHash,
      kind,
      clock(),
    );
  }
  function credentialInsert(info, uid, label, condition = "1", args = []) {
    return [
      `INSERT INTO admin_credentials(id,user_id,public_key,counter,transports,device_type,backed_up,label,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${condition}`,
      info.credential.id,
      uid,
      bytesToBase64(info.credential.publicKey),
      info.credential.counter,
      JSON.stringify(info.credential.transports || []),
      info.credentialDeviceType || "unknown",
      info.credentialBackedUp ? 1 : 0,
      label,
      clock(),
      ...args,
    ];
  }
  async function invitationCondition(tokenHash, kind) {
    return [
      `EXISTS(SELECT 1 FROM admin_invitations i WHERE i.token_hash=? AND i.kind=? AND i.used=0 AND i.expires_at>? AND ${validIssuer})`,
      [tokenHash, kind, clock()],
    ];
  }
  async function verifyRegistration(request, body) {
    const ch = await consumeChallenge(request, body, [
      "setup",
      "invite",
      "recover",
      "add",
    ]);
    let result;
    try {
      result = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: ch.challenge,
        expectedOrigin: origin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      });
    } catch {
      fail(400, "registration_failed");
    }
    if (!result.verified) fail(400, "registration_failed");
    const d = ch.data,
      info = result.registrationInfo,
      uid = d.userId;
    if (ch.kind === "setup") {
      await repo.batch([
        [
          "INSERT OR REPLACE INTO admin_sites(id,body,revision) SELECT json_extract(value,'$.id'),json(value),lower(hex(randomblob(16))) FROM json_each((SELECT body FROM app_config WHERE id=1),'$.sites') WHERE (SELECT initialized FROM admin_settings WHERE id=1)=0",
        ],
        [
          "INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) SELECT ?,?,?,'superuser','active',? WHERE (SELECT initialized FROM admin_settings WHERE id=1)=0 AND NOT EXISTS(SELECT 1 FROM admin_users)",
          uid,
          d.email,
          d.name,
          clock(),
        ],
        credentialInsert(
          info,
          uid,
          d.label || "最初のパスキー",
          "EXISTS(SELECT 1 FROM admin_users WHERE id=?)",
          [uid],
        ),
        [
          "UPDATE admin_settings SET initialized=1,body=?,revision=? WHERE id=1 AND initialized=0 AND EXISTS(SELECT 1 FROM admin_credentials WHERE user_id=?)",
          JSON.stringify(
            Object.fromEntries(
              Object.entries(await runtimeSettings()).filter(
                ([k]) => !["revision", "initialized"].includes(k),
              ),
            ),
          ),
          crypto.randomUUID(),
          uid,
        ],
      ]);
    } else if (ch.kind === "invite") {
      const [condition, args] = await invitationCondition(
        d.tokenHash,
        "invite",
      );
      await repo.batch([
        [
          `INSERT INTO admin_users(id,email,display_name,global_role,status,created_at) SELECT ?,?,?,'member','active',? WHERE ${condition} AND NOT EXISTS(SELECT 1 FROM admin_users WHERE email=?)`,
          uid,
          d.email,
          d.name,
          clock(),
          ...args,
          d.email,
        ],
        credentialInsert(
          info,
          uid,
          "最初のパスキー",
          "EXISTS(SELECT 1 FROM admin_users WHERE id=?)",
          [uid],
        ),
        [
          `INSERT OR IGNORE INTO admin_memberships(user_id,site_id,role) SELECT ?,i.site_id,i.role FROM admin_invitations i WHERE i.token_hash=? AND i.used=0 AND i.expires_at>? AND ${validIssuer} AND EXISTS(SELECT 1 FROM admin_credentials WHERE user_id=?)`,
          uid,
          d.tokenHash,
          clock(),
          uid,
        ],
        [
          "UPDATE admin_invitations SET used=1 WHERE token_hash=? AND EXISTS(SELECT 1 FROM admin_credentials WHERE user_id=?)",
          d.tokenHash,
          uid,
        ],
      ]);
    } else if (ch.kind === "add") {
      const session = await actor(request);
      await csrf(request, session);
      recent(session);
      if (session.user_id !== uid) fail(403);
      await repo.batch([
        credentialInsert(
          info,
          uid,
          d.label,
          "(SELECT count(*) FROM admin_credentials WHERE user_id=?)<10",
          [uid],
        ),
      ]);
    } else {
      const user = await repo.one(
        "SELECT * FROM admin_users WHERE id=? AND status='active'",
        uid,
      );
      if (!user) fail(400, "recovery_invalid");
      const condition = d.codeHash
        ? "EXISTS(SELECT 1 FROM admin_recovery_codes WHERE code_hash=? AND user_id=? AND used=0)"
        : `EXISTS(SELECT 1 FROM admin_invitations i WHERE i.token_hash=? AND i.kind='recovery' AND i.target_user=? AND i.used=0 AND i.expires_at>? AND ${validIssuer})`;
      const args = d.codeHash ? [d.codeHash, uid] : [d.tokenHash, uid, clock()];
      await repo.batch([
        credentialInsert(
          info,
          uid,
          "復旧したパスキー",
          `(${condition}) AND EXISTS(SELECT 1 FROM admin_users WHERE id=? AND status='active')`,
          [...args, uid],
        ),
        [
          "DELETE FROM admin_credentials WHERE user_id=? AND id<>? AND EXISTS(SELECT 1 FROM admin_credentials WHERE id=?)",
          uid,
          info.credential.id,
          info.credential.id,
        ],
        [
          "UPDATE admin_users SET version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM admin_credentials WHERE id=?)",
          uid,
          info.credential.id,
        ],
        [
          "DELETE FROM admin_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM admin_credentials WHERE id=?)",
          uid,
          info.credential.id,
        ],
        [
          "UPDATE admin_recovery_codes SET used=1 WHERE user_id=? AND EXISTS(SELECT 1 FROM admin_credentials WHERE id=?)",
          uid,
          info.credential.id,
        ],
        [
          "UPDATE admin_invitations SET used=1 WHERE kind='recovery' AND target_user=? AND EXISTS(SELECT 1 FROM admin_credentials WHERE id=?)",
          uid,
          info.credential.id,
        ],
      ]);
    }
    if (
      !(await repo.one(
        "SELECT id FROM admin_credentials WHERE id=? AND user_id=?",
        info.credential.id,
        uid,
      ))
    )
      fail(409, "registration_state_changed");
    await repo.audit(uid, `passkey.${ch.kind}`, null, uid);
    return ch.kind === "add"
      ? out({ ok: true })
      : sessionResponse(uid, request);
  }
  async function verifyAuthentication(request, body) {
    const ch = await consumeChallenge(request, body, ["login", "reauth"]);
    const cred = await repo.one(
      "SELECT c.*,u.email,u.status FROM admin_credentials c JOIN admin_users u ON u.id=c.user_id WHERE c.id=? AND u.status='active'",
      body.response.id || "",
    );
    if (
      !cred ||
      cred.email.toLowerCase() !== ch.data.email ||
      (body.response.response?.userHandle &&
        new TextDecoder().decode(
          base64ToBytes(body.response.response.userHandle),
        ) !== cred.user_id)
    )
      fail(400, "authentication_failed");
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: ch.challenge,
        expectedOrigin: origin,
        expectedRPID: config.rpID,
        credential: {
          id: cred.id,
          publicKey: base64ToBytes(cred.public_key),
          counter: cred.counter,
          transports: JSON.parse(cred.transports),
        },
        requireUserVerification: true,
      });
    } catch {
      fail(400, "authentication_failed");
    }
    if (
      !result.verified ||
      !(await repo.run(
        "UPDATE admin_credentials SET counter=?,last_used_at=? WHERE id=? AND counter=?",
        result.authenticationInfo.newCounter,
        clock(),
        cred.id,
        cred.counter,
      ))
    )
      fail(400, "authentication_failed");
    if (ch.kind === "reauth") {
      const session = await actor(request);
      await csrf(request, session);
      if (
        session.user_id !== cred.user_id ||
        session.token_hash !== ch.data.sessionHash
      )
        fail(403);
      await repo.run(
        "UPDATE admin_sessions SET authenticated_at=? WHERE token_hash=?",
        clock(),
        session.token_hash,
      );
      return out({ ok: true });
    }
    await repo.audit(cred.user_id, "session.login");
    return sessionResponse(cred.user_id, request);
  }
  async function saveSite(session, site, revision, admin, draftGuard) {
    const parsed = siteSchema.parse(site),
      next = crypto.randomUUID();
    const changes = await repo.run(
      `UPDATE admin_sites SET body=?,revision=? WHERE id=? AND revision=? AND ${admin ? actorAdmin : actorPermission}${draftGuard ? " AND EXISTS(SELECT 1 FROM admin_drafts WHERE site_id=? AND campaign_id=? AND revision=?)" : ""}`,
      JSON.stringify(parsed),
      next,
      site.id,
      revision,
      session.user_id,
      site.id,
      ...(draftGuard ? [site.id, draftGuard.id, draftGuard.revision] : []),
    );
    if (!changes) {
      await permission(session, site.id, admin ? "admin" : "edit");
      fail(409, "config_changed_reload");
    }
    return next;
  }
  async function verifyDebug(token, siteId, pageOrigin) {
    const claims = await verifyDebugSession(secret, token, siteId, pageOrigin);
    if (!claims?.actor) return null;
    try {
      const user = await repo.one(
        "SELECT * FROM admin_users WHERE id=? AND status='active'",
        claims.actor,
      );
      if (!user || user.version !== claims.version) return null;
      await permission(user, siteId, "edit");
      return claims;
    } catch {
      return null;
    }
  }
  async function issueDebug(session, site, target) {
    const result = await issueDebugSession(secret, site, target, clock(), {
      actor: session.user_id,
      version: session.version,
    });
    return result;
  }
  async function previewTarget(site, campaign, raw) {
    const url = new URL(raw);
    if (
      !site.origins.includes(url.origin) ||
      url.username ||
      url.password ||
      !pathAllowed(url.pathname, site) ||
      !targetMatches(campaign.target, url.pathname)
    )
      fail(400, "preview_target_rejected");
    if (!(
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "localhost")
    ))
      fail(400, "preview_target_rejected");
    return url;
  }
  async function publicPreview(request, url) {
    const siteId = url.searchParams.get("siteId"),
      value = await repo.site(siteId),
      pageOrigin =
        request.headers.get("Origin") ||
        (request.headers.get("Sec-Fetch-Site") === "same-origin"
          ? url.origin
          : null);
    if (!value || !value.site.origins.includes(pageOrigin))
      fail(403, "origin_rejected");
    const cors = {
      "Access-Control-Allow-Origin": pageOrigin,
      Vary: "Origin",
      "Access-Control-Allow-Headers": "Content-Type, X-JevSense-Preview",
      "Access-Control-Allow-Methods": "POST, GET",
    };
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (
      url.pathname.startsWith("/v1/preview/module/") &&
      request.method === "GET"
    ) {
      const token = url.pathname
        .slice("/v1/preview/module/".length)
        .replace(/\.js$/, "");
      const key = await hash(token);
      const row = await repo.one(
        "SELECT * FROM admin_preview_modules WHERE token_hash=? AND site_id=? AND origin=? AND used=0 AND expires_at>?",
        key,
        siteId,
        pageOrigin,
        clock(),
      );
      if (!row) fail(410, "preview_expired");
      await permission({ id: row.user_id }, siteId, "admin");
      if (!value.site.allowCustomJavaScript) fail(403);
      const changed = await repo.run(
        `UPDATE admin_preview_modules SET used=1 WHERE token_hash=? AND used=0 AND expires_at>? AND ${actorAdmin}`,
        key,
        clock(),
        row.user_id,
        siteId,
      );
      if (!changed) fail(410, "preview_expired");
      return new Response(row.source, {
        headers: {
          ...cors,
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (url.pathname !== "/v1/preview/redeem" || request.method !== "POST")
      fail(404);
    const body = z
      .object({
        token: z.string().min(32).max(128),
        path: z.string().startsWith("/").max(512),
        nonce: z.string().min(16).max(128),
      })
      .strict()
      .parse(await readAdminJSON(request));
    const key = await hash(body.token),
      row = await repo.one(
        "SELECT * FROM admin_preview_tickets WHERE token_hash=? AND used=0 AND expires_at>?",
        key,
        clock(),
      );
    if (
      !row ||
      row.site_id !== siteId ||
      row.origin !== pageOrigin ||
      row.path !== body.path
    )
      fail(410, "preview_expired");
    const role = await permission({ id: row.user_id }, siteId, "edit");
    const draft = await repo.one(
      "SELECT * FROM admin_drafts WHERE site_id=? AND campaign_id=?",
      siteId,
      row.campaign_id,
    );
    const campaign = draft
      ? JSON.parse(draft.body)
      : value.site.campaigns.find((c) => c.id === row.campaign_id);
    if (
      !campaign ||
      row.revision !== value.revision + ":" + (draft?.revision || "")
    )
      fail(409, "preview_config_changed");
    await previewTarget(value.site, campaign, pageOrigin + body.path);
    if (
      campaign.presentation.type === "custom" &&
      !["admin", "superuser"].includes(role)
    )
      fail(403);
    if (
      !(await repo.run(
        `UPDATE admin_preview_tickets SET used=1 WHERE token_hash=? AND used=0 AND expires_at>? AND ${campaign.presentation.type === "custom" ? actorAdmin : actorPermission} AND revision=(SELECT s.revision||':'||COALESCE((SELECT d.revision FROM admin_drafts d WHERE d.site_id=? AND d.campaign_id=?),'') FROM admin_sites s WHERE s.id=?)`,
        key,
        clock(),
        row.user_id,
        siteId,
        siteId,
        row.campaign_id,
        siteId,
      ))
    )
      fail(410, "preview_expired");
    const offer = await publicOffer(value.site, campaign);
    if (campaign.presentation.type === "custom") {
      if (!value.site.allowCustomJavaScript) fail(403);
      const codeToken = randomToken();
      await repo.run(
        "INSERT INTO admin_preview_modules(token_hash,user_id,site_id,origin,source,expires_at) VALUES(?,?,?,?,?,?)",
        await hash(codeToken),
        row.user_id,
        siteId,
        pageOrigin,
        campaign.custom.code,
        clock() + 30000,
      );
      offer.custom.modulePath = `/v1/preview/module/${codeToken}.js?siteId=${encodeURIComponent(siteId)}`;
    }
    await repo.run(
      "DELETE FROM admin_preview_tickets WHERE expires_at<?",
      clock() - DAY,
    );
    await repo.run(
      "DELETE FROM admin_preview_modules WHERE expires_at<?",
      clock(),
    );
    return out(
      { mode: "preview", campaign: offer, nonce: body.nonce },
      200,
      cors,
    );
  }
  function normalizeCampaign(value, publish) {
    const c = structuredClone(value);
    let draftJudgment;
    if (c.judgment) {
      if (publish) c.questions = guidedQuestions(c.judgment);
      else {
        draftJudgment = z
          .object({
            offer: z.string().trim().max(400),
            conditions: z.array(z.string().trim().max(400)).min(1).max(5),
          })
          .strict()
          .parse(c.judgment);
        const valid = guidedJudgmentSchema.safeParse(draftJudgment);
        c.questions = valid.success
          ? guidedQuestions(valid.data)
          : [{ key: "draft", instructions: "下書き：判定条件は未入力です" }];
        delete c.judgment;
      }
    }
    if (c.name === "") delete c.name;
    const emptyTitle = !c.content?.title?.trim();
    if (publish && emptyTitle) fail(400, "content_title_required");
    if (emptyTitle)
      c.content = { ...c.content, title: "validation placeholder" };
    const parsed = campaignSchema.parse(c);
    if (emptyTitle) parsed.content.title = "";
    if (draftJudgment) parsed.judgment = draftJudgment;
    return parsed;
  }
  async function handle(request) {
    const url = new URL(request.url),
      path = url.pathname;
    try {
      if (path.startsWith("/v1/preview/"))
        return await publicPreview(request, url);
      if (url.origin !== origin) fail(403, "origin_rejected");
      if (
        request.headers.get("Origin") &&
        request.headers.get("Origin") !== origin
      )
        fail(403, "origin_rejected");
      if (
        (path === "/control.js" ||
          path === "/control.css" ||
          (path.startsWith("/admin") && !path.startsWith("/admin/api/"))) &&
        ["GET", "HEAD"].includes(request.method)
      ) {
        const asset =
          path === "/control.js"
            ? "control.js"
            : path === "/control.css"
              ? "control.css"
              : "admin-v2.html";
        const response = await assets(asset, request.method);
        const result = new Response(response.body, response);
        result.headers.set("Cache-Control", "no-store");
        result.headers.set("Referrer-Policy", "no-referrer");
        result.headers.set("X-Content-Type-Options", "nosniff");
        if (asset.endsWith(".html"))
          result.headers.set(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          );
        return result;
      }
      if (path === "/auth/status" && request.method === "GET")
        return out({
          initialized: (await repo.settings()).initialized,
          rpID: config.rpID,
        });
      if (request.method !== "GET" && request.headers.get("Origin") !== origin)
        fail(403, "origin_rejected");
      if (path === "/auth/setup/options" && request.method === "POST") {
        const b = z
          .object({
            email: emailSchema,
            displayName: nameSchema,
            bootstrapToken: z.string().min(1).max(1024),
          })
          .strict()
          .parse(await readAdminJSON(request));
        if ((await repo.settings()).initialized)
          fail(409, "already_initialized");
        if (!bootstrapToken || !(await equal(b.bootstrapToken, bootstrapToken)))
          fail(403, "setup_unauthorized");
        return await registrationOptions(request, "setup", {
          email: b.email,
          name: b.displayName,
        });
      }
      if (path === "/auth/login/options" && request.method === "POST") {
        const b = z
          .object({ email: emailSchema })
          .strict()
          .parse(await readAdminJSON(request));
        return await challenge(
          request,
          "login",
          { email: b.email },
          await generateAuthenticationOptions({
            rpID: config.rpID,
            userVerification: "required",
          }),
        );
      }
      if (path === "/auth/register/verify" && request.method === "POST")
        return await verifyRegistration(
          request,
          registrationResponseSchema.parse(await readAdminJSON(request)),
        );
      if (path === "/auth/login/verify" && request.method === "POST")
        return await verifyAuthentication(
          request,
          registrationResponseSchema.parse(await readAdminJSON(request)),
        );
      if (path === "/auth/invitation/inspect" && request.method === "POST") {
        const b = z
          .object({ token: z.string().min(32).max(128) })
          .strict()
          .parse(await readAdminJSON(request));
        const inv = await validInvitation(await hash(b.token), "invite");
        if (!inv) fail(410, "invitation_expired");
        const value = await repo.site(inv.site_id);
        if (!value) fail(410, "invitation_expired");
        const exists = await repo.one(
          "SELECT id FROM admin_users WHERE email=?",
          inv.email,
        );
        return out({
          email: inv.email,
          siteId: inv.site_id,
          siteName: value.site.name || value.site.id,
          role: inv.role,
          existingAccount: !!exists,
        });
      }
      if (path === "/auth/invitation/register" && request.method === "POST") {
        const b = z
          .object({
            token: z.string().min(32).max(128),
            displayName: nameSchema,
          })
          .strict()
          .parse(await readAdminJSON(request));
        const tokenHash = await hash(b.token),
          inv = await validInvitation(tokenHash, "invite");
        if (!inv) fail(410, "invitation_expired");
        if (
          await repo.one("SELECT id FROM admin_users WHERE email=?", inv.email)
        )
          fail(409, "use_existing_account");
        return await registrationOptions(request, "invite", {
          tokenHash,
          email: inv.email,
          name: b.displayName,
        });
      }
      if (path === "/auth/recovery/options" && request.method === "POST") {
        const b = z
          .object({
            email: emailSchema,
            code: z.string().trim().min(16).max(128).optional(),
            token: z.string().min(32).max(128).optional(),
          })
          .strict()
          .parse(await readAdminJSON(request));
        const user = await repo.one(
          "SELECT * FROM admin_users WHERE email=? AND status='active'",
          b.email,
        );
        if (!user) fail(400, "recovery_invalid");
        let data = {
          userId: user.id,
          email: user.email,
          name: user.display_name,
        };
        if (b.code) {
          const codeHash = await hash(user.id + ":" + b.code);
          if (
            !(await repo.one(
              "SELECT code_hash FROM admin_recovery_codes WHERE code_hash=? AND user_id=? AND used=0",
              codeHash,
              user.id,
            ))
          )
            fail(400, "recovery_invalid");
          data.codeHash = codeHash;
        } else if (b.token) {
          const tokenHash = await hash(b.token),
            inv = await validInvitation(tokenHash, "recovery");
          if (!inv || inv.target_user !== user.id)
            fail(400, "recovery_invalid");
          data.tokenHash = tokenHash;
        } else fail(400, "recovery_invalid");
        return await registrationOptions(request, "recover", data);
      }
      const session = await actor(request);
      if (request.method !== "GET") await csrf(request, session);
      const route = path.replace(/^\/admin\/api\/v2/, "");
      if (path === "/auth/session" && request.method === "GET") {
        const user = profile(session);
        const sites = await repo.all(
          `SELECT s.id,s.body,CASE WHEN ?='superuser' THEN 'superuser' ELSE m.role END AS role FROM admin_sites s LEFT JOIN admin_memberships m ON m.site_id=s.id AND m.user_id=? WHERE ?='superuser' OR m.user_id IS NOT NULL ORDER BY s.id`,
          session.global_role,
          session.user_id,
          session.global_role,
        );
        return out({
          user,
          environmentName: (await repo.settings()).name,
          csrf: session.csrf,
          sites: sites.map((row) => {
            const site = JSON.parse(row.body);
            return {
              id: row.id,
              name: site.name || row.id,
              origins: site.origins,
              role: row.role,
            };
          }),
        });
      }
      if (path === "/auth/logout" && request.method === "POST") {
        await repo.run(
          "DELETE FROM admin_sessions WHERE token_hash=?",
          session.token_hash,
        );
        return out({ ok: true }, 200, {
          "Set-Cookie": sessionCookie(SESSION_COOKIE, "", 0),
        });
      }
      if (path === "/auth/reauth/options" && request.method === "POST")
        return await challenge(
          request,
          "reauth",
          { email: session.email, sessionHash: session.token_hash },
          await generateAuthenticationOptions({
            rpID: config.rpID,
            userVerification: "required",
          }),
        );
      if (path === "/auth/reauth/verify" && request.method === "POST")
        return await verifyAuthentication(
          request,
          registrationResponseSchema.parse(await readAdminJSON(request)),
        );
      if (path === "/auth/invitation/accept" && request.method === "POST") {
        const b = z
          .object({ token: z.string().min(32).max(128) })
          .strict()
          .parse(await readAdminJSON(request));
        const key = await hash(b.token),
          inv = await validInvitation(key, "invite");
        if (!inv || inv.email.toLowerCase() !== session.email.toLowerCase())
          fail(403, "invitation_account_mismatch");
        await repo.batch([
          [
            `INSERT INTO admin_memberships(user_id,site_id,role) SELECT ?,i.site_id,i.role FROM admin_invitations i WHERE i.token_hash=? AND i.used=0 AND i.expires_at>? AND ${validIssuer} ON CONFLICT(user_id,site_id) DO NOTHING`,
            session.user_id,
            key,
            clock(),
          ],
          [
            "UPDATE admin_invitations SET used=1 WHERE token_hash=? AND used=0 AND EXISTS(SELECT 1 FROM admin_memberships WHERE user_id=? AND site_id=?)",
            key,
            session.user_id,
            inv.site_id,
          ],
        ]);
        await repo.audit(session.user_id, "invitation.accept", inv.site_id);
        return out({ ok: true, siteId: inv.site_id });
      }
      if (route === "/profile" && request.method === "PUT") {
        const b = z
          .object({ displayName: nameSchema })
          .strict()
          .parse(await readAdminJSON(request));
        await repo.run(
          "UPDATE admin_users SET display_name=? WHERE id=?",
          b.displayName,
          session.user_id,
        );
        return out({ ok: true });
      }
      if (route === "/passkeys" && request.method === "GET")
        return out({
          passkeys: await repo.all(
            "SELECT id,label,device_type,backed_up,created_at,last_used_at FROM admin_credentials WHERE user_id=? ORDER BY created_at",
            session.user_id,
          ),
        });
      if (route === "/passkeys/options" && request.method === "POST") {
        recent(session);
        const b = z
          .object({ label: nameSchema })
          .strict()
          .parse(await readAdminJSON(request));
        return await registrationOptions(request, "add", {
          userId: session.user_id,
          email: session.email,
          name: session.display_name,
          label: b.label,
        });
      }
      if (route.startsWith("/passkeys/") && request.method === "DELETE") {
        recent(session);
        const key = decodeURIComponent(route.slice(10));
        const changed = await repo.run(
          "DELETE FROM admin_credentials WHERE id=? AND user_id=?",
          key,
          session.user_id,
        );
        if (!changed) fail(404);
        await repo.audit(session.user_id, "passkey.remove", null, key);
        return out({ ok: true });
      }
      if (route === "/recovery-codes" && request.method === "POST") {
        recent(session);
        const codes = Array.from({ length: 8 }, () => randomToken());
        await repo.batch([
          ["DELETE FROM admin_recovery_codes WHERE user_id=?", session.user_id],
          ...(await Promise.all(
            codes.map(async (code) => [
              "INSERT INTO admin_recovery_codes(code_hash,user_id,created_at) VALUES(?,?,?)",
              await hash(session.user_id + ":" + code),
              session.user_id,
              clock(),
            ]),
          )),
        ]);
        await repo.audit(session.user_id, "recovery_codes.issue");
        return out({ codes });
      }
      if (route === "/sessions" && request.method === "GET")
        return out({
          sessions: (
            await repo.all(
              "SELECT token_hash,created_at,last_seen,expires_at FROM admin_sessions WHERE user_id=?",
              session.user_id,
            )
          ).map((r) => ({
            id: r.token_hash,
            current: r.token_hash === session.token_hash,
            createdAt: r.created_at,
            lastSeen: r.last_seen,
            expiresAt: r.expires_at,
          })),
        });
      if (route === "/sessions/revoke-others" && request.method === "POST") {
        recent(session);
        await repo.run(
          "DELETE FROM admin_sessions WHERE user_id=? AND token_hash<>?",
          session.user_id,
          session.token_hash,
        );
        return out({ ok: true });
      }
      if (route === "/system" && request.method === "GET") {
        superuser(session);
        return out({ settings: await repo.settings() });
      }
      if (route === "/system" && request.method === "PUT") {
        superuser(session);
        recent(session);
        const b = z
          .object({
            name: nameSchema,
            model: z.string().regex(/^[\w.-]{1,80}$/),
            dailyRequestBudget: z.number().int().min(0).max(1000000),
            maxConcurrent: z.number().int().min(1).max(100),
          })
          .strict()
          .parse(await readAdminJSON(request));
        const revision = request.headers.get("If-Match"),
          next = crypto.randomUUID();
        if (
          !revision ||
          !(await repo.run(
            "UPDATE admin_settings SET body=?,revision=? WHERE id=1 AND revision=?",
            JSON.stringify(b),
            next,
            revision,
          ))
        )
          fail(409, "config_changed_reload");
        await repo.audit(session.user_id, "system.update");
        return out({ ok: true, revision: next });
      }
      if (route === "/audit" && request.method === "GET") {
        superuser(session);
        return out({
          events: await repo.all(
            "SELECT actor_id AS actorId,action,site_id AS siteId,target_id AS targetId,created_at AS createdAt FROM admin_audit ORDER BY created_at DESC LIMIT 100",
          ),
        });
      }
      if (route === "/users" && request.method === "GET") {
        superuser(session);
        return out({
          users: await repo.all(
            "SELECT id,email,display_name AS displayName,global_role AS globalRole,status FROM admin_users ORDER BY created_at",
          ),
          memberships: await repo.all(
            "SELECT user_id AS userId,site_id AS siteId,role FROM admin_memberships",
          ),
        });
      }
      const userRoute = route.match(/^\/users\/([\w-]+)(\/recovery)?$/);
      if (userRoute) {
        superuser(session);
        recent(session);
        const uid = userRoute[1],
          user = await repo.one("SELECT * FROM admin_users WHERE id=?", uid);
        if (!user) fail(404);
        if (userRoute[2] && request.method === "POST") {
          if (user.status !== "active") fail(409, "user_disabled");
          const token = randomToken(),
            now = clock();
          await repo.run(
            "UPDATE admin_invitations SET used=1 WHERE kind='recovery' AND target_user=?",
            uid,
          );
          await repo.run(
            "INSERT INTO admin_invitations(token_hash,kind,email,target_user,created_by,created_at,expires_at) VALUES(?,'recovery',?,?,?,?,?)",
            await hash(token),
            user.email,
            uid,
            session.user_id,
            now,
            now + FIVE,
          );
          await repo.audit(session.user_id, "user.recovery", null, uid);
          return out({
            url: origin + "/admin/recover#token=" + token,
            expiresAt: now + FIVE,
          });
        }
        if (request.method === "PUT") {
          const b = z
            .object({
              globalRole: z.enum(["superuser", "member"]),
              status: z.enum(["active", "disabled"]),
            })
            .strict()
            .parse(await readAdminJSON(request));
          await repo.run(
            "UPDATE admin_users SET global_role=?,status=?,version=version+1 WHERE id=?",
            b.globalRole,
            b.status,
            uid,
          );
          await repo.run("DELETE FROM admin_sessions WHERE user_id=?", uid);
          await repo.run(
            "DELETE FROM admin_recovery_codes WHERE user_id=?",
            uid,
          );
          await repo.run(
            "UPDATE admin_invitations SET used=1 WHERE kind='recovery' AND target_user=?",
            uid,
          );
          await repo.audit(session.user_id, "user.update", null, uid);
          return out({ ok: true });
        }
      }
      if (route === "/sites" && request.method === "POST") {
        superuser(session);
        recent(session);
        const value = siteSchema.parse(await readAdminJSON(request));
        if ((await repo.one("SELECT count(*) AS n FROM admin_sites")).n >= 100)
          fail(409, "site_limit");
        if (
          !(await repo.run(
            "INSERT INTO admin_sites(id,body,revision) SELECT ?,?,? WHERE (SELECT count(*) FROM admin_sites)<100",
            value.id,
            JSON.stringify(value),
            crypto.randomUUID(),
          ))
        )
          fail(409, "site_limit");
        await repo.audit(session.user_id, "site.create", value.id);
        return out({ ok: true, siteId: value.id }, 201);
      }
      const match = route.match(/^\/sites\/([\w-]+)(?:\/(.*))?$/);
      if (!match) fail(404);
      const siteId = match[1],
        tail = match[2] || "",
        kind =
          request.method === "GET"
            ? "view"
            : tail.startsWith("members") ||
                tail === "invitations" ||
                tail === "settings"
              ? "admin"
              : "edit";
      const value = await allowedSite(session, siteId, kind),
        site = value.site;
      if (!tail && request.method === "GET") {
        const drafts = await repo.all(
          "SELECT campaign_id,body,revision,base_hash FROM admin_drafts WHERE site_id=?",
          siteId,
        );
        return out({
          site,
          revision: value.revision,
          role: value.role,
          drafts: drafts.map((d) => ({
            campaignId: d.campaign_id,
            campaign: JSON.parse(d.body),
            revision: d.revision,
            baseHash: d.base_hash,
          })),
        });
      }
      if (tail === "settings" && request.method === "PUT") {
        const b = z
          .object({ settings: z.record(z.string(), z.unknown()) })
          .strict()
          .parse(await readAdminJSON(request));
        if (
          "campaigns" in b.settings ||
          (b.settings.id && b.settings.id !== siteId)
        )
          fail(400, "site_fields_rejected");
        const next = {
          ...site,
          ...b.settings,
          id: siteId,
          campaigns: site.campaigns,
        };
        const revision = await saveSite(
          session,
          next,
          request.headers.get("If-Match"),
          true,
        );
        await repo.audit(session.user_id, "site.update", siteId);
        return out({ ok: true, revision });
      }
      if (tail === "members" && request.method === "GET") {
        if (!["superuser", "admin"].includes(value.role))
          return out({
            members: [
              {
                id: session.user_id,
                email: session.email,
                displayName: session.display_name,
                role: value.role,
              },
            ],
            invitations: [],
          });
        return out({
          members: await repo.all(
            "SELECT u.id,u.email,u.display_name AS displayName,CASE WHEN u.global_role='superuser' THEN 'superuser' ELSE m.role END AS role,u.status FROM admin_users u LEFT JOIN admin_memberships m ON m.user_id=u.id AND m.site_id=? WHERE m.site_id=? OR u.global_role='superuser' ORDER BY u.created_at",
            siteId,
            siteId,
          ),
          invitations: await repo.all(
            "SELECT token_hash AS id,email,role,expires_at AS expiresAt,used FROM admin_invitations WHERE site_id=? AND kind='invite' AND used=0 AND expires_at>?",
            siteId,
            clock(),
          ),
        });
      }
      if (tail === "invitations" && request.method === "POST") {
        recent(session);
        const b = z
          .object({ email: emailSchema, role: roleSchema })
          .strict()
          .parse(await readAdminJSON(request));
        if (
          await repo.one(
            "SELECT u.id FROM admin_users u LEFT JOIN admin_memberships m ON m.user_id=u.id AND m.site_id=? WHERE u.email=? AND (m.site_id IS NOT NULL OR u.global_role='superuser')",
            siteId,
            b.email,
          )
        )
          fail(409, "already_member");
        const token = randomToken(),
          now = clock();
        await repo.batch([
          [
            "UPDATE admin_invitations SET used=1 WHERE kind='invite' AND site_id=? AND email=?",
            siteId,
            b.email,
          ],
          [
            `INSERT INTO admin_invitations(token_hash,kind,email,site_id,role,created_by,created_at,expires_at) SELECT ?,'invite',?,?,?,?,?,? WHERE ${actorAdmin}`,
            await hash(token),
            b.email,
            siteId,
            b.role,
            session.user_id,
            now,
            now + DAY,
            session.user_id,
            siteId,
          ],
        ]);
        await repo.audit(session.user_id, "invitation.issue", siteId);
        return out({
          url: origin + "/admin/invite#token=" + token,
          expiresAt: now + DAY,
        });
      }
      const member = tail.match(/^members\/([\w-]+)$/);
      if (member) {
        recent(session);
        const target = await repo.one(
          "SELECT * FROM admin_users WHERE id=?",
          member[1],
        );
        if (!target || target.global_role === "superuser")
          fail(403, "global_role_managed_separately");
        if (request.method === "PUT") {
          const b = z
            .object({ role: roleSchema })
            .strict()
            .parse(await readAdminJSON(request));
          await repo.run(
            `UPDATE admin_memberships SET role=? WHERE user_id=? AND site_id=? AND ${actorAdmin}`,
            b.role,
            target.id,
            siteId,
            session.user_id,
            siteId,
          );
        } else if (request.method === "DELETE")
          await repo.run(
            `DELETE FROM admin_memberships WHERE user_id=? AND site_id=? AND ${actorAdmin}`,
            target.id,
            siteId,
            session.user_id,
            siteId,
          );
        else fail(404);
        await repo.audit(
          session.user_id,
          "membership.update",
          siteId,
          target.id,
        );
        return out({ ok: true });
      }
      if (tail.startsWith("invitations/") && request.method === "DELETE") {
        await permission(session, siteId, "admin");
        await repo.run(
          "UPDATE admin_invitations SET used=1 WHERE token_hash=? AND site_id=?",
          tail.slice(12),
          siteId,
        );
        return out({ ok: true });
      }
      if (tail === "debug" && request.method === "POST") {
        const b = z
          .object({ url: z.url().max(2048) })
          .strict()
          .parse(await readAdminJSON(request));
        return out(await issueDebug(session, site, b.url));
      }
      const campaignRoute = tail.match(
        /^campaigns\/([\w-]+)(?:\/(draft|publish|stop|preview))?$/,
      );
      if (!campaignRoute) fail(404);
      const campaignId = campaignRoute[1],
        action = campaignRoute[2],
        published = site.campaigns.find((c) => c.id === campaignId),
        draft = await repo.one(
          "SELECT * FROM admin_drafts WHERE site_id=? AND campaign_id=?",
          siteId,
          campaignId,
        );
      const existing = draft ? JSON.parse(draft.body) : published;
      if (
        (existing?.presentation.type === "custom" ||
          published?.presentation.type === "custom") &&
        !["superuser", "admin"].includes(value.role)
      )
        fail(403, "custom_requires_admin");
      if (action === "preview" && request.method === "POST") {
        if (!existing) fail(404);
        if (!existing.content.title.trim()) fail(400, "content_title_required");
        const b = z
          .object({ url: z.string().max(2048) })
          .strict()
          .parse(await readAdminJSON(request));
        const url = await previewTarget(site, existing, b.url),
          token = randomToken();
        await repo.run(
          "INSERT INTO admin_preview_tickets(token_hash,user_id,site_id,campaign_id,origin,path,revision,expires_at) VALUES(?,?,?,?,?,?,?,?)",
          await hash(token),
          session.user_id,
          siteId,
          campaignId,
          url.origin,
          url.pathname,
          value.revision + ":" + (draft?.revision || ""),
          clock() + FIVE,
        );
        return out({
          token,
          expiresAt: clock() + FIVE,
          url: url.href,
          origin: url.origin,
          siteId,
          campaignId,
        });
      }
      if (action === "draft" && request.method === "DELETE") {
        if (!draft) fail(404);
        if (
          !(await repo.run(
            `DELETE FROM admin_drafts WHERE site_id=? AND campaign_id=? AND revision=? AND ${existing.presentation.type === "custom" ? actorAdmin : actorPermission}`,
            siteId,
            campaignId,
            request.headers.get("If-Match"),
            session.user_id,
            siteId,
          ))
        )
          fail(409, "config_changed_reload");
        await repo.audit(
          session.user_id,
          "campaign.discard",
          siteId,
          campaignId,
        );
        return out({ ok: true });
      }
      if (action === "draft" && request.method === "PUT") {
        const c = normalizeCampaign(await readAdminJSON(request), false);
        if (c.id !== campaignId) fail(400, "campaign_mismatch");
        if (
          c.presentation.type === "custom" &&
          !["superuser", "admin"].includes(value.role)
        )
          fail(403, "custom_requires_admin");
        if (c.presentation.type === "custom" && !site.allowCustomJavaScript)
          fail(400, "custom_not_enabled");
        if (
          !draft &&
          (
            await repo.one(
              "SELECT count(*) AS n FROM admin_drafts WHERE site_id=?",
              siteId,
            )
          ).n >= 20
        )
          fail(409, "draft_limit");
        const current = request.headers.get("If-Match");
        if (current !== (draft?.revision || value.revision))
          fail(409, "config_changed_reload");
        const revision = crypto.randomUUID(),
          baseHash =
            draft?.base_hash || (await hash(JSON.stringify(published || null)));
        if (draft) {
          if (
            !(await repo.run(
              `UPDATE admin_drafts SET body=?,revision=? WHERE site_id=? AND campaign_id=? AND revision=? AND ${c.presentation.type === "custom" ? actorAdmin : actorPermission}`,
              JSON.stringify(c),
              revision,
              siteId,
              campaignId,
              current,
              session.user_id,
              siteId,
            ))
          )
            fail(409, "config_changed_reload");
        } else {
          const changed = await repo.run(
            `INSERT INTO admin_drafts(site_id,campaign_id,body,revision,base_hash) SELECT ?,?,?,?,? WHERE ${c.presentation.type === "custom" ? actorAdmin : actorPermission} AND EXISTS(SELECT 1 FROM admin_sites WHERE id=? AND revision=?)`,
            siteId,
            campaignId,
            JSON.stringify(c),
            revision,
            baseHash,
            session.user_id,
            siteId,
            siteId,
            current,
          );
          if (!changed) fail(409, "config_changed_reload");
        }
        await repo.audit(session.user_id, "campaign.draft", siteId, campaignId);
        return out({ ok: true, revision });
      }
      if (action === "publish" && request.method === "POST") {
        if (!draft) fail(409, "draft_required");
        if (
          request.headers.get("If-Match") !== draft.revision ||
          draft.base_hash !== (await hash(JSON.stringify(published || null)))
        )
          fail(409, "config_changed_reload");
        const c = normalizeCampaign(JSON.parse(draft.body), true);
        c.enabled = true;
        const next = {
          ...site,
          campaigns: published
            ? site.campaigns.map((old) => (old.id === c.id ? c : old))
            : [...site.campaigns, c],
        };
        const revision = await saveSite(
          session,
          next,
          value.revision,
          c.presentation.type === "custom",
          { id: campaignId, revision: draft.revision },
        );
        await repo.run(
          "DELETE FROM admin_drafts WHERE site_id=? AND campaign_id=? AND revision=?",
          siteId,
          campaignId,
          draft.revision,
        );
        await repo.audit(
          session.user_id,
          "campaign.publish",
          siteId,
          campaignId,
        );
        return out({ ok: true, revision });
      }
      if (action === "stop" && request.method === "POST") {
        if (!published) fail(404);
        const b = z
          .object({ enabled: z.boolean() })
          .strict()
          .parse(await readAdminJSON(request));
        const next = {
          ...site,
          campaigns: site.campaigns.map((c) =>
            c.id === campaignId ? { ...c, enabled: b.enabled } : c,
          ),
        };
        const revision = await saveSite(
          session,
          next,
          request.headers.get("If-Match"),
          published.presentation.type === "custom",
        );
        await repo.audit(session.user_id, "campaign.state", siteId, campaignId);
        return out({ ok: true, revision });
      }
      if (request.method === "DELETE" && !action) {
        if (!existing) fail(404);
        const revision = await saveSite(
          session,
          {
            ...site,
            campaigns: site.campaigns.filter((c) => c.id !== campaignId),
          },
          request.headers.get("If-Match"),
          existing.presentation.type === "custom",
        );
        await repo.run(
          "DELETE FROM admin_drafts WHERE site_id=? AND campaign_id=?",
          siteId,
          campaignId,
        );
        await repo.audit(
          session.user_id,
          "campaign.delete",
          siteId,
          campaignId,
        );
        return out({ ok: true, revision });
      }
      fail(404);
    } catch (error) {
      let cors = {};
      if (path.startsWith("/v1/preview/")) {
        const target = await repo.site(url.searchParams.get("siteId"));
        const o = request.headers.get("Origin");
        if (target?.site.origins.includes(o))
          cors = { "Access-Control-Allow-Origin": o, Vary: "Origin" };
      }
      if (error instanceof z.ZodError)
        return out(
          {
            error: "invalid_request",
            issues: error.issues.map((v) => ({
              path: v.path,
              message: v.message,
            })),
          },
          400,
          cors,
        );
      const message = String(error.message || "");
      const special = message.includes("last_superuser")
        ? "last_superuser"
        : message.includes("last_passkey")
          ? "last_passkey"
          : message.includes("UNIQUE constraint")
            ? "already_exists"
            : null;
      return out(
        {
          error: special || (error.status && error.message) || "internal_error",
        },
        special ? 409 : error.status || 500,
        cors,
      );
    }
  }
  return { handle, repo, verifyDebug, actor, permission, runtimeSettings };
}
