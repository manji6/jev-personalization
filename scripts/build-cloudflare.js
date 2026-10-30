import "./build.js";
import { mkdir, copyFile } from "node:fs/promises";
import { build } from "esbuild";
await mkdir("dist/assets", { recursive: true });
for (const file of ["admin.html", "admin.css", "admin.js"])
  await copyFile(`public/${file}`, `dist/assets/${file}`);
await copyFile("dist/sdk.js", "dist/assets/sdk.js");
// The same source is bundled by Wrangler for deploy, and by esbuild for workerd tests.
await build({
  entryPoints: ["src/cloudflare/worker.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["cloudflare:*"],
  outfile: "dist/worker/index.js",
});
