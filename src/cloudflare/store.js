import { configSchema } from "../schema.js";

export async function revisionOf(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

// No isolate-local configuration cache: every request observes a primary read.
export class D1Store {
  constructor(db) {
    this.db = db.withSession("first-primary");
  }
  async load() {
    const row = await this.db
      .prepare("SELECT body, revision FROM app_config WHERE id = 1")
      .first();
    if (!row) throw new Error("Configuration not initialized");
    return {
      config: configSchema.parse(JSON.parse(row.body)),
      revision: row.revision,
    };
  }
  async save(value, expected) {
    const config = configSchema.parse(value);
    const revision = await revisionOf(config);
    const result = await this.db
      .prepare(
        "UPDATE app_config SET body = ?, revision = ? WHERE id = 1 AND revision = ?",
      )
      .bind(JSON.stringify(config), revision, expected)
      .run();
    if (result.meta.changes !== 1) {
      const error = new Error("Configuration changed");
      error.status = 409;
      throw error;
    }
    return { config, revision };
  }
}
