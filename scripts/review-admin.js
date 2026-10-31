// A loopback-only real administration instance. No Cloudflare deploy or Jev call.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildManagedApp } from "../src/app.js";
const port = Number(process.env.REVIEW_PORT || 4174);
const origin = `http://localhost:${port}`;
const config = {
  version: 1,
  sites: [
    {
      id: "review",
      name: "JevSense Review",
      origins: [origin],
      allowedPathPrefixes: ["/demo"],
      excludedPathPrefixes: [],
      metadataEnabled: true,
      actionNames: ["sample_click"],
      factNames: ["completed"],
      minVisibleMs: 1000,
      minQualifiedVisits: 1,
      campaigns: [],
    },
  ],
};
const { app } = await buildManagedApp({
  databasePath: process.env.REVIEW_DB_PATH || "data/review.sqlite",
  config,
  origin,
  secret: randomBytes(48).toString("base64url"),
  bootstrapToken: "local-review-only-not-a-production-token",
  jev: async ({ questions }) => ({
    model: "local-review-stub",
    answers: Object.fromEntries(
      Object.keys(questions).map((key) => [key, { noul: 0.95 }]),
    ),
  }),
});
app.get("/demo", async (req, reply) =>
  reply
    .type("text/html")
    .header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src https:; connect-src 'self'",
    )
    .send(
      `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>吸汗速乾ポロシャツ｜確認用ページ</title><meta name="description" content="暑い季節に着心地のよい吸汗速乾ポロシャツの特集です。"><link rel="stylesheet" href="/demo.css"><script src="/sdk.js" data-site="review" data-consent="granted" defer></script></head><body><main><p>JevSense · LOCAL REVIEW</p><h1>さらりと、軽やかに。</h1><p>吸汗速乾ポロシャツのデモページです。</p><p>このローカル環境の通常判定はスタブ（判定値0.95）です。実際のJevは呼び出しません。</p><a href="/admin">管理画面へ戻る</a></main></body></html>`,
    ),
);
app.get("/demo.css", async (req, reply) =>
  reply
    .type("text/css")
    .send(
      "body{font:18px/1.8 system-ui;color:#233c31;background:#f5f6f2}main{max-width:760px;margin:18vh auto;padding:30px}h1{font-size:56px}a{color:#245b44}",
    ),
);
await app.listen({ host: "127.0.0.1", port });
process.stdout.write(
  `JevSense review: ${origin}/admin\nPage for previews: ${origin}/demo\nFirst-time bootstrap token (local review only): local-review-only-not-a-production-token\nNo external AI or publishing. Accounts are stored in the local review database.\n`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => app.close().then(() => process.exit(0)));
