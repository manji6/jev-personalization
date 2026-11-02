export function createJev({
  apiKey,
  timeoutMs = 1200,
  model = "jev-1.14.0",
  fetchImpl = fetch,
  onDispatch,
  onComplete,
}) {
  if (!apiKey) throw new Error("JEV_API_KEY is required");
  return async ({ state, questions }) => {
    // Serialize before reserving a log row. A failed log write prevents dispatch.
    const requestBody = JSON.stringify({ model, state, questions });
    try {
      await onDispatch?.();
    } catch {
      const error = Error("Model dispatch recording unavailable");
      error.dispatched = false;
      throw error;
    }
    const started = performance.now();
    let status = null,
      actualModel = null,
      outcome = "network_error";
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        signal,
        // Workers supports manual, not error. Reject 3xx below without forwarding credentials.
        redirect: "manual",
      });
      status = response.status;
      if (!response.ok) {
        outcome = "http_error";
        throw new Error("Model service unavailable");
      }
      outcome = "invalid_response";
      // Do not log state, Authorization, or upstream error bodies.
      const body = await response.text();
      if (body.length > 65536) throw new Error("Oversized model response");
      const result = JSON.parse(body);
      if (
        typeof result.model !== "string" ||
        !/^[\w.:-]{1,80}$/.test(result.model) ||
        result.model.includes(apiKey) ||
        !result.answers ||
        typeof result.answers !== "object" ||
        Array.isArray(result.answers)
      )
        throw new Error("Invalid model response");
      actualModel = result.model;
      outcome = "success";
      return result;
    } catch {
      if (signal.aborted) outcome = "timeout";
      throw new Error("Model service unavailable");
    } finally {
      // A lost completion write remains visibly unconfirmed, never a false success.
      try {
        await onComplete?.({
          outcome,
          status,
          model: actualModel,
          elapsedMs: Math.min(600000, Math.round(performance.now() - started)),
        });
      } catch {}
    }
  };
}
