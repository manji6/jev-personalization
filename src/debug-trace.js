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
      checks: campaignChecks(c, input),
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
