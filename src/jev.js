export function createJev({
  apiKey,
  timeoutMs = 1200,
  model = "jev-1.14.0",
  fetchImpl = fetch,
}) {
  if (!apiKey) throw new Error("JEV_API_KEY is required");
  return async ({ state, questions }) => {
    const response = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, state, questions }),
      signal: AbortSignal.timeout(timeoutMs),
      // Workers supports manual, not error. Reject 3xx below without forwarding credentials.
      redirect: "manual",
    });
    if (!response.ok) throw new Error("Model service unavailable");
    // Do not log state, Authorization, or upstream error bodies.
    const body = await response.text();
    if (body.length > 65536) throw new Error("Oversized model response");
    const result = JSON.parse(body);
    if (typeof result.model !== "string" || !result.answers)
      throw new Error("Invalid model response");
    return result;
  };
}
