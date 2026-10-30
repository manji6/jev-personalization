export const ALGORITHM_VERSION = "qualified-visits-v1";
export function pathAllowed(path, site) {
  let decoded;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.includes("..") || /[\\?#%\u0000-\u001f]/.test(decoded))
    return false;
  return (
    site.allowedPathPrefixes.some((p) => decoded.startsWith(p)) &&
    !site.excludedPathPrefixes.some((p) => decoded.startsWith(p))
  );
}
export function prepare(site, input) {
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
  const questions = Object.fromEntries(
    candidates.flatMap((c, i) =>
      c.questions.map((q, j) => [
        `c${i}q${j}`,
        { type: "noul", instructions: q.instructions },
      ]),
    ),
  );
  return { candidates, state, questions };
}
export function campaignChecks(c, input) {
  return [
    { key: "enabled", passed: c.enabled },
    {
      key: "target",
      passed: targetMatches(c.target, input.visits.at(-1)?.page.path ?? ""),
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
