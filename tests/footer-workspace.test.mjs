import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";

// Use the installed Pi host without installing project peers. On Windows:
// PI_TEST_HOST=<global npm pi-coding-agent directory> node --test tests/footer-workspace.test.mjs
const hostEntry = process.env.PI_TEST_HOST
  ? join(process.env.PI_TEST_HOST, "dist/index.js")
  : fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const hostRequire = createRequire(hostEntry);
const hostDist = dirname(hostEntry);
const tuiPath = hostRequire.resolve("@earendil-works/pi-tui");
const { visibleWidth } = await import(pathToFileURL(tuiPath).href);
const { createJiti } = hostRequire("jiti");
const jiti = createJiti(import.meta.url, { fsCache: false, tryNative: false, alias: {
  "@earendil-works/pi-tui": tuiPath,
  "@earendil-works/pi-coding-agent": hostEntry,
} });
const { readFooterGitSummary, readFooterGitStatus } = await jiti.import("../.pi/extensions/oomagent-ui.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-c", "core.hooksPath=", ...args], {
  cwd, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
})).stdout.trim();
const repo = async path => { await mkdir(path, { recursive: true }); await git(path, "init", "-b", "main"); return path; };
const fixture = async t => {
  const root = await mkdtemp(join(tmpdir(), "oomagent-footer-workspace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

test("workspace footer sums direct repositories and Git files, not nested folders or links", async t => {
  const root = await fixture(t);
  const a = await repo(join(root, "repo-a"));
  await writeFile(join(a, "tracked.txt"), "base\n");
  await git(a, "add", ".");
  await git(a, "-c", "user.name=Footer Test", "-c", "user.email=footer@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  // A real linked worktree has a .git file rather than a .git directory.
  const worktree = join(root, "worktree");
  await git(a, "worktree", "add", "-b", "linked", worktree);
  await writeFile(join(worktree, "tracked.txt"), "worktree change\n");
  await writeFile(join(a, "tracked.txt"), "staged\n");
  await git(a, "add", ".");
  await writeFile(join(a, "tracked.txt"), "also unstaged\n");
  const b = await repo(join(root, "repo-b"));
  await writeFile(join(b, "new.txt"), "untracked\n");
  await mkdir(join(root, "ordinary"));
  const nested = await repo(join(root, "ordinary", "nested"));
  await writeFile(join(nested, "not-counted.txt"), "nested\n");
  await symlink(a, join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
  await writeFile(join(root, "root-only.txt"), "not in any repository\n");

  assert.deepEqual(await readFooterGitSummary(root), {
    branch: "", repositories: 3, unavailable: 0,
    changed: 3, staged: 1, untracked: 1, conflicts: 0, ahead: null, behind: null,
  });
  // An ordinary repo (also from a subdirectory) keeps branch/upstream semantics.
  assert.deepEqual(await readFooterGitSummary(a), await readFooterGitStatus(a));
  await mkdir(join(a, "src"));
  assert.deepEqual(await readFooterGitSummary(join(a, "src")), await readFooterGitStatus(a));
});

test("workspace footer flags failed repositories instead of reporting a false clean total", async t => {
  const root = await fixture(t);
  const good = await repo(join(root, "good"));
  await writeFile(join(good, "new.txt"), "change\n");
  const broken = join(root, "broken");
  await mkdir(broken);
  await writeFile(join(broken, ".git"), "invalid gitfile\n");
  const summary = await readFooterGitSummary(root);
  assert.equal(summary.repositories, 2);
  assert.equal(summary.unavailable, 1);
  assert.equal(summary.changed, 1);
  await assert.rejects(readFooterGitSummary(broken), "a broken root repo must not fall back to its children");
  await rm(good, { recursive: true });
  const unavailable = await readFooterGitSummary(root);
  assert.equal(unavailable.repositories, 1);
  assert.equal(unavailable.unavailable, 1);
  // An incomplete root .git directory produces the same Git error as no repo.
  await mkdir(join(root, ".git"));
  await assert.rejects(readFooterGitSummary(root), "do not mask a broken root with child totals");
});

test("workspace discovery refreshes and empty, missing or cancelled reads remain unavailable", async t => {
  const root = await fixture(t);
  await assert.rejects(readFooterGitSummary(root));
  await assert.rejects(readFooterGitSummary(join(root, "missing")));
  const a = await repo(join(root, "a"));
  assert.equal((await readFooterGitSummary(root)).repositories, 1);
  await repo(join(root, "b"));
  assert.equal((await readFooterGitSummary(root)).repositories, 2);
  await writeFile(join(a, "later.txt"), "change\n");
  assert.equal((await readFooterGitSummary(root)).changed, 1);
  await assert.rejects(readFooterGitSummary(root, AbortSignal.abort()), { name: "AbortError" });
});

test("native Pi footer renders workspace totals, refreshes, marks partial errors and disposes", async t => {
  const root = await fixture(t);
  const a = await repo(join(root, "a"));
  await writeFile(join(a, "new.txt"), "change\n");
  await repo(join(root, "b"));
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const { loadExtensions } = await import(pathToFileURL(join(hostDist, "core/extensions/loader.js")).href);
  const { loadThemeFromPath } = await import(pathToFileURL(join(hostDist, "modes/interactive/theme/theme.js")).href);
  const loaded = await loadExtensions([join(sourceRoot, ".pi/extensions/oomagent-ui.ts")], root);
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  loaded.runtime.getSettings = () => ({ quietStartup: true });
  loaded.runtime.getAllTools = () => [];
  loaded.runtime.getActiveTools = () => [];
  loaded.runtime.getThinkingLevel = () => "medium";
  const theme = loadThemeFromPath(join(sourceRoot, ".pi/themes/oomagent-swiss.json"), "truecolor");
  let factory, footer, redraws = 0;
  const ctx = {
    cwd: root, mode: "tui", hasUI: true, sessionManager: { getEntries: () => [] },
    // No model registry or credentials: this check never calls a provider.
    ui: { theme, setFooter: value => { factory = value; }, setTheme: () => ({ success: true }), setTitle() {} },
  };
  const emit = async name => { for (const handler of extension.handlers.get(name) ?? []) await handler({}, ctx); };
  const details = () => stripVTControlCharacters(footer.render(200).join("\n"));
  const waitFor = async pattern => {
    const deadline = Date.now() + 10000;
    while (!pattern.test(details()) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(details(), pattern);
  };
  try {
    await emit("session_start");
    footer = factory({ requestRender: () => redraws++ });
    await waitFor(/⎇ 2 repos · 1 gewijzigd/);
    for (const width of [0, 1, 20, 40, 80, 120, 200]) {
      assert.ok(footer.render(width).every(line => visibleWidth(line) === width));
    }
    await writeFile(join(a, "another.txt"), "change\n");
    await emit("agent_settled");
    await waitFor(/⎇ 2 repos · 2 gewijzigd/);
    const broken = join(root, "broken");
    await mkdir(broken);
    await writeFile(join(broken, ".git"), "invalid gitfile\n");
    await emit("agent_settled");
    await waitFor(/⎇ 3 repos · 2\+ gewijzigd · 1 onleesbaar/);
    await rm(a, { recursive: true });
    await rm(join(root, "b"), { recursive: true });
    await emit("agent_settled");
    await waitFor(/⎇ 1 repos · wijzigingen onbekend · 1 onleesbaar/);
    // Reload recreates the footer with fresh Git discovery, not stale totals.
    await emit("session_shutdown");
    await repo(join(root, "new-repo"));
    await emit("session_start");
    footer = factory({ requestRender: () => redraws++ });
    await waitFor(/⎇ 2 repos · 0\+ gewijzigd · 1 onleesbaar/);
    await emit("agent_settled"); // dispose with an asynchronous read in flight
    await emit("session_shutdown");
    const stopped = redraws;
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(redraws, stopped);
  } finally {
    footer?.dispose();
    await emit("session_shutdown");
  }
});
