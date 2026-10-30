import { test } from "node:test";
import assert from "node:assert/strict";
import { configSchema } from "../src/schema.js";
import { prepare } from "../src/engine.js";
import { validCustomCode } from "../src/custom-code.js";
import { publicOffer, customModule, codeHash } from "../src/offer-response.js";
import { fixture, input } from "./helpers.js";
import { readFile } from "node:fs/promises";

test("legacy config receives independent site design and floating presentation defaults", async () => {
  const raw = JSON.parse(await readFile("config/example.json", "utf8"));
  const config = configSchema.parse(raw);
  const s = config.sites[0];
  assert.equal(s.design.colors.accent, "#245b44");
  assert.equal(s.campaigns[0].presentation.type, "floating");
  assert.equal(s.allowCustomJavaScript, false);
  const other = configSchema.parse(raw);
  s.design.colors.accent = "#ff0000";
  assert.equal(other.sites[0].design.colors.accent, "#245b44");
});
test("design cannot contain CSS injection and image-only content requires alternative text", () => {
  const config = fixture(),
    s = config.sites[0];
  s.design.colors.accent = "red;position:fixed";
  assert.equal(configSchema.safeParse(config).success, false);
  s.design.colors.accent = "#245b44";
  s.design.modal.width = 10000;
  assert.equal(configSchema.safeParse(config).success, false);
  s.design.modal.width = 480;
  s.campaigns[0].presentation.imageOnly = true;
  assert.equal(configSchema.safeParse(config).success, false);
  s.campaigns[0].content.imageUrl = "https://example.com/image.jpg";
  s.campaigns[0].content.imageAlt = "説明";
  assert.equal(configSchema.safeParse(config).success, true);
});
test("display path is deterministic and separate from collected browsing history", () => {
  const s = fixture().sites[0],
    i = input();
  s.campaigns[0].target = { mode: "exact", paths: ["/ja/"] };
  assert.equal(prepare(s, i).reason, "no_eligible_campaign");
  i.visits.at(-1).page.path = "/guides/b";
  s.campaigns[0].target.paths = ["/guides/b"];
  assert.equal(prepare(s, i).state.browsing_history_oldest_first.length, 2);
});
test("shared theme travels with each offer; code never travels in decision JSON", async () => {
  const s = fixture().sites[0],
    c = s.campaigns[0];
  s.design.colors.accent = "#cc2200";
  s.allowCustomJavaScript = true;
  c.presentation.type = "custom";
  c.custom = {
    code: "export function render(context) { context.reportShown(); }",
    variables: { label: "<文字列>" },
  };
  const result = await publicOffer(s, c);
  assert.equal(result.design.colors.accent, "#cc2200");
  assert.ok(result.custom.modulePath.endsWith(".js"));
  assert.equal(result.custom.code, undefined);
  assert.deepEqual(result.custom.variables, { label: "<文字列>" });
  const hash = await codeHash(c.custom.code);
  assert.equal(await customModule(s, c.id, hash), c.custom.code);
  assert.equal(await customModule(s, c.id, "0".repeat(64)), null);
  s.allowCustomJavaScript = false;
  assert.equal(await customModule(s, c.id, hash), null);
});
test("custom module requires explicit site permission and a single render export", () => {
  for (const code of [
    "alert(1); export function render() {}",
    "export default function render() {}",
    'import x from "remote"; export function render() {}',
    "export function render( {",
  ])
    assert.equal(validCustomCode(code), false);
  assert.equal(
    validCustomCode(
      "export async function render({content}) { return () => {}; }",
    ),
    true,
  );
  const config = fixture(),
    s = config.sites[0];
  s.campaigns[0].presentation.type = "custom";
  s.campaigns[0].custom = {
    code: "export function render() {}",
    variables: { label: "data" },
  };
  assert.equal(configSchema.safeParse(config).success, false);
  s.allowCustomJavaScript = true;
  assert.equal(configSchema.safeParse(config).success, true);
});
