import { readFile, mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { configSchema } from "./schema.js";
export class Store {
  constructor(path) {
    this.path = path;
    this.value = null;
    this.queue = Promise.resolve();
  }
  async load() {
    this.value = configSchema.parse(
      JSON.parse(await readFile(this.path, "utf8")),
    );
    return this;
  }
  get() {
    return structuredClone(this.value);
  }
  revision() {
    return createHash("sha256")
      .update(JSON.stringify(this.value))
      .digest("hex");
  }
  save(value, expected) {
    const next = configSchema.parse(value);
    const task = this.queue.then(async () => {
      if (expected && expected !== this.revision()) {
        const e = new Error("Configuration changed");
        e.statusCode = 409;
        throw e;
      }
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      const f = await open(temp, "wx", 0o600);
      try {
        await f.writeFile(JSON.stringify(next, null, 2));
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(temp, this.path);
      this.value = next;
      return this.get();
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
