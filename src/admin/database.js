import { siteSchema } from "../schema.js";
export class AdminDatabase {
  constructor(db) {
    this.db = db.withSession ? db.withSession("first-primary") : db;
  }
  statement(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }
  async one(sql, ...args) {
    return this.statement(sql, ...args).first();
  }
  async all(sql, ...args) {
    return (await this.statement(sql, ...args).all()).results;
  }
  async run(sql, ...args) {
    return (await this.statement(sql, ...args).run()).meta.changes;
  }
  async batch(items) {
    return this.db.batch(
      items.map(([sql, ...args]) => this.statement(sql, ...args)),
    );
  }
  async settings() {
    const row = await this.one("SELECT * FROM admin_settings WHERE id=1");
    if (!row) throw Error("Run administration migrations");
    return {
      ...JSON.parse(row.body),
      revision: row.revision,
      initialized: !!row.initialized,
    };
  }
  async audit(actor, action, site = null, target = null) {
    await this.run(
      "INSERT INTO admin_audit(id,actor_id,action,site_id,target_id,created_at) VALUES(?,?,?,?,?,?)",
      crypto.randomUUID(),
      actor,
      action,
      site,
      target,
      Date.now(),
    );
  }
  async site(id) {
    const row = await this.one(
      "SELECT body,revision FROM admin_sites WHERE id=?",
      id,
    );
    return row
      ? { site: siteSchema.parse(JSON.parse(row.body)), revision: row.revision }
      : null;
  }
  async publicSite(id) {
    if ((await this.settings()).initialized) return (await this.site(id))?.site;
    const row = await this.one("SELECT body FROM app_config WHERE id=1");
    const site = JSON.parse(row.body).sites.find((s) => s.id === id);
    return site ? siteSchema.parse(site) : null;
  }
  async publicConfig() {
    if (!(await this.settings()).initialized) {
      const row = await this.one("SELECT body FROM app_config WHERE id=1");
      return JSON.parse(row.body);
    }
    return {
      version: 1,
      sites: (await this.all("SELECT body FROM admin_sites ORDER BY id")).map(
        (r) => siteSchema.parse(JSON.parse(r.body)),
      ),
    };
  }
  async load() {
    return { config: await this.publicConfig(), revision: "managed" };
  }
}
