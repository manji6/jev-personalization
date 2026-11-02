import { z } from "zod";
import { base64ToBytes, bytesToBase64 } from "./admin/crypto.js";
import { createJev } from "./jev.js";

const encoder = new TextEncoder();
const DAY = 86400000;
const actorAdmin = `EXISTS(SELECT 1 FROM admin_users a WHERE a.id=? AND a.status='active' AND (a.global_role='superuser' OR EXISTS(SELECT 1 FROM admin_memberships m WHERE m.user_id=a.id AND m.site_id=? AND m.role='admin')))`;
const keyringSchema = z
  .object({
    active: z.string().regex(/^[\w-]{1,40}$/),
    keys: z.record(
      z.string().regex(/^[\w-]{1,40}$/),
      z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    ),
  })
  .strict();
export const siteJevUpdate = z
  .object({
    mode: z.enum(["instance", "site", "disabled"]),
    apiKey: z
      .string()
      .regex(/^[\x21-\x7e]{8,4096}$/)
      .optional(),
  })
  .strict()
  .refine((v) => v.mode === "site" || v.apiKey === undefined, {
    message: "API key is only accepted in site mode",
  });
function unavailable(code = "model_not_configured") {
  const error = Error(code);
  error.status = 503;
  return error;
}
function ring(raw) {
  const value = keyringSchema.parse(JSON.parse(raw));
  if (
    !Object.hasOwn(value.keys, value.active) ||
    Object.keys(value.keys).length > 10
  )
    throw Error("Invalid keyring");
  for (const s of Object.values(value.keys))
    if (base64ToBytes(s).length !== 32 || bytesToBase64(base64ToBytes(s)) !== s)
      throw Error("Invalid keyring");
  return value;
}
async function encryptionKey(value, purpose) {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(value),
    "AES-GCM",
    false,
    [purpose],
  );
}
const aad = (siteId, revision) =>
  encoder.encode(`jevsense:site-jev:v1:${siteId}:${revision}`);
