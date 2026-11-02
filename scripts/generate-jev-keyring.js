// Generate once. Never print secret material, overwrite a keyring, or upload it automatically.
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
const path = process.argv[2];
if (!path || process.argv.length !== 3)
  throw Error("Usage: npm run jev:keyring:create -- data/jev-keyring.json");
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
await writeFile(
  path,
  JSON.stringify({
    active: "v1",
    keys: { v1: randomBytes(32).toString("base64url") },
  }) + "\n",
  { mode: 0o600, flag: "wx" },
);
process.stdout.write(
  "Created a private keyring file. Store a secure backup; never commit it or reuse it in another environment.\n",
);
