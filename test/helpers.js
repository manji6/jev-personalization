import { configSchema } from "../src/schema.js";
import { readFileSync } from "node:fs";
export function fixture() {
  const config = configSchema.parse(
    JSON.parse(
      readFileSync(new URL("../config/example.json", import.meta.url)),
    ),
  );
  const s = config.sites[0];
  s.metadataEnabled = true;
  s.campaigns[0].enabled = true;
  return config;
}
export function input() {
  return {
    siteId: "demo",
    visits: [
      { page: { path: "/products/a", name: "導入方法" }, visibleMs: 6000 },
      { page: { path: "/guides/b", name: "導入事例" }, visibleMs: 8000 },
    ],
    actions: [],
    facts: {},
    delivery: {},
  };
}
