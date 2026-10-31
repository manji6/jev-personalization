import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import assert from "node:assert/strict";
const modules =
  process.env.JEVSENSE_AUTH_SPIKE_MODULES ??
  "/tmp/jevsense-auth-spike/node_modules";
const requireSpike = createRequire(join(modules, "..", "package.json"));
const entry = requireSpike
  .resolve("@simplewebauthn/server")
  .replace("/script/index.js", "/esm/index.js");
const folder = new URL("../../dist/auth-spike/", import.meta.url).pathname;
await mkdir(folder, { recursive: true });
const workerPath = join(folder, "worker.js");
await build({
  entryPoints: [new URL("./worker.js", import.meta.url).pathname],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  alias: { "@simplewebauthn/server": entry },
  outfile: workerPath,
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    scriptPath: "dist/auth-spike/worker.js",
    compatibilityDate: "2026-10-30",
  }),
);
let browser;
const observations = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route("https://auth.example.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Isolated WebAuthn spike</title>",
    }),
  );
  await page.goto("https://auth.example.com/");
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  const request = async (path, response) => {
    const r = await mf.dispatchFetch(
      "https://auth.example.com" + path,
      response
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(response),
          }
        : {},
    );
    return { status: r.status, ...(await r.json()) };
  };
  const reg = await request("/register/options");
  delete reg.status;
  const registration = await page.evaluate(async (options) => {
    const decode = (v) =>
      Uint8Array.from(atob(v.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
        c.charCodeAt(0),
      );
    options.challenge = decode(options.challenge);
    options.user.id = decode(options.user.id);
    const c = await navigator.credentials.create({ publicKey: options });
    return c.toJSON();
  }, reg);
  assert.equal(
    (await request("/register/verify", registration)).verified,
    true,
  );
  observations.push(
    "ES256 discoverable credential registration with user verification: passed",
  );
  const assertion = async (verify = true) => {
    const options = await request("/authenticate/options");
    delete options.status;
    if (!verify) options.userVerification = "discouraged";
    return page.evaluate(async (options) => {
      const decode = (v) =>
        Uint8Array.from(
          atob(v.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        );
      options.challenge = decode(options.challenge);
      for (const c of options.allowCredentials) c.id = decode(c.id);
      const c = await navigator.credentials.get({ publicKey: options });
      return c.toJSON();
    }, options);
  };
  const signed = await assertion();
  assert.equal((await request("/authenticate/verify", signed)).verified, true);
  observations.push(
    "Signed assertion verification in workerd without nodejs_compat: passed",
  );
  assert.equal((await request("/authenticate/verify", signed)).verified, false);
  observations.push("Consumed challenge replay: rejected");
  assert.equal(
    (await request("/authenticate/verify?wrongOrigin=1", await assertion()))
      .verified,
    false,
  );
  observations.push("Unexpected Origin: rejected");
  assert.equal(
    (await request("/authenticate/verify?wrongRP=1", await assertion()))
      .verified,
    false,
  );
  observations.push("Unexpected RP ID: rejected");
  await cdp.send("WebAuthn.setUserVerified", {
    authenticatorId,
    isUserVerified: false,
  });
  assert.equal(
    (await request("/authenticate/verify", await assertion(false))).verified,
    false,
  );
  observations.push("Signed assertion without user verification: rejected");
  const result = {
    recordedDate: "2026-10-31",
    library: "@simplewebauthn/server@14.0.3",
    runtime: "Miniflare workerd (Web Crypto; no nodejs_compat)",
    browser: await browser.version(),
    authenticator:
      "Chromium CDP virtual CTAP2 internal authenticator; synthetic identity",
    observations,
    limitations: [
      "Not a production authentication implementation",
      "No real hardware, synced passkey, Safari or Firefox validation",
      "Only ES256 and attestation none tested",
      "No administrator database, session, invitation, recovery, or email delivery implemented in this spike",
    ],
  };
  await writeFile(
    new URL("./result.json", import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await mf.dispose();
}
