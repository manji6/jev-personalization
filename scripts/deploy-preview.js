import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { configSchema } from "../src/schema.js";
import { previewPlan } from "./preview-plan.js";
const config = JSON.parse(await readFile("wrangler.json", "utf8")),
  migration = JSON.parse(
    await readFile("wrangler.preview-migrations.json", "utf8"),
  );
const plan = previewPlan(config, migration, {
  allowLocked: process.argv.includes("--allow-locked"),
});
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const dirty = !!git("status", "--porcelain");
const releaseSha = dirty ? "uncommitted" : commit;
if (git("status", "--porcelain") && !process.argv.includes("--allow-dirty"))
  throw Error("Commit changes before creating a reviewable Preview");
function run(args, { capture = false } = {}) {
  const r = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (capture)
      process.stderr.write(r.stderr || "Preview deployment failed\n");
    throw Error("Command failed: " + args.slice(0, 3).join(" "));
  }
  return r.stdout;
}
run(["scripts/build-cloudflare.js"]);
run([
  "node_modules/wrangler/bin/wrangler.js",
  "d1",
  "migrations",
  "apply",
  "PREVIEW_DB",
  "--remote",
  "--config",
  "wrangler.preview-migrations.json",
]);
const folder = await mkdtemp(join(tmpdir(), "jevsense-preview-"));
try {
  const data = configSchema.parse({
    version: 1,
    sites: [
      {
        id: "preview-demo",
        name: "JevSense Preview Demo",
        origins: [plan.origin],
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
  });
  const body = JSON.stringify(data),
    revision = createHash("sha256").update(body).digest("hex");
  const quote = (v) => "'" + v.replaceAll("'", "''") + "'";
  const sql = `UPDATE app_config SET body=${quote(body)},revision=${quote(revision)} WHERE id=1 AND revision='a566d4f081a9dcc24885359bc598b60f0e0f617e1d4ffd4c70ff8e69ce678727' AND (SELECT initialized FROM admin_settings WHERE id=1)=0;`;
  const sqlPath = join(folder, "seed.sql");
  await writeFile(sqlPath, sql, { mode: 0o600 });
  run([
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "execute",
    "PREVIEW_DB",
    "--remote",
    "--config",
    "wrangler.preview-migrations.json",
    "--file",
    sqlPath,
  ]);
  const args = [
    "node_modules/wrangler/bin/wrangler.js",
    "preview",
    "--name",
    plan.name,
    "--ignore-base-config",
    "--tag",
    commit,
    "--message",
    "Reviewed source " + commit,
    "--var",
    "RELEASE_SHA:" + releaseSha,
    "--json",
  ];
  if (process.env.PREVIEW_SECRETS_FILE)
    args.push("--secrets-file", process.env.PREVIEW_SECRETS_FILE);
  const output = run(args, { capture: true }),
    start = output.indexOf('{\n  "preview"');
  if (start < 0) throw Error("Unexpected Wrangler JSON output");
  const result = JSON.parse(output.slice(start));
  const receipt = {
    commit,
    dirty,
    previewName: plan.name,
    previewId: result.preview.id,
    deploymentId: result.deployment.id,
    url: plan.origin,
    productionConfigHash: plan.productionConfigHash,
    createdAt: new Date().toISOString(),
  };
  await mkdir("data/deployments", { recursive: true, mode: 0o700 });
  await writeFile(
    "data/deployments/preview.json",
    JSON.stringify(receipt, null, 2) + "\n",
    { mode: 0o600 },
  );
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
} finally {
  await rm(folder, { recursive: true, force: true });
}
