import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configSchema, siteSchema } from "./schema.js";
import { Store } from "./store.js";
import { buildApp } from "./server.js";
import { createAdministration } from "./admin/service.js";
import {
  openAdminDatabase,
  migrateAdminDatabase,
} from "./admin/node-database.js";
import { createJev } from "./jev.js";

export async function buildManagedApp({
  databasePath = "data/administration.sqlite",
  config,
  origin,
  secret,
  bootstrapToken,
  jev,
  defaults = {},
}) {
  const db = await openAdminDatabase(databasePath);
  await migrateAdminDatabase(db, config);
  const assets = async (file, method) => {
    const mapping = {
      "admin-v2.html": ["public/admin-v2.html", "text/html"],
      "control.css": ["public/admin-v2.css", "text/css"],
      "control.js": ["dist/control.js", "application/javascript"],
    };
    const item = mapping[file];
    if (!item) return new Response("Not found", { status: 404 });
    return new Response(
      method === "HEAD"
        ? null
        : await readFile(new URL("../" + item[0], import.meta.url)),
      { headers: { "Content-Type": item[1] + "; charset=utf-8" } },
    );
  };
  const administration = {
    ...createAdministration({
      db,
      origin,
      secret,
      bootstrapToken,
      assets,
      defaults,
    }),
    origin,
  };
  const store = {
    site(id) {
      const initialized = db.raw
        .prepare("SELECT initialized FROM admin_settings WHERE id=1")
        .get().initialized;
      const value = initialized
        ? JSON.parse(
            db.raw.prepare("SELECT body FROM admin_sites WHERE id=?").get(id)
              ?.body || "null",
          )
        : JSON.parse(
            db.raw.prepare("SELECT body FROM app_config WHERE id=1").get().body,
          ).sites.find((s) => s.id === id);
      return value ? siteSchema.parse(value) : null;
    },
    get() {
      const settings = db.raw
        .prepare("SELECT initialized FROM admin_settings WHERE id=1")
        .get();
      return configSchema.parse(
        settings.initialized
          ? {
              version: 1,
              sites: db.raw
                .prepare("SELECT body FROM admin_sites ORDER BY id")
                .all()
                .map((r) => JSON.parse(r.body)),
            }
          : JSON.parse(
              db.raw.prepare("SELECT body FROM app_config WHERE id=1").get()
                .body,
            ),
      );
    },
  };
  const app = await buildApp({
    store,
    adminToken: bootstrapToken || crypto.randomUUID(),
    administration,
    runtimeSettings: () => administration.runtimeSettings(),
    jev:
      jev ||
      ((prepared, model) =>
        createJev({ apiKey: process.env.JEV_API_KEY, model })(prepared)),
  });
  app.addHook("onClose", async () => db.close());
  return { app, administration, db };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.env.AUTH_MODE !== "passkey")
    throw Error(
      "Set AUTH_MODE=passkey. For legacy mode use node src/server.js explicitly.",
    );
  const store = await new Store(
    process.env.CONFIG_PATH ?? "data/config.json",
  ).load();
  const { app } = await buildManagedApp({
    config: store.get(),
    databasePath: process.env.ADMIN_DB_PATH,
    origin: process.env.AUTH_ORIGIN,
    secret: process.env.AUTH_SECRET,
    bootstrapToken: process.env.ADMIN_TOKEN,
    defaults: {
      model: process.env.JEV_MODEL,
      dailyRequestBudget:
        process.env.DAILY_REQUEST_BUDGET === undefined
          ? undefined
          : Number(process.env.DAILY_REQUEST_BUDGET),
      maxConcurrent:
        process.env.MAX_CONCURRENT === undefined
          ? undefined
          : Number(process.env.MAX_CONCURRENT),
    },
  });
  await app.listen({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "127.0.0.1",
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => app.close().then(() => process.exit(0)));
}
