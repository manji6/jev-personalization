import { z } from "zod";
import { DEFAULT_DESIGN } from "./offer-model.js";
import { guidedJudgmentSchema } from "./questions.js";
import { secureOrLoopback } from "./url-policy.js";
import { validCustomCode } from "./custom-code.js";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const designSchema = z
  .object({
    colors: z
      .object({
        background: color,
        text: color,
        accent: color,
        buttonText: color,
      })
      .strict(),
    font: z.enum(["system", "serif"]),
    fontSize: z.number().int().min(12).max(24),
    radius: z.number().int().min(0).max(32),
    padding: z.number().int().min(12).max(48),
    modal: z
      .object({
        width: z.number().int().min(280).max(800),
        backdropOpacity: z.number().min(0).max(0.9),
      })
      .strict(),
    floating: z
      .object({
        width: z.number().int().min(200).max(480),
        position: z.enum(["bottom-left", "bottom-right"]),
        offset: z.number().int().min(8).max(64),
      })
      .strict(),
    bar: z.object({ position: z.enum(["top", "bottom"]) }).strict(),
  })
  .strict();

const text = (n) => z.string().trim().min(1).max(n);
export const id = text(64)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine((v) => !["__proto__", "constructor", "prototype"].includes(v));
export const httpsUrl = z.url().refine((v) => {
  const u = new URL(v);
  return u.protocol === "https:" && !u.username && !u.password;
}, "HTTPS URL without credentials required");
export const pageSchema = z
  .object({
    path: text(512)
      .startsWith("/")
      .refine((v) => !/[?#]/.test(v)),
    name: text(160),
    description: z.string().max(400).optional(),
    type: z.string().max(80).optional(),
    themes: z.array(text(80)).max(8).optional(),
  })
  .strict();
export const inputSchema = z
  .object({
    siteId: id,
    visits: z
      .array(
        z
          .object({
            page: pageSchema,
            visibleMs: z.number().finite().min(0).max(86400000),
          })
          .strict(),
      )
      .max(50),
    actions: z
      .array(
        z
          .object({
            name: id,
            value: z.union([z.boolean(), z.number().finite()]).optional(),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    facts: z
      .record(id, z.union([z.boolean(), z.number().finite()]))
      .refine((v) => Object.keys(v).length <= 20)
      .default({}),
    delivery: z
      .record(
        id,
        z
          .object({
            shown: z.number().int().min(0).max(1000),
            dismissed: z.boolean(),
          })
          .strict(),
      )
      .refine((v) => Object.keys(v).length <= 100)
      .default({}),
  })
  .strict();
export const campaignSchema = z
  .object({
    id,
    name: text(120).optional(),
    judgment: guidedJudgmentSchema.optional(),
    enabled: z.boolean(),
    intent: text(1000),
    priority: z.number().int().min(0).max(100),
    questions: z
      .array(z.object({ key: id, instructions: text(1000) }).strict())
      .min(1)
      .max(5),
    combination: z.enum(["all", "any"]),
    threshold: z.number().min(0.5).max(0.99),
    maxShows: z.number().int().min(1).max(10),
    excludeFact: id.optional(),
    target: z
      .object({
        mode: z.enum(["all", "exact", "prefix"]),
        paths: z
          .array(
            text(512)
              .startsWith("/")
              .refine((v) => !/[?#\\]/.test(v)),
          )
          .max(30),
      })
      .strict()
      .default(() => ({ mode: "all", paths: [] })),
    presentation: z
      .object({
        type: z.enum(["modal", "floating", "bar", "custom"]),
        imageOnly: z.boolean().default(false),
      })
      .strict()
      .default(() => ({ type: "floating", imageOnly: false })),
    custom: z
      .object({
        code: z
          .string()
          .min(1)
          .max(12000)
          .refine(
            validCustomCode,
            "export function render(context) を1つ記述してください",
          ),
        variables: z
          .record(id, z.string().max(1000))
          .refine((v) => Object.keys(v).length <= 20),
      })
      .strict()
      .optional(),
    content: z
      .object({
        title: text(120),
        body: z.string().max(500).default(""),
        linkLabel: z.string().max(60).default(""),
        url: httpsUrl.optional(),
        imageUrl: httpsUrl.optional(),
        imageAlt: z.string().max(160).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.content.url && !v.content.linkLabel.trim())
      c.addIssue({
        code: "custom",
        message: "リンク先を設定した場合はリンク文言が必要です",
        path: ["content", "linkLabel"],
      });
    if (v.presentation.type === "custom" && !v.custom)
      c.addIssue({
        code: "custom",
        message: "独自JavaScriptを記述してください",
        path: ["custom"],
      });
    if (
      v.presentation.imageOnly &&
      (!v.content.imageUrl || !v.content.imageAlt)
    )
      c.addIssue({
        code: "custom",
        message: "画像のみの表示には画像URLと代替テキストが必要です",
        path: ["content", "imageUrl"],
      });
    if (v.target.mode !== "all" && !v.target.paths.length)
      c.addIssue({
        code: "custom",
        message: "表示対象ページを指定してください",
        path: ["target", "paths"],
      });
  });
export const siteSchema = z
  .object({
    id,
    name: text(80).optional(),
    origins: z
      .array(
        z.url().refine((v) => new URL(v).origin === v && secureOrLoopback(v)),
      )
      .min(1)
      .max(10),
    allowedPathPrefixes: z.array(text(200).startsWith("/")).min(1).max(30),
    excludedPathPrefixes: z.array(text(200).startsWith("/")).max(30),
    metadataEnabled: z.boolean().default(false),
    design: designSchema.default(() => structuredClone(DEFAULT_DESIGN)),
    allowCustomJavaScript: z.boolean().default(false),
    actionNames: z.array(id).max(30),
    factNames: z.array(id).max(20),
    minVisibleMs: z.number().int().min(1000).max(300000),
    minQualifiedVisits: z.number().int().min(1).max(10),
    campaigns: z.array(campaignSchema).max(5),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.campaigns.map((x) => x.id)).size !== v.campaigns.length)
      c.addIssue({ code: "custom", message: "Duplicate campaign ID" });
    if (v.campaigns.reduce((n, x) => n + x.questions.length, 0) > 10)
      c.addIssue({ code: "custom", message: "At most ten questions per site" });
    for (const campaign of v.campaigns) {
      if (campaign.presentation.type === "custom" && !v.allowCustomJavaScript)
        c.addIssue({
          code: "custom",
          message: "このサイトでは独自JavaScriptが許可されていません",
          path: ["allowCustomJavaScript"],
        });
      if (
        new Set(campaign.questions.map((q) => q.key)).size !==
        campaign.questions.length
      )
        c.addIssue({ code: "custom", message: "Duplicate question key" });
      if (campaign.excludeFact && !v.factNames.includes(campaign.excludeFact))
        c.addIssue({ code: "custom", message: "Exclude fact must be allowed" });
    }
  });
export const configSchema = z
  .object({ version: z.literal(1), sites: z.array(siteSchema).max(100) })
  .strict()
  .refine(
    (v) => new Set(v.sites.map((s) => s.id)).size === v.sites.length,
    "Duplicate site ID",
  );
