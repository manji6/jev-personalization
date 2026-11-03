import { z } from "zod";
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const prefix = {
  current:
    "現在ページ・流入ページ・有効な閲覧履歴と、連携された行動・状態の情報に基づき、この閲覧者に「",
  legacy: "閲覧履歴と連携された行動・状態の情報に基づき、この閲覧者に「",
};
const suffix = "」が当てはまりますか？";
function judgmentSchema(draft) {
  const text = draft
    ? z.string().trim().max(400)
    : z.string().trim().min(1).max(400);
  return z
    .object({
      offer: text,
      conditions: z.array(text).min(1).max(5),
      keys: z.array(key).min(1).max(5).optional(),
      templateVersion: z.enum(["current", "legacy"]).optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (
        v.keys &&
        (v.keys.length !== v.conditions.length ||
          new Set(v.keys).size !== v.keys.length)
      )
        ctx.addIssue({
          code: "custom",
          message: "質問IDは条件ごとに重複なく指定してください",
          path: ["keys"],
        });
    });
}
export const guidedJudgmentSchema = judgmentSchema(false);
export const draftJudgmentSchema = judgmentSchema(true);
export const questionListSchema = z
  .array(z.object({ key, instructions: z.string().min(1).max(1000) }).strict())
  .min(1)
  .max(5)
  .refine(
    (q) => new Set(q.map((v) => v.key)).size === q.length,
    "質問IDを重複させないでください",
  );
export function guidedQuestions(value) {
  const {
    offer,
    conditions,
    keys,
    templateVersion = "current",
  } = guidedJudgmentSchema.parse(value);
  return conditions.map((condition, index) => ({
    key: keys?.[index] ?? `condition_${index + 1}`,
    instructions: `今回案内する内容：${offer}\n${prefix[templateVersion]}${condition}${suffix}`,
  }));
}
// Restore only when rebuilding produces every original byte and question ID.
// Other questions use the structured original-question form, never a guessed rewrite.
export function restoreJudgment(questions) {
  if (!questionListSchema.safeParse(questions).success) return null;
  for (const templateVersion of ["current", "legacy"]) {
    const split = "\n" + prefix[templateVersion];
    const parts = questions.map((q) => {
      if (
        !q.instructions.startsWith("今回案内する内容：") ||
        !q.instructions.endsWith(suffix)
      )
        return null;
      const at = q.instructions.indexOf(split);
      if (at < 0) return null;
      return {
        offer: q.instructions.slice("今回案内する内容：".length, at),
        condition: q.instructions.slice(at + split.length, -suffix.length),
      };
    });
    if (
      parts.some((p) => !p) ||
      !parts.every((p) => p.offer === parts[0].offer)
    )
      continue;
    const value = {
      offer: parts[0].offer,
      conditions: parts.map((p) => p.condition),
    };
    if (questions.some((q, i) => q.key !== `condition_${i + 1}`))
      value.keys = questions.map((q) => q.key);
    if (templateVersion !== "current") value.templateVersion = templateVersion;
    const parsed = guidedJudgmentSchema.safeParse(value);
    if (
      parsed.success &&
      JSON.stringify(guidedQuestions(parsed.data)) === JSON.stringify(questions)
    )
      return parsed.data;
  }
  return null;
}
export function restoreCampaignEditor(campaign) {
  if (!campaign) return campaign;
  const copy = structuredClone(campaign);
  if (copy.decisionMode !== "rules" && !copy.judgment) {
    const recovered = restoreJudgment(copy.questions);
    if (recovered) copy.judgment = recovered;
  }
  return copy;
}
export function nextQuestionKey(keys) {
  let n = 1;
  while (keys.includes(`condition_${n}`)) n++;
  return `condition_${n}`;
}
