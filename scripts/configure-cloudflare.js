import { readFile, writeFile } from "node:fs/promises";
import { format } from "prettier";
const [databaseId, workerName] = process.argv.slice(2);
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    databaseId ?? "",
  ) ||
  (workerName && !/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(workerName))
) {
  throw new Error(
    "Usage: npm run cf:configure -- <D1 database UUID> [worker-name]",
  );
}
const config = JSON.parse(await readFile("wrangler.json", "utf8"));
config.d1_databases[0].database_id = databaseId;
if (workerName) config.name = workerName;
await writeFile(
  "wrangler.json",
  await format(JSON.stringify(config), { parser: "json" }),
);
console.log(
  "Updated wrangler.json. Database IDs are configuration, not secrets. Review and commit this file.",
);
