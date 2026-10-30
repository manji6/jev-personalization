import { DurableObject } from "cloudflare:workers";

// Only UTC-day totals and short-lived server request permits. No visitor data.
export class ModelBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, calls INTEGER NOT NULL)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS permits (token TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
    );
  }
  acquire({ dailyLimit, maxConcurrent }) {
    if (
      !Number.isInteger(dailyLimit) ||
      dailyLimit < 0 ||
      dailyLimit > 1000000 ||
      !Number.isInteger(maxConcurrent) ||
      maxConcurrent < 1 ||
      maxConcurrent > 100
    )
      throw new Error("Invalid quota");
    const now = Date.now(),
      day = new Date(now).toISOString().slice(0, 10);
    // Synchronous SQLite work is atomic within the DO; no await allows interleaving.
    return this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM permits WHERE expires <= ?", now);
      this.sql.exec("DELETE FROM daily WHERE day <> ?", day);
      const calls =
        this.sql.exec("SELECT calls FROM daily WHERE day = ?", day).toArray()[0]
          ?.calls ?? 0;
      if (calls >= dailyLimit) return { reason: "budget_exhausted" };
      const active = this.sql
        .exec("SELECT COUNT(*) AS count FROM permits")
        .one().count;
      if (active >= maxConcurrent) return { reason: "busy" };
      const token = crypto.randomUUID();
      this.sql.exec(
        "INSERT INTO daily(day,calls) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1",
        day,
      );
      this.sql.exec(
        "INSERT INTO permits(token,expires) VALUES (?,?)",
        token,
        now + 10000,
      );
      return { token };
    });
  }
  release(token) {
    this.sql.exec("DELETE FROM permits WHERE token = ?", token);
  }
}
