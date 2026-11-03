import { evaluateGraph, graphQuestions } from "./condition-graph.js";
import { campaignChecks, pathAllowed } from "./engine.js";
export function createDebugTrace(site, input) {
  const visits = input.visits.map((v, index) => ({
    index,
    path: v.page.path,
    visibleMs: v.visibleMs,
    reason: !pathAllowed(v.page.path, site)
      ? "excluded_page"
      : v.visibleMs < site.minVisibleMs
        ? "too_brief"
        : "qualified",
  }));
  return {
    observation: {
      ...(input.currentPage ? { currentPage: input.currentPage } : {}),
      ...(input.entryPage ? { entryPage: input.entryPage } : {}),
      protocolVersion: input.protocolVersion ?? 1,
      minVisibleMs: site.minVisibleMs,
      minQualifiedVisits: site.minQualifiedVisits,
      qualifiedVisits: visits.filter((v) => v.reason === "qualified").length,
      visits,
    },
    campaigns: site.campaigns.map((c) => ({
      id: c.id,
      title: c.content.title,
      priority: c.priority,
      target: c.target,
      shown: input.delivery[c.id]?.shown ?? 0,
      maxShows: c.maxShows,
      excludeFact: c.excludeFact ?? null,
      excludeFactValue: c.excludeFact
        ? (input.facts[c.excludeFact] ?? null)
        : null,
      threshold: c.threshold,
      combination: c.combination,
      decisionMode: c.decisionMode ?? "model",
      ...(c.conditionGraph
        ? {
            graph: {
              ...evaluateGraph(c.conditionGraph, input),
              nodes: c.conditionGraph.nodes,
              edges: c.conditionGraph.edges,
            },
          }
        : {}),
      minimumHistory: c.minimumHistory ?? site.minQualifiedVisits,
      checks: [
        ...campaignChecks(c, input),
        ...(input.currentPage
          ? [
              {
                key: "history",
                passed:
                  visits.filter((v) => v.reason === "qualified").length >=
                  (c.minimumHistory ?? site.minQualifiedVisits),
              },
            ]
          : []),
      ],
    })),
    model: { called: false },
  };
}
export function startModelTrace(trace, prepared, requestedModel) {
  if (!trace) return;
  trace.model = {
    called: true,
    requestedModel,
    state: prepared.state,
    questions: prepared.questions,
  };
}
export function finishModelTrace(trace, prepared, result, elapsedMs) {
  if (!trace) return;
  trace.model.elapsedMs = Math.round(elapsedMs);
  trace.model.actualModel = result.model;
  trace.model.usage = Object.fromEntries(
    ["input_tokens", "output_tokens", "total_tokens"]
      .filter((k) => Number.isFinite(result.usage?.[k]))
      .map((k) => [k, result.usage[k]]),
  );
  prepared.candidates.forEach((c, i) => {
    const entry = trace.campaigns.find((v) => v.id === c.id);
    if (c.conditionGraph) {
      const plan = prepared.graphPlans[c.id],
        answers = {};
      const list = graphQuestions(c.conditionGraph),
        nodes = c.conditionGraph.nodes.filter((n) => n.kind === "jev");
      entry.questions = Object.entries(plan.bindings).map(([id, key]) => {
        const p = result.answers?.[key]?.noul;
        answers[id] = p;
        const index = nodes.findIndex((n) => n.id === id);
        return {
          key: nodes[index].key,
          instructions: list[index].instructions,
          probability:
            typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1
              ? p
              : null,
          passed: typeof p === "number" && p > c.threshold,
        };
      });
      entry.graph = {
        ...entry.graph,
        ...evaluateGraph(
          c.conditionGraph,
          { ...prepared.input, threshold: c.threshold },
          answers,
        ),
        queried: Object.keys(plan.bindings),
      };
      entry.matched = entry.graph.value === true;
      return;
    }
    if (c.decisionMode === "rules") {
      entry.questions = [];
      entry.matched = true;
      return;
    }
    entry.questions = c.questions.map((q, j) => {
      const value = result.answers?.[`c${i}q${j}`]?.noul;
      const valid =
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1;
      return {
        key: q.key,
        instructions: q.instructions,
        probability: valid ? value : null,
        passed: valid && value > c.threshold,
      };
    });
    const allValid = entry.questions.every((q) => q.probability !== null);
    entry.matched =
      allValid &&
      (c.combination === "all"
        ? entry.questions.every((q) => q.passed)
        : entry.questions.some((q) => q.passed));
  });
}
