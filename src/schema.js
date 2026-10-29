import { z } from "zod";

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
    enabled: z.boolean(),
    intent: text(1000),
    priority: z.number().int().min(0).max(100),
    questions: z
      .array(z.object({ key: id, instructions: text(400) }).strict())
      .min(1)
      .max(5),
    combination: z.enum(["all", "any"]),
    threshold: z.number().min(0.5).max(0.99),
    maxShows: z.number().int().min(1).max(10),
    excludeFact: id.optional(),
    content: z
      .object({
        title: text(120),
        body: text(500),
        linkLabel: text(60),
        url: httpsUrl,
      })
      .strict(),
  })
  .strict();
export const siteSchema = z
  .object({
    id,
    origins: z
      .array(
        z
          .url()
          .refine(
            (v) => new URL(v).origin === v && new URL(v).protocol === "https:",
          ),
      )
      .min(1)
      .max(10),
    allowedPathPrefixes: z.array(text(200).startsWith("/")).min(1).max(30),
    excludedPathPrefixes: z.array(text(200).startsWith("/")).max(30),
    metadataEnabled: z.boolean().default(false),
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
