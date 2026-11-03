import test from "node:test";
import assert from "node:assert/strict";
import {
  guidedQuestions,
  restoreJudgment,
  restoreCampaignEditor,
} from "../src/questions.js";
test("1–5 AND/OR conditions restore templates, legacy wording, custom IDs and multiline text without altering instructions", () => {
  for (const combination of ["all", "any"])
    for (const count of [1, 2, 5])
      for (const templateVersion of ["current", "legacy"])
        for (const custom of [false, true]) {
          const judgment = {
            offer: "夏の案内\n「ウェア」",
            conditions: Array.from(
              { length: count },
              (_, i) => `関心${i + 1}：\n「吸汗・速乾」に興味がある`,
            ),
            templateVersion,
            ...(custom
              ? { keys: Array.from({ length: count }, (_, i) => `custom_${i}`) }
              : {}),
          };
          const questions = guidedQuestions(judgment),
            restored = restoreJudgment(questions);
          assert.ok(restored);
          assert.deepEqual(guidedQuestions(restored), questions);
          const campaign = {
            id: "test",
            combination,
            questions,
            content: { title: "Offer" },
          };
          const editor = restoreCampaignEditor(campaign);
          assert.deepEqual(editor.questions, questions);
          assert.equal(editor.combination, combination);
          assert.deepEqual(guidedQuestions(editor.judgment), questions);
          assert.equal(campaign.judgment, undefined);
        }
});
test("arbitrary questions and mixed offers retain the original structured form rather than an empty or guessed condition", () => {
  const questions = [
    {
      key: "a",
      instructions:
        "この閲覧者は「ポロシャツ」に興味がありますか？\n複数の根拠を見て判断してください。",
    },
    ...guidedQuestions({ offer: "別の案内", conditions: ["比較を続けている"] }),
    { key: "c", instructions: "x".repeat(1000) },
  ];
  assert.equal(restoreJudgment(questions), null);
  const source = { questions, combination: "any", intent: "元のメモ" };
  assert.deepEqual(restoreCampaignEditor(source), source);
  assert.deepEqual(
    restoreCampaignEditor(restoreCampaignEditor(source)),
    source,
  );
  const mixed = [
    ...guidedQuestions({ offer: "A", conditions: ["関心A"] }),
    { ...guidedQuestions({ offer: "B", conditions: ["関心B"] })[0], key: "b" },
  ];
  assert.equal(restoreJudgment(mixed), null);
});
test("draft guidance survives incomplete inputs and rules never acquire model conditions", () => {
  const draft = {
    judgment: { offer: "", conditions: ["", ""], keys: ["a", "b"] },
    questions: [{ key: "draft", instructions: "下書き" }],
    combination: "any",
  };
  assert.deepEqual(restoreCampaignEditor(draft), draft);
  const rules = { decisionMode: "rules", questions: [], combination: "all" };
  assert.deepEqual(restoreCampaignEditor(rules), rules);
});
