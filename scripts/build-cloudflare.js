import "./build.js";
import { mkdir, copyFile } from "node:fs/promises";
import { build } from "esbuild";
await mkdir("dist/assets", { recursive: true });
for (const file of [
  "admin.html",
  "admin.css",
  "admin.js",
  "admin-v2.html",
  "admin-v2.css",
])
  await copyFile(`public/${file}`, `dist/assets/${file}`);
await copyFile("dist/control.js", "dist/assets/control.js");
await copyFile("public/admin-v2.css", "dist/assets/control.css");
await copyFile("dist/sdk.js", "dist/assets/sdk.js");
await copyFile("dist/offer-renderer.js", "dist/assets/offer-renderer.js");
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
