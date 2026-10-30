import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const config = JSON.parse(await readFile("wrangler.json", "utf8"));
if (!config.d1_databases[0].database_id)
  throw new Error(
    "Create D1 once, then run npm run cf:configure -- <database-id> and commit wrangler.json before deploying. See docs/cloudflare.md.",
  );
// No shell interpolation and no secrets in process arguments.
for (const args of [
  ["d1", "migrations", "apply", "DB", "--remote"],
  ["deploy"],
]) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", ...args],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
