import { configSchema } from "../src/schema.js";
import { readFileSync } from "node:fs";
export function fixture() {
  const config = configSchema.parse(
    JSON.parse(
      readFileSync(new URL("../config/example.json", import.meta.url)),
    ),
  );
  const s = config.sites[0];
  // The shared regression fixture represents an existing, not-yet-migrated site.
  delete s.metadataExtraction;
  s.metadataEnabled = true;
  s.campaigns[0].enabled = true;
  return config;
}
export function input() {
  return {
    siteId: "demo",
    visits: [
      { page: { path: "/products/a", name: "導入方法" }, visibleMs: 6000 },
      { page: { path: "/guides/b", name: "導入事例" }, visibleMs: 8000 },
    ],
    actions: [],
    facts: {},
    delivery: {},
  };
}

// Synthetic per-site credentials for runtime tests; no shared-key fallback.
export const testJevKeyring = {
  active: "test",
  keys: { test: Buffer.alloc(32, 29).toString("base64url") },
};
export async function seedSiteKey(
  db,
  siteId,
  apiKey = "synthetic-key-for-" + siteId,
  keyring = testJevKeyring,
) {
  const revision = crypto.randomUUID(),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(keyring.keys[keyring.active], "base64url"),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = Buffer.from(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(
          `jevsense:site-jev:v1:${siteId}:${revision}`,
        ),
      },
      key,
      new TextEncoder().encode(apiKey),
    ),
  ).toString("base64url");
  await db
    .prepare(
      "INSERT OR REPLACE INTO site_jev_credentials(site_id,mode,key_id,iv,ciphertext,revision,updated_at) VALUES(?,'site',?,?,?,?,?)",
    )
    .bind(
      siteId,
      keyring.active,
      Buffer.from(iv).toString("base64url"),
      ciphertext,
      revision,
      Date.now(),
    )
    .run();
}
