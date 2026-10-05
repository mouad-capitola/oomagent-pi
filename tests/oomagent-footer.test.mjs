import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

// Resolve the host-supplied peer from Pi's dependency tree.
const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const tuiUrl = pathToFileURL(require.resolve("@earendil-works/pi-tui")).href;
const { visibleWidth } = await import(tuiUrl);

const source = (await readFile(new URL("../.pi/extensions/oomagent-ui.ts", import.meta.url), "utf8"))
  .replace(/^import .*pi-coding-agent.*;$/m, "class CustomEditor {}")
  .replace('"@earendil-works/pi-tui"', JSON.stringify(tuiUrl))
  .replaceAll("import.meta.url", JSON.stringify(new URL("../.pi/extensions/oomagent-ui.ts", import.meta.url).href));
const load = text => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`);
const { parseFooterGitStatus, readFooterGitStatus } = await load(source);
const { default: register, setMockGitOutput } = await load(source.replace(
  "const execFileAsync = promisify(execFile);",
  'let mockGitOutput = "# branch.head main\\0# branch.ab +0 -0\\0"; export function setMockGitOutput(output) { mockGitOutput = output; } const execFileAsync = async () => { if (mockGitOutput === null) throw new Error("Git unavailable"); return { stdout: mockGitOutput }; };'
));
const flush = () => new Promise(resolve => setImmediate(resolve));

await test("footer dynamically renders branch, available tools and status; toggles and disposes", async () => {
  const handlers = new Map();
  const commands = new Map();
  const ownDir = fileURLToPath(new URL("../.pi/extensions/", import.meta.url));
  const ownSource = { path: join(ownDir, "web-search.ts") };
  let tools = [
    ...["read", "bash", "edit", "write", "codemode"].map(name => ({ name, exposure: "direct", sourceInfo: { path: `builtin:${name}` } })),
    { name: "search", exposure: "deferred", sourceInfo: ownSource },
    { name: "document", exposure: "codemode", sourceInfo: { path: ".pi/extensions/document-reader.ts" } },
    { name: "disabled", exposure: "direct", sourceInfo: ownSource },
    { name: "hidden", exposure: "hidden", sourceInfo: ownSource },
  ];
  let activeTools = ["read", "bash", "edit", "write", "codemode", "hidden"];
  register({
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, cmd) => commands.set(name, cmd),
    registerMarkdownTransformer() {},
    getAllTools: () => tools,
    getActiveTools: () => activeTools,
  });
  let factory;
  let idle = true;
  let usage = { percent: 42, tokens: 42000, contextWindow: 100000 };
  let branch = "main";
  const colors = new Map();
  const backgrounds = [];
  const ctx = {
    mode: "tui", hasUI: true,
    cwd: dirname(dirname(ownDir.replace(/\/$/, ""))),
    isIdle: () => idle,
    model: { id: "test-model" },
    getContextUsage: () => usage,
    ui: {
      theme: {
        fg: (color, text) => { colors.set(text, color); return text; },
        bg: (color, text) => { backgrounds.push(color); return text; },
      },
      setFooter: value => { factory = value; }, setTheme: () => ({ success: true }),
      setTitle() {}, setEditorComponent() {}, setHeader() {}, setWidget() {},
    },
  };
  handlers.get("session_start")({}, ctx);
  let disposed = 0;
  let redraws = 0;
  let branchChanged;
  const makeFooter = () => factory({ requestRender: () => redraws++ }, ctx.ui.theme, {
    getGitBranch: () => branch,
    getExtensionStatuses: () => new Map([["test", "extension-status"]]),
    onBranchChange: fn => { branchChanged = fn; return () => disposed++; },
  });
  const footer = makeFooter();
  try {
    assert.equal(footer.render(80)[0].trimEnd(), "π OomAgent | main … | 2 eigen | 7 totaal | Ready ✓");
    assert.equal(footer.render(120)[1].trimEnd(), `Context 42% | ${basename(ctx.cwd)} | test-model | extension-status`);
    usage = undefined;
    assert.match(footer.render(120)[1], /Context —/);
    usage = { percent: null, tokens: null, contextWindow: 100000 };
    assert.match(footer.render(120)[1], /Context —/);
    usage.percent = 80;
    footer.render(120);
    assert.equal(colors.get("Context 80%"), "warning");
    usage.percent = 95;
    footer.render(120);
    assert.equal(colors.get("Context 95%"), "error");
    usage.percent = 42;
    await flush();
    assert.match(footer.render(120)[0], /main ✓ ↑0 ↓0/);
    setMockGitOutput("# branch.head main\0# branch.ab +1 -2\0" +
      "1 M. N... 100644 100644 100644 abc abc staged.txt\0" +
      "1 .M N... 100644 100644 100644 abc abc unstaged.txt\0? new.txt\0");
    branchChanged();
    await flush();
    assert.match(footer.render(120)[0], /main ●3 \(1 staged, 1 nieuw\) ↑1 ↓2/);
    for (const width of [0, 1, 10, 40, 120]) {
      assert.equal(footer.render(width).length, 2);
      assert.ok(footer.render(width).every(line => visibleWidth(line) <= width));
    }
    assert.equal(colors.get("π OomAgent"), "success");
    assert.equal(colors.get("2 eigen"), "accent");
    assert.equal(colors.get("7 totaal"), "accent");
    assert.equal(colors.get("Ready ✓"), "success");
    assert.ok(backgrounds.every(color => color === "userMessageBg"));

    branch = "feature/日本語";
    setMockGitOutput("# branch.head feature/日本語\0");
    branchChanged();
    await flush();
    assert.ok(redraws > 0);
    assert.match(footer.render(120)[0], /✓ · geen upstream/);
    assert.match(footer.render(80)[0], /feature\/日本語/);
    tools = [...tools, { name: "new-tool", exposure: "deferred", sourceInfo: ownSource }];
    assert.match(footer.render(80)[0], /3 eigen.*8 totaal/);
    tools = [...tools, { name: "external-tool", exposure: "deferred", sourceInfo: { path: join(ownDir.replace(/\/$/, "") + "-other", "external.ts") } }];
    assert.match(footer.render(80)[0], /3 eigen.*9 totaal/);
    activeTools = activeTools.filter(name => name !== "bash");
    assert.match(footer.render(80)[0], /3 eigen.*8 totaal/);
    idle = false;
    assert.match(footer.render(80)[0], /Working…/);
    idle = true;
    branch = undefined;
    setMockGitOutput(null);
    branchChanged();
    await flush();
    assert.match(footer.render(120)[0], /geen branch Git \?.*Ready ✓/);
    // No branch-change event or header animation: periodic polling still recovers.
    setMockGitOutput("# branch.head main\0# branch.ab +2 -0\0");
    await new Promise(resolve => setTimeout(resolve, 1100));
    await flush();
    assert.match(footer.render(120)[0], /main ✓ ↑2 ↓0/);
    tools = [];
    assert.match(footer.render(80)[0], /0 eigen.*0 totaal/);
    ctx.ui.theme = { fg: (_color, text) => `\x1b[32m${text}\x1b[0m`, bg: (_color, text) => text };
    for (const width of [0, 1, 10, 40, 80]) assert.ok(footer.render(width).every(line => visibleWidth(line) <= width));
  } finally {
    footer.dispose();
    footer.dispose();
  }
  assert.equal(disposed, 1);
  await commands.get("oom-footer").handler("", ctx);
  assert.equal(factory, undefined);
  await commands.get("oom-footer").handler("", ctx);
  assert.equal(typeof factory, "function");
  const reopened = makeFooter();
  const beforeDispose = redraws;
  reopened.dispose();
  await flush();
  assert.equal(redraws, beforeDispose, "disposed async refresh must not request a render");
  handlers.get("session_shutdown")();
});

await test("Git parser counts files once, handles renames/newlines and conflicts", () => {
  const output = "# branch.head feature/test\0# branch.ab +2 -3\0" +
    "1 MM N... 100644 100644 100644 abc abc both.txt\0" +
    "2 R. N... 100644 100644 100644 abc abc R100 new\nname.txt\0old\nname.txt\0" +
    "? untracked\nfile.txt\0u UU N... 100644 100644 100644 100644 abc abc abc conflict.txt\0";
  assert.deepEqual(parseFooterGitStatus(output), {
    branch: "feature/test", changed: 4, staged: 2, untracked: 1, conflicts: 1, ahead: 2, behind: 3,
  });
  assert.equal(parseFooterGitStatus("# branch.head main\0").ahead, null);
  assert.equal(parseFooterGitStatus("# branch.head (detached)\0").branch, "(detached)");
  assert.throws(() => parseFooterGitStatus(""));
  assert.throws(() => parseFooterGitStatus("# branch.head main\0# branch.ab invalid\0"));
  assert.throws(() => parseFooterGitStatus("# branch.head main\0unexpected\0"));
  assert.throws(() => parseFooterGitStatus("# branch.head main\0" + "2 R. incomplete\0"));
});

await test("Git stats read local changes and upstream counts without fetching", async () => {
  const root = await mkdtemp(join(tmpdir(), "oomagent-footer-git-"));
  const exec = promisify(execFile);
  const git = async (...args) => (await exec("git", args, {
    cwd: root,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  })).stdout.trim();
  try {
    await git("init", "-b", "main");
    await git("config", "user.name", "Footer Test");
    await git("config", "user.email", "footer@example.invalid");
    await git("config", "commit.gpgsign", "false");
    await git("config", "core.hooksPath", join(root, "no-hooks"));
    await writeFile(join(root, "tracked.txt"), "base\n");
    await git("add", ".");
    await git("commit", "-m", "base");
    const base = await git("rev-parse", "HEAD");
    assert.equal((await readFooterGitStatus(root)).changed, 0);
    assert.equal((await readFooterGitStatus(root)).ahead, null);
    await git("config", "remote.origin.url", root);
    await git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*");
    await git("update-ref", "refs/remotes/origin/main", base);
    await git("branch", "--set-upstream-to=origin/main", "main");
    await writeFile(join(root, "tracked.txt"), "next\n");
    await git("add", ".");
    await git("commit", "-m", "ahead");
    await writeFile(join(root, "tracked.txt"), "staged\n");
    await git("add", ".");
    await writeFile(join(root, "tracked.txt"), "also unstaged\n");
    await writeFile(join(root, "new\nfile.txt"), "new\n");
    assert.deepEqual(await readFooterGitStatus(root), {
      branch: "main", changed: 2, staged: 1, untracked: 1, conflicts: 0, ahead: 1, behind: 0,
    });
    await git("checkout", "--detach");
    const detached = await readFooterGitStatus(root);
    assert.equal(detached.branch, "(detached)");
    assert.equal(detached.ahead, null);
  } finally { await rm(root, { recursive: true, force: true }); }
  await assert.rejects(readFooterGitStatus(root));
});

await test("compact header and message dividers fit narrow terminals and follow theme changes", () => {
  const handlers = new Map();
  const commands = new Map();
  let headerFactory;
  let transform;
  let selectedTheme;
  const ctx = {
    mode: "tui", hasUI: true,
    ui: {
      theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text },
      setFooter() {}, setTitle() {}, setEditorComponent() {},
      setHeader: factory => { headerFactory = factory; },
      setWidget: (_key, widget) => assert.equal(widget, undefined),
      setTheme: name => { selectedTheme = name; return { success: true }; },
    },
  };
  register({
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
    registerMarkdownTransformer: fn => { transform = fn; },
  });
  handlers.get("session_start")({}, ctx);
  const header = headerFactory({ requestRender() {} });
  try {
    assert.equal(selectedTheme, "oomagent-swiss");
    assert.equal(header.render(100).length, 2, "large scene is off by default");
    assert.match(header.render(100)[0], /OomAgent/);
    ctx.ui.theme = {
      fg: (_color, text) => `\x1b[36m${text}\x1b[0m`,
      bg: (_color, text) => text, bold: text => text,
    };
    for (const width of [0, 1, 10, 40, 80, 120]) {
      assert.ok(header.render(width).every(line => visibleWidth(line) <= width));
    }
    const markdown = "**Hello**\n\n```python\nprint('hello')\n```";
    const output = transform(markdown, { messageType: "user", availableWidth: 80, isStreaming: false });
    assert.match(output, /Mouad/);
    assert.ok(output.includes(markdown), "Markdown content stays intact");
    const streaming = transform(markdown, { messageType: "assistant", availableWidth: 80, isStreaming: true });
    assert.match(streaming, /pi-Oomagent/);
    assert.ok(!streaming.includes("╰"), "no closing divider while streaming");
    commands.get("oom-screen").handler("", ctx);
    assert.ok(header.render(100).length > 2, "legacy scene remains available");
    handlers.get("before_agent_start")();
    assert.equal(header.render(100).length, 2);
  } finally {
    header.dispose();
    handlers.get("session_shutdown")();
  }
});

await test("theme validates with Pi's loader", async () => {
  const hostRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  const { loadThemeFromPath } = await import(pathToFileURL(join(hostRoot, "modes/interactive/theme/theme.js")).href);
  const theme = loadThemeFromPath(fileURLToPath(new URL("../.pi/themes/oomagent-swiss.json", import.meta.url)));
  assert.equal(theme.name, "oomagent-swiss");
  assert.equal(theme.appearance, "dark");
  assert.ok(theme.fg("accent", "OomAgent").includes("OomAgent"));
});

await test("non-terminal sessions do not install a footer", () => {
  const handlers = new Map();
  register({ on: (name, fn) => handlers.set(name, fn), registerCommand() {}, registerMarkdownTransformer() {} });
  for (const mode of ["rpc", "print", "json"]) {
    handlers.get("session_start")({}, { mode, hasUI: true, ui: { setFooter() { assert.fail("terminal-only"); } } });
  }
});
