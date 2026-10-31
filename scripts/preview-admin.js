// Local-only prototype viewer. No production API, credentials, or database.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function startAdminPreview({ port = 4173 } = {}) {
  const html = await readFile(
    new URL("../docs/prototypes/admin-v2.html", import.meta.url),
    "utf8",
  );
  const hashes = (tag) =>
    [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))]
      .map(
        (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
      )
      .join(" ");
  const server = createServer((request, response) => {
    const allowed =
      ["GET", "HEAD"].includes(request.method) && request.url === "/";
    response.writeHead(allowed ? 200 : 404, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy":
        "publickey-credentials-get=(), publickey-credentials-create=()",
      "Content-Security-Policy": `default-src 'none'; script-src ${hashes("script")}; style-src ${hashes("style")}; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    });
    response.end(
      request.method === "HEAD" ? undefined : allowed ? html : "Not found",
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = await startAdminPreview();
  console.log(
    `JevSense UI prototype (local only): http://127.0.0.1:${server.address().port}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close());
}
