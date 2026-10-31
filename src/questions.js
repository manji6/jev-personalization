import { z } from "zod";
export const guidedJudgmentSchema = z
  .object({
    offer: z.string().trim().min(1).max(400),
    conditions: z.array(z.string().trim().min(1).max(400)).min(1).max(5),
  })
  .strict();
export function guidedQuestions(value) {
  const { offer, conditions } = guidedJudgmentSchema.parse(value);
  return conditions.map((condition, index) => ({
    key: `condition_${index + 1}`,
    instructions: `今回案内する内容：${offer}\n閲覧履歴と連携された行動・状態の情報に基づき、この閲覧者に「${condition}」が当てはまりますか？`,
  }));
}
