import { createHash } from "node:crypto";
export const productionHash = (config) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(config).filter(([key]) => key !== "previews"),
        ),
      ),
    )
    .digest("hex");
export function previewPlan(config, migrations, { allowLocked = false } = {}) {
  const p = config.previews,
    db = p?.d1_databases?.find((d) => d.binding === "DB"),
    target = migrations.d1_databases?.find((d) => d.binding === "PREVIEW_DB");
  if (
    !db?.database_id ||
    config.d1_databases.some((d) => d.database_id === db.database_id)
  )
    throw Error("Preview must use a separate D1 database");
  if (
    !target ||
    target.database_id !== db.database_id ||
    target.database_name !== db.database_name ||
    migrations.account_id !== config.account_id
  )
    throw Error("Preview migration target does not match Preview DB");
  if (p.vars?.DEPLOYMENT_TIER !== "preview" || p.vars.AUTH_MODE !== "passkey")
    throw Error("Preview authentication must be enabled");
  const origin = new URL(p.vars.AUTH_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== p.vars.AUTH_ORIGIN)
    throw Error("Invalid Preview AUTH_ORIGIN");
  if (!/^[a-f0-9]{64}$/.test(p.vars.PREVIEW_ACCESS_AUD || ""))
    throw Error("Preview Access audience is required");
  if (
    !allowLocked &&
    !/^[-a-z0-9]+\.cloudflareaccess\.com$/.test(
      p.vars.PREVIEW_ACCESS_DOMAIN || "",
    )
  )
    throw Error("Preview Access domain must be configured");
  const ns = p.ratelimits?.find((b) => b.name === "RATE_LIMITER")?.namespace_id;
  if (!ns || config.ratelimits?.some((b) => b.namespace_id === ns))
    throw Error("Preview rate limiter must be isolated");
  if (
    !p.durable_objects?.bindings?.some(
      (b) =>
        b.name === "MODEL_BUDGET" &&
        b.class_name === "ModelBudget" &&
        !b.script_name,
    )
  )
    throw Error("Preview Durable Objects must be scoped to this Preview");
  if (
    "JEV_API_KEY" in p.vars ||
    "AUTH_SECRET" in p.vars ||
    "ADMIN_TOKEN" in p.vars
  )
    throw Error("Secrets cannot be stored in Preview vars");
  const name = origin.hostname.split("-" + config.name + ".")[0];
  if (
    !/^[a-z][a-z0-9-]{0,40}$/.test(name) ||
    !origin.hostname.includes("-" + config.name + ".")
  )
    throw Error("Use a stable named Preview hostname");
  return {
    name,
    origin: origin.origin,
    databaseId: db.database_id,
    databaseName: db.database_name,
    productionConfigHash: productionHash(config),
  };
}
export function releasePlan({ head, reviewedCommit, dirty, receipt, config }) {
  if (!/^[a-f0-9]{40}$/.test(reviewedCommit || ""))
    throw Error(
      "Specify the full --reviewed-commit SHA after checking Preview",
    );
  if (dirty || head !== reviewedCommit)
    throw Error("Release requires a clean checkout of the reviewed commit");
  if (
    !receipt ||
    receipt.dirty ||
    receipt.commit !== reviewedCommit ||
    !receipt.deploymentId
  )
    throw Error(
      "No matching Preview deployment receipt; deploy and review Preview first",
    );
  if (receipt.productionConfigHash !== productionHash(config))
    throw Error("Production configuration changed after Preview");
  if (
    config.previews?.d1_databases?.some((d) =>
      config.d1_databases.some((p) => p.database_id === d.database_id),
    )
  )
    throw Error("Production cannot share the Preview database");
  if (
    config.vars.AUTH_MODE !== "passkey" ||
    new URL(config.vars.AUTH_ORIGIN).protocol !== "https:"
  )
    throw Error("Production passkey configuration is required");
  return { commit: reviewedCommit, previewDeploymentId: receipt.deploymentId };
}
