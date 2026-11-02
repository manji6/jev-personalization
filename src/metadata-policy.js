import { z } from "zod";
const forbidden = new Set(["__proto__", "constructor", "prototype"]);
export const metadataKey = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (v) =>
      v.split(".").length <= 6 &&
      v
        .split(".")
        .every((k) => /^[A-Za-z_@][\w:@-]*$/.test(k) && !forbidden.has(k)),
    "取得キーを確認してください",
  );
const source = z.enum(["jsonld", "meta", "title"]);
const output = z
  .object({ source, key: metadataKey, prefix: z.string().max(80).default("") })
  .strict();
export const metadataRuleSchema = z
  .object({
    id: z
      .string()
      .regex(/^[\w-]{1,64}$/)
      .refine((v) => !forbidden.has(v)),
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    combination: z.enum(["all", "any"]),
    conditions: z
      .array(
        z
          .object({
            source,
            key: metadataKey,
            op: z.enum(["exists", "nonempty", "equals", "includes"]),
            value: z.string().max(160).default(""),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    nameOutput: output,
    descriptionOutput: output,
    descriptionPolicy: z.enum(["allow", "next"]),
  })
  .strict();
export const metadataPolicySchema = z
  .object({
    mode: z.enum(["standard", "custom"]),
    rules: z.array(metadataRuleSchema).max(10),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.rules.map((r) => r.id)).size !== v.rules.length)
      c.addIssue({ code: "custom", message: "候補IDが重複しています" });
    if (v.mode === "custom" && !v.rules.length)
      c.addIssue({ code: "custom", message: "取得候補を追加してください" });
  });
export const standardMetadata = () => ({ mode: "standard", rules: [] });
export function defaultMetadataRules() {
  const out = (source, key, prefix = "") => ({ source, key, prefix });
  const cond = (source, key, op = "nonempty", value = "") => ({
    source,
    key,
    op,
    value,
  });
  return [
    {
      id: "product",
      name: "商品詳細・SKUあり",
      enabled: true,
      combination: "all",
      conditions: [
        cond("jsonld", "@type", "includes", "Product"),
        cond("jsonld", "sku"),
      ],
      nameOutput: out("jsonld", "name", "商品詳細："),
      descriptionOutput: out("jsonld", "description"),
      descriptionPolicy: "allow",
    },
    {
      id: "ogp",
      name: "OGPから取得",
      enabled: true,
      combination: "all",
      conditions: [cond("meta", "og:title")],
      nameOutput: out("meta", "og:title"),
      descriptionOutput: out("meta", "og:description"),
      descriptionPolicy: "allow",
    },
    {
      id: "html",
      name: "ページのtitleから取得",
      enabled: true,
      combination: "all",
      conditions: [cond("title", "title")],
      nameOutput: out("title", "title"),
      descriptionOutput: out("meta", "description"),
      descriptionPolicy: "allow",
    },
  ];
}
export async function metadataRevision(policy) {
  if (!policy) return "legacy";
  const parsed = metadataPolicySchema.parse(policy);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(parsed)),
  );
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
export async function publicMetadata(site) {
  return {
    metadataExtraction: site.metadataExtraction ?? null,
    metadataRevision: await metadataRevision(site.metadataExtraction),
  };
}
export async function metadataMismatch(site, input) {
  const revision = await metadataRevision(site.metadataExtraction);
  return (input.metadataRevision ?? "legacy") === revision
    ? null
    : {
        decision: "hold",
        reason: "metadata_revision_changed",
        metadataRevision: revision,
      };
}
