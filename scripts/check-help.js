import { readFile, readdir, access } from "node:fs/promises";
import { join, extname } from "node:path";
import { JSDOM } from "jsdom";
const root = "help/.vitepress/dist",
  base = "/jev-personalization/",
  origin = "https://manji6.github.io";
async function walk(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  const all = await Promise.all(
    items.map((v) =>
      v.isDirectory() ? walk(join(dir, v.name)) : [join(dir, v.name)],
    ),
  );
  return all.flat();
}
const files = (await walk(root)).filter((p) => p.endsWith(".html"));
const cache = new Map();
const errors = [];
let links = 0;
async function document(path) {
  if (!cache.has(path)) {
    const html = await readFile(path, "utf8");
    cache.set(path, new JSDOM(html).window.document);
  }
  return cache.get(path);
}
for (const path of files) {
  const doc = await document(path),
    relative = path.slice(root.length + 1);
  const url = new URL(
    base + (relative === "index.html" ? "" : relative.replace(/\.html$/, "")),
    origin,
  );
  for (const node of doc.querySelectorAll(
    'img[src],script[src],link[rel="stylesheet"][href],link[rel="modulepreload"][href],link[rel="icon"][href]',
  )) {
    const target = new URL(
      node.getAttribute("src") || node.getAttribute("href"),
      url,
    );
    if (target.origin !== origin) continue;
    if (!target.pathname.startsWith(base)) {
      errors.push(`${relative}: asset outside Pages base ${target.pathname}`);
      continue;
    }
    try {
      await access(
        join(root, decodeURIComponent(target.pathname.slice(base.length))),
      );
    } catch {
      errors.push(`${relative}: missing asset ${target.pathname}`);
    }
  }
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("mailto:")) continue;
    const target = new URL(href, url);
    if (target.origin !== origin || !target.pathname.startsWith(base)) continue;
    links++;
    let tail = decodeURIComponent(target.pathname.slice(base.length));
    if (!tail || tail.endsWith("/")) tail += "index.html";
    else if (!extname(tail)) tail += ".html";
    const file = join(root, tail);
    try {
      const dest = await document(file);
      if (
        target.hash &&
        !dest.getElementById(decodeURIComponent(target.hash.slice(1)))
      )
        errors.push(`${relative}: missing anchor ${href}`);
    } catch {
      errors.push(`${relative}: missing file ${href}`);
    }
  }
}
if (errors.length) {
  process.stderr.write(errors.join("\n") + "\n");
  process.exitCode = 1;
} else
  process.stdout.write(
    `Help: ${files.length} HTML pages, ${links} internal links and anchors verified.\n`,
  );
