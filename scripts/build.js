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
