import { evaluateGraph, graphQuestions } from "./condition-graph.js";
import { urlTargetingMatches } from "./page-url.js";
export const ALGORITHM_VERSION = "qualified-visits-v1";
export const CONTEXT_ALGORITHM_VERSION = "page-context-v2";
export const GRAPH_ALGORITHM_VERSION = "condition-graph-v1";
export { pathAllowed } from "./path-policy.js";
import { pathAllowed } from "./path-policy.js";
export function prepare(site, input) {
  if (input.protocolVersion === 2) return prepareCurrent(site, input);
  return prepareLegacy(site, input);
}
function prepareLegacy(site, input) {
  // Never let a client add fact/action fields or excluded paths to model state.
  const visits = input.visits.filter(
    (v) => pathAllowed(v.page.path, site) && v.visibleMs >= site.minVisibleMs,
  );
  if (visits.length < site.minQualifiedVisits)
    return { reason: "insufficient_observation" };
  if (!input.visits.length || !pathAllowed(input.visits.at(-1).page.path, site))
    return { reason: "excluded_page" };
  const candidates = site.campaigns.filter((c) =>
    campaignChecks(c, input).every((check) => check.passed),
  );
  if (!candidates.length) return { reason: "no_eligible_campaign" };
  const state = {
    last_qualified_page: visits.at(-1).page,
    browsing_history_oldest_first: visits.map((v) => ({
      page: v.page,
      visible_seconds: Math.round(v.visibleMs / 1000),
    })),
    actions: input.actions.filter((a) => site.actionNames.includes(a.name)),
    facts: Object.fromEntries(
      Object.entries(input.facts).filter(([k]) => site.factNames.includes(k)),
    ),
  };
  return questionPlan(candidates, state, input);
}
function prepareCurrent(site, input) {
  if (input.entryPage && !pathAllowed(input.entryPage.path, site))
    input = { ...input, entryPage: undefined };
  if (!pathAllowed(input.currentPage.path, site))
    return { reason: "excluded_page" };
  const visits = input.visits.filter(
    (v) => pathAllowed(v.page.path, site) && v.visibleMs >= site.minVisibleMs,
  );
  const checked = site.campaigns.filter((c) =>
    campaignChecks(c, input).every((v) => v.passed),
  );
  const candidates = checked.filter(
    (c) => visits.length >= (c.minimumHistory ?? site.minQualifiedVisits),
  );
  if (!candidates.length)
    return {
      reason: checked.length
        ? "insufficient_observation"
        : "no_eligible_campaign",
    };
  const state = {
    current_page: input.currentPage,
    ...(input.entryPage ? { entry_page: input.entryPage } : {}),
    ...(visits.length ? { last_qualified_page: visits.at(-1).page } : {}),
    browsing_history_oldest_first: visits.map((v) => ({
      page: v.page,
      visible_seconds: Math.round(v.visibleMs / 1000),
    })),
    actions: input.actions.filter((a) => site.actionNames.includes(a.name)),
    facts: Object.fromEntries(
      Object.entries(input.facts).filter(([k]) => site.factNames.includes(k)),
    ),
  };
  return questionPlan(candidates, state, input);
}
function questionPlan(initialCandidates, state, input) {
  let candidates = initialCandidates;
  if (candidates.some((c) => c.conditionGraph)) {
    candidates = [...candidates].sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    );
    const definite = candidates.findIndex((c) =>
      c.conditionGraph
        ? evaluateGraph(c.conditionGraph, input).value === true
        : c.decisionMode === "rules",
    );
    if (definite >= 0) candidates = candidates.slice(0, definite + 1);
  }
  const questions = {},
    graphPlans = {};
  candidates.forEach((c, i) => {
    if (c.conditionGraph) {
      const before = evaluateGraph(c.conditionGraph, input),
        list = graphQuestions(c.conditionGraph),
        nodes = c.conditionGraph.nodes.filter((n) => n.kind === "jev");
      const bindings = {};
      nodes.forEach((node, j) => {
        if (before.needed.includes(node.id)) {
          const key = `c${i}q${j}`;
          questions[key] = { type: "noul", instructions: list[j].instructions };
          bindings[node.id] = key;
        }
      });
      graphPlans[c.id] = { before, bindings };
    } else if (c.decisionMode !== "rules")
      c.questions.forEach(
        (q, j) =>
          (questions[`c${i}q${j}`] = {
            type: "noul",
            instructions: q.instructions,
          }),
      );
  });
  return { candidates, state, questions, graphPlans, input };
}
export function campaignChecks(c, input) {
  const checks = [
    { key: "enabled", passed: c.enabled },
    {
      key: "target",
      passed: targetMatches(
        c.target,
        input.currentPage?.path ?? input.visits.at(-1)?.page.path ?? "",
      ),
    },
    { key: "not_dismissed", passed: !input.delivery[c.id]?.dismissed },
    {
      key: "show_limit",
      passed: (input.delivery[c.id]?.shown ?? 0) < c.maxShows,
    },
    {
      key: "fact",
      passed: !c.excludeFact || input.facts[c.excludeFact] === false,
    },
  ];
  if (c.conditionGraph)
    checks.push({
      key: "graph",
      passed: evaluateGraph(c.conditionGraph, input).value !== false,
    });
  else if (c.urlTargeting?.conditions.length)
    checks.push({
      key: "url",
      passed: urlTargetingMatches(c.urlTargeting, input),
    });
  return checks;
}
export function targetMatches(target = { mode: "all", paths: [] }, path) {
  if (target.mode === "all") return true;
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  return target.paths.some((p) =>
    target.mode === "exact" ? decoded === p : decoded.startsWith(p),
  );
}
export function select(prepared, response) {
  const eligible = prepared.candidates.filter((c, i) => {
    if (c.conditionGraph) {
      const answers = {};
      for (const [nodeId, key] of Object.entries(
        prepared.graphPlans[c.id].bindings,
      )) {
        const value = response.answers?.[key]?.noul;
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 1
        )
          throw Error("Invalid model answer");
        answers[nodeId] = value;
      }
      return (
        evaluateGraph(
          c.conditionGraph,
          { ...prepared.input, threshold: c.threshold },
          answers,
        ).value === true
      );
    }
    if (c.decisionMode === "rules") return true;
    const judgments = c.questions.map(
      (q, j) => response.answers?.[`c${i}q${j}`]?.noul,
    );
    if (
      judgments.some(
        (p) => typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1,
      )
    )
      throw new Error("Invalid model answer");
    return c.combination === "all"
      ? judgments.every((p) => p > c.threshold)
      : judgments.some((p) => p > c.threshold);
  });
  return (
    eligible.sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    )[0] ?? null
  );
}
export function draftIntent(intent, subject) {
  // Deliberately limited: no claim that arbitrary prose can be compiled correctly.
  return {
    intent,
    requiresReview: true,
    questions: [
      {
        key: "interest",
        instructions: `閲覧履歴には、${subject}に関心があることを示す行動がありますか？`,
      },
    ],
    combination: "all",
    warning:
      "単一の関心テーマ向けの質問案です。状態条件・AND/OR・除外・配信内容を人が確認してください。",
  };
}
