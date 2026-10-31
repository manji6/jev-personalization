import { createRemoteJWKSet, jwtVerify } from "jose";
const keySets = new Map();
export function previewConfiguration(env) {
  if (env.DEPLOYMENT_TIER !== "preview") return null;
  const domain = env.PREVIEW_ACCESS_DOMAIN,
    audience = env.PREVIEW_ACCESS_AUD;
  if (
    !domain ||
    !/^[-a-z0-9]+\.cloudflareaccess\.com$/.test(domain) ||
    !audience ||
    !/^[a-f0-9]{64}$/.test(audience)
  )
    return null;
  return { issuer: `https://${domain}`, audience };
}
export async function previewIdentity(request, env, { keySet } = {}) {
  const config = previewConfiguration(env);
  if (!config) return null;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16384) return null;
  try {
    let keys = keySet || keySets.get(config.issuer);
    if (!keys) {
      keys = createRemoteJWKSet(
        new URL("/cdn-cgi/access/certs", config.issuer),
        { timeoutDuration: 3000 },
      );
      keySets.set(config.issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub", "email"],
      clockTolerance: 5,
    });
    if (typeof payload.email !== "string" || typeof payload.sub !== "string")
      return null;
    return { email: payload.email.toLowerCase(), subject: payload.sub };
  } catch {
    return null;
  }
}
export function deploymentInfo(env) {
  return {
    tier: env.DEPLOYMENT_TIER === "preview" ? "preview" : "production",
    commit: env.RELEASE_SHA || null,
    modelMode:
      env.DEPLOYMENT_TIER === "preview" && env.PREVIEW_MODEL_MODE === "stub"
        ? "stub"
        : "live",
  };
}
export function previewDemo(origin) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>吸汗速乾ポロシャツ｜JevSense確認用</title><meta name="description" content="暑い季節を心地よく過ごす吸汗速乾ポロシャツの特集。"><link rel="stylesheet" href="/demo.css"><script src="/sdk.js" data-api="${origin}" data-site="preview-demo" data-preview-environment="true" data-consent="granted" defer></script></head><body><main><p>JevSense · PREVIEW</p><h1>さらりと、軽やかに。</h1><p>吸汗速乾ポロシャツの確認用ページです。</p><p>ここでのJev判定は固定のテスト値です。実際のJevを呼び出しません。</p><a href="/admin">管理画面へ戻る</a></main></body></html>`;
}