export function createSiteJev({
  repo,
  keyring,
  defaultApiKey,
  fetchImpl,
  clock = Date.now,
}) {
  const row = (siteId) =>
    repo.one("SELECT * FROM site_jev_credentials WHERE site_id=?", siteId);
  function availableRing() {
    try {
      return ring(keyring);
    } catch {
      return null;
    }
  }
  async function status(siteId) {
    const current = await row(siteId),
      keys = availableRing();
    return {
      mode: current?.mode || "instance",
      revision: current?.revision || "none",
      siteKeyConfigured: current?.mode === "site",
      instanceKeyConfigured: !!defaultApiKey,
      encryptionAvailable: !!keys,
      decryptionKeyAvailable:
        current?.mode !== "site" ||
        (!!keys && Object.hasOwn(keys.keys, current.key_id)),
      updatedAt: current?.updated_at || null,
    };
  }
  async function save(siteId, input, expected, actor) {
    const value = siteJevUpdate.parse(input),
      current = await row(siteId);
    if ((current?.revision || "none") !== expected) {
      const e = Error("config_changed_reload");
      e.status = 409;
      throw e;
    }
    const revision = crypto.randomUUID();
    let keyId = null,
      iv = null,
      ciphertext = null;
    if (value.mode === "site") {
      const keys = availableRing();
      if (!keys) throw unavailable("jev_encryption_not_configured");
      let plaintext = value.apiKey;
      if (!plaintext) {
        if (current?.mode !== "site") {
          const e = Error("jev_key_required");
          e.status = 400;
          throw e;
        }
        plaintext = await decrypt(siteId, current, keys);
      }
      keyId = keys.active;
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      iv = bytesToBase64(nonce);
      ciphertext = bytesToBase64(
        new Uint8Array(
          await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv: nonce,
              additionalData: aad(siteId, revision),
            },
            await encryptionKey(keys.keys[keyId], "encrypt"),
            encoder.encode(plaintext),
          ),
        ),
      );
    }
    const changes = await repo.batch([
      [
        `INSERT INTO site_jev_credentials(site_id,mode,key_id,iv,ciphertext,revision,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${actorAdmin} AND COALESCE((SELECT revision FROM site_jev_credentials WHERE site_id=?),'none')=? ON CONFLICT(site_id) DO UPDATE SET mode=excluded.mode,key_id=excluded.key_id,iv=excluded.iv,ciphertext=excluded.ciphertext,revision=excluded.revision,updated_at=excluded.updated_at`,
        siteId,
        value.mode,
        keyId,
        iv,
        ciphertext,
        revision,
        clock(),
        actor,
        siteId,
        siteId,
        expected,
      ],
      [
        "INSERT INTO admin_audit(id,actor_id,action,site_id,created_at) SELECT ?,?,'site.jev-key.update',?,? WHERE EXISTS(SELECT 1 FROM site_jev_credentials WHERE site_id=? AND revision=?)",
        crypto.randomUUID(),
        actor,
        siteId,
        clock(),
        siteId,
        revision,
      ],
    ]);
    if (changes[0].meta.changes !== 1) {
      const e = Error("config_changed_reload");
      e.status = 409;
      throw e;
    }
    return status(siteId);
  }
  async function decrypt(siteId, current, keys = availableRing()) {
    try {
      if (!keys || !Object.hasOwn(keys.keys, current.key_id)) throw Error();
      return new TextDecoder("utf-8", { fatal: true }).decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: base64ToBytes(current.iv),
            additionalData: aad(siteId, current.revision),
          },
          await encryptionKey(keys.keys[current.key_id], "decrypt"),
          base64ToBytes(current.ciphertext),
        ),
      );
    } catch {
      throw unavailable("jev_key_unavailable");
    }
  }
  async function prune() {
    await repo.run(
      "DELETE FROM site_jev_calls WHERE started_at<?",
      clock() - 90 * DAY,
    );
  }
  async function prepare(siteId, model) {
    const current = await row(siteId),
      source = current?.mode || "instance";
    if (source === "disabled") throw unavailable();
    const apiKey =
      source === "site" ? await decrypt(siteId, current) : defaultApiKey;
    if (!apiKey) throw unavailable();
    return async (prepared) => {
      let callId;
      return createJev({
        apiKey,
        model,
        fetchImpl,
        onDispatch: async () => {
          await prune();
          callId = crypto.randomUUID();
          await repo.run(
            "INSERT INTO site_jev_calls(id,site_id,started_at,outcome,configured_model,key_source,credential_revision) VALUES(?,?,?,'started',?,?,?)",
            callId,
            siteId,
            clock(),
            model,
            source,
            current?.revision || "instance",
          );
        },
        onComplete: async (value) => {
          await repo.run(
            "UPDATE site_jev_calls SET completed_at=?,outcome=?,actual_model=?,http_status=?,elapsed_ms=? WHERE id=? AND outcome='started'",
            clock(),
            value.outcome,
            value.model,
            value.status,
            value.elapsedMs,
            callId,
          );
        },
      })(prepared);
    };
  }
  async function usage(siteId, days = 30) {
    await prune();
    const from = Math.floor(clock() / DAY) * DAY - (days - 1) * DAY;
    const daily = await repo.all(
      "SELECT strftime('%Y-%m-%d',started_at/1000,'unixepoch') AS day,count(*) AS started,sum(outcome='success') AS succeeded,sum(outcome NOT IN ('started','success')) AS failed,sum(outcome='started') AS pending FROM site_jev_calls WHERE site_id=? AND started_at>=? GROUP BY day ORDER BY day",
      siteId,
      from,
    );
    const totals = daily.reduce(
      (a, v) => {
        for (const k of ["started", "succeeded", "failed", "pending"])
          a[k] += Number(v[k]);
        return a;
      },
      { started: 0, succeeded: 0, failed: 0, pending: 0 },
    );
    const recent = await repo.all(
      "SELECT id,started_at AS startedAt,completed_at AS completedAt,outcome,configured_model AS configuredModel,actual_model AS actualModel,http_status AS httpStatus,elapsed_ms AS elapsedMs,key_source AS keySource FROM site_jev_calls WHERE site_id=? AND started_at>=? ORDER BY started_at DESC,id DESC LIMIT 100",
      siteId,
      from,
    );
    return {
      days,
      from,
      timezone: "UTC",
      retentionDays: 90,
      totals,
      daily,
      recent,
    };
  }
  return { status, save, prepare, usage };
}
