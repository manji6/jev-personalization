import { queryKeys } from "./page-url.js";
export async function urlPolicyRevision(site) {
  const value = JSON.stringify(queryKeys(site.excludedQueryKeys).sort());
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(hash)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
export async function publicUrlPolicy(site) {
  return {
    excludedQueryKeys: site.excludedQueryKeys ?? [],
    urlPolicyRevision: await urlPolicyRevision(site),
  };
}
export async function urlPolicyMismatch(site, input) {
  if (input.protocolVersion !== 2) return null;
  const revision = await urlPolicyRevision(site);
  return revision === input.urlPolicyRevision
    ? null
    : {
        decision: "hold",
        reason: "url_policy_revision_changed",
        urlPolicyRevision: revision,
      };
}
