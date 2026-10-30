import { build } from "esbuild";
await build({
  entryPoints: ["src/sdk.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  outfile: "dist/sdk.js",
  legalComments: "none",
});
await build({
  entryPoints: ["src/offer-renderer.js"],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020"],
  outfile: "dist/offer-renderer.js",
});
