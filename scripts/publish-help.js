import { spawnSync } from "node:child_process";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const repo = "manji6/jev-personalization";
function command(binary, args, options = {}) {
  const r = spawnSync(binary, args, {
    encoding: "utf8",
    env: process.env,
    ...options,
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw Error((r.stderr || r.stdout || "Command failed").trim());
  return (r.stdout || "").trim();
}
const git = (...args) => command("git", args);
if (git("status", "--porcelain"))
  throw Error("Commit source changes before publishing Help");
const source = git("rev-parse", "HEAD");
command(
  process.execPath,
  ["node_modules/vitepress/bin/vitepress.js", "build", "help"],
  { stdio: "inherit" },
);
command(process.execPath, ["scripts/check-help.js"], { stdio: "inherit" });
const folder = await mkdtemp(join(tmpdir(), "jevsense-help-"));
try {
  const site = join(folder, "site");
  await cp("help/.vitepress/dist", site, { recursive: true });
  const env = {
    ...process.env,
    GIT_DIR: git("rev-parse", "--absolute-git-dir"),
    GIT_WORK_TREE: site,
    GIT_INDEX_FILE: join(folder, "index"),
  };
  const indexGit = (args, options = {}) =>
    command("git", args, { cwd: site, env, ...options });
  let parent;
  const remote = git("ls-remote", "--heads", "origin", "gh-pages");
  if (remote) {
    git("fetch", "origin", "refs/heads/gh-pages:refs/remotes/origin/gh-pages");
    parent = git("rev-parse", "refs/remotes/origin/gh-pages");
  }
  indexGit(["read-tree", "--empty"]);
  indexGit(["add", "--all"]);
  const tree = indexGit(["write-tree"]);
  const args = ["commit-tree", tree, ...(parent ? ["-p", parent] : [])];
  const commit = indexGit(args, {
    input: `docs: publish JevSense Help from ${source}\n`,
  });
  git("push", "origin", `${commit}:refs/heads/gh-pages`);
  const current = spawnSync("gh", ["api", `repos/${repo}/pages`], {
    encoding: "utf8",
    env: process.env,
  });
  if (current.status !== 0) {
    if (!/Not Found|404/.test(current.stderr || ""))
      throw Error(current.stderr || "Cannot read Pages configuration");
    const body = join(folder, "pages.json");
    await writeFile(
      body,
      JSON.stringify({
        build_type: "legacy",
        source: { branch: "gh-pages", path: "/" },
      }),
    );
    command("gh", [
      "api",
      "--method",
      "POST",
      `repos/${repo}/pages`,
      "--input",
      body,
    ]);
  } else {
    const page = JSON.parse(current.stdout);
    if (
      page.build_type !== "legacy" ||
      page.source?.branch !== "gh-pages" ||
      page.source?.path !== "/"
    )
      throw Error(
        "Existing Pages configuration differs; source branch was not changed automatically",
      );
  }
  process.stdout.write(
    JSON.stringify(
      {
        sourceCommit: source,
        pagesCommit: commit,
        branch: "gh-pages",
        url: "https://manji6.github.io/jev-personalization/",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await rm(folder, { recursive: true, force: true });
}
