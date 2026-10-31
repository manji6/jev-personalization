import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
export async function openAdminDatabase(path) {
  if (path !== ":memory:")
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const raw = new DatabaseSync(path);
  if (path !== ":memory:") await chmod(path, 0o600);
  raw.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  const db = {
    raw,
    prepare(sql) {
      const statement = raw.prepare(sql);
      let args = [];
      const result = {
        bind(...values) {
          args = values;
          return result;
        },
        async first() {
          return statement.get(...args) ?? null;
        },
        async all() {
          return { results: statement.all(...args) };
        },
        async run() {
          return result._run();
        },
        _run() {
          const r = statement.run(...args);
          return {
            meta: {
              changes: Number(r.changes),
              last_row_id: Number(r.lastInsertRowid),
            },
          };
        },
      };
      return result;
    },
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const values = statements.map((s) => s._run());
        raw.exec("COMMIT");
        return values;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql) {
      raw.exec(sql);
    },
    close() {
      raw.close();
    },
  };
  return db;
}
export async function migrateAdminDatabase(db, config) {
  await db.exec(
    await readFile(
      new URL("../../migrations/0001_config.sql", import.meta.url),
      "utf8",
    ),
  );
  // Seed only a new control database, never overwrite an existing installation.
  const exists = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_sites'",
    )
    .first();
  if (!exists && config)
    await db
      .prepare("UPDATE app_config SET body=?,revision=? WHERE id=1")
      .bind(JSON.stringify(config), crypto.randomUUID())
      .run();
  await db.exec(
    await readFile(
      new URL("../../migrations/0002_administration.sql", import.meta.url),
      "utf8",
    ),
  );
}
