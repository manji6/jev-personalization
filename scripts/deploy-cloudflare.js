import { readFile } from "node:fs/promises";
import { releasePlan } from "./preview-plan.js";
import { execFileSync, spawnSync } from "node:child_process";
const config = JSON.parse(await readFile("wrangler.json", "utf8"));
if (!config.d1_databases[0].database_id)
  throw new Error(
    "Create D1 once, then run npm run cf:configure -- <database-id> and commit wrangler.json before deploying. See docs/cloudflare.md.",
  );
// Production is intentionally manual: a push or plain cf:deploy cannot release unreviewed code.
const index = process.argv.indexOf("--reviewed-commit");
let receipt;
try {
  receipt = JSON.parse(await readFile("data/deployments/preview.json", "utf8"));
} catch {}
const reviewedCommit = index >= 0 ? process.argv[index + 1] : undefined;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
releasePlan({
  head: git("rev-parse", "HEAD"),
  reviewedCommit,
  dirty: !!git("status", "--porcelain"),
  receipt,
  config,
});
// Keep production secrets independent; never copy Preview credentials or rows.
const listed = spawnSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "secret", "list"],
  { encoding: "utf8", env: process.env },
);
if (listed.status !== 0) throw Error("Cannot inspect production secret names");
const names = JSON.parse(listed.stdout).map((v) => v.name);
for (const name of ["JEV_API_KEY", "ADMIN_TOKEN"])
  if (!names.includes(name))
    throw Error("Configure production Secret " + name + " before release");
if (!names.includes("AUTH_SECRET")) {
  const { randomBytes } = await import("node:crypto");
  const generated = randomBytes(48).toString("base64url");
  const added = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "secret", "put", "AUTH_SECRET"],
    { input: generated + "\n", encoding: "utf8", env: process.env },
  );
  if (added.status !== 0)
    throw Error("Cannot provision production AUTH_SECRET");
}
// No shell interpolation and no secrets in process arguments.
for (const args of [
  ["d1", "migrations", "apply", "DB", "--remote"],
  ["deploy", "--var", "RELEASE_SHA:" + reviewedCommit],
]) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
