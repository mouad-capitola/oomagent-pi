import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolve the host-supplied peer from Pi's dependency tree.
const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const tuiUrl = pathToFileURL(require.resolve("@earendil-works/pi-tui")).href;
const { visibleWidth } = await import(tuiUrl);

const source = (await readFile(new URL("../.pi/extensions/oomagent-ui.ts", import.meta.url), "utf8"))
  .replace(/^import .*pi-coding-agent.*;$/m, 'class CustomEditor {}')
  .replace('"../lib/footer-metrics.ts"', JSON.stringify(new URL("../.pi/lib/footer-metrics.ts", import.meta.url).href))
  .replace('"@earendil-works/pi-tui"', JSON.stringify(tuiUrl))
  .replaceAll("import.meta.url", JSON.stringify(new URL("../.pi/extensions/oomagent-ui.ts", import.meta.url).href));
const load = text => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString("base64")}`);
const { parseFooterGitStatus, readFooterGitStatus, messageBorder, sceneLines, readProjectTree, renderProjectPanel, renderFooterTicker } = await load(source);
const { default: register } = await load(source);

await test("footer shows only tokens and available tools; toggles and disposes", async () => {
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
  let entries = [];
  const backgrounds = [];
  const ctx = {
    mode: "tui", hasUI: true,
    cwd: dirname(dirname(ownDir.replace(/\/$/, ""))),
    sessionManager: { getBranch: () => entries, getEntries: () => entries },
    ui: {
      theme: {
        fg: (_color, text) => text,
        style: text => text,
        bg: (color, text) => { backgrounds.push(color); return text; },
      },
      setFooter: value => { factory = value; }, setTheme: () => ({ success: true }),
      setTitle() {}, setEditorComponent() {}, setHeader() {}, setWidget() {},
    },
  };
  handlers.get("session_start")({}, ctx);
  let redraws = 0;
  const makeFooter = () => factory({ requestRender: () => redraws++ }, ctx.ui.theme, {
    getGitBranch() { assert.fail("footer must not read Git"); },
    getExtensionStatuses() { assert.fail("footer must not read unrelated statuses"); },
    onBranchChange() { assert.fail("footer must not subscribe to Git"); },
  });
  const footer = makeFooter();
  try {
    assert.match(footer.render(120)[0], /Tokens totaal: 0.*Tools: 7.*Eigen tools: 2/);
    assert.doesNotMatch(footer.render(120)[0], /Kosten|\$/);
    assert.match(footer.render(120)[0], /Oomagent-Mouad/);
    entries = [
      { type: "message", message: { role: "user", content: "test" } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "antwoord" }], usage: { input: 1000, output: 8, cacheRead: 200, cacheWrite: 34 } } },
    ];
    assert.match(footer.render(120)[0], /Tokens totaal: 1\.242.*Tools: 7.*Eigen tools: 2/);
    entries.push({ type: "message", message: { role: "user", content: "next" } });
    assert.match(footer.render(120)[0], /Tokens totaal: 1\.242/);
    tools = [...tools, { name: "new-tool", exposure: "deferred", sourceInfo: ownSource }];
    assert.match(footer.render(80)[0], /Tools: 8.*Eigen tools: 3/);
    tools = [...tools, { name: "external-tool", exposure: "deferred", sourceInfo: { path: join(ownDir.replace(/\/$/, "") + "-other", "external.ts") } }];
    assert.match(footer.render(80)[0], /Tools: 9.*Eigen tools: 3/);
    activeTools = activeTools.filter(name => name !== "bash");
    assert.match(footer.render(80)[0], /Tools: 8.*Eigen tools: 3/);
    await new Promise(resolve => setTimeout(resolve, 1100));
    assert.ok(redraws > 0, "periodic refresh works without header animation");
    assert.doesNotMatch(footer.render(120)[0], /Kosten|\$/);
    tools = [];
    assert.match(footer.render(80)[0], /Tools: 0.*Eigen tools: 0/);
    ctx.ui.theme = { fg: (_color, text) => `\x1b[32m${text}\x1b[0m`, style: text => `\x1b[36m${text}\x1b[0m`, bg: (_color, text) => text };
    for (const width of [0, 1, 10, 40, 80, 120]) {
      const lines = footer.render(width);
      assert.equal(lines.length, 1);
      assert.equal(visibleWidth(lines[0]), width);
    }
    assert.ok(backgrounds.every(color => color === "userMessageBg"));
  } finally {
    footer.dispose();
    footer.dispose();
  }
  const beforeDispose = redraws;
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(redraws, beforeDispose, "disposed footer stops refreshing");
  await commands.get("oom-footer").handler("", ctx);
  assert.equal(factory, undefined);
  await commands.get("oom-footer").handler("", ctx);
  assert.equal(typeof factory, "function");
  makeFooter().dispose();
  handlers.get("session_shutdown")();
});

await test("neon footer text bounces continuously and fits narrow widths", () => {
  const colors = [];
  const theme = { style: (text, options) => { colors.push(options.fg); return text; } };
  const banner = "Oomagent-Mouad";
  assert.equal(renderFooterTicker(28, 0, theme).indexOf(banner), 0);
  assert.equal(renderFooterTicker(28, 1, theme).indexOf(banner), 1);
  const lastPosition = 28 - banner.length;
  assert.equal(renderFooterTicker(28, lastPosition, theme).indexOf(banner), lastPosition);
  assert.equal(renderFooterTicker(28, lastPosition + 1, theme).indexOf(banner), lastPosition - 1);
  assert.equal(renderFooterTicker(28, 2 * lastPosition, theme).indexOf(banner), 0);
  assert.equal(renderFooterTicker(28, 2 * lastPosition + 1, theme).indexOf(banner), 1);
  for (const width of [banner.length, banner.length + 1, 28, 80]) {
    const distance = width - banner.length;
    for (let frame = 0; frame <= 4 * distance + 2; frame++) {
      const phase = distance ? frame % (2 * distance) : 0;
      const expected = phase <= distance ? phase : 2 * distance - phase;
      assert.equal(renderFooterTicker(width, frame, theme).indexOf(banner), expected);
    }
  }
  assert.equal(new Set(colors.map(color => JSON.stringify(color))).size, 4);
  for (const width of [0, 1, 10, 13, 14, 28, 80]) {
    for (const frame of [0, 1, 15, 100]) assert.equal(visibleWidth(renderFooterTicker(width, frame, theme)), width);
  }
});

await test("reload resets displayed usage without erasing history; toggles and tree keep new usage", async () => {
  const handlers = new Map();
  const commands = new Map();
  let factory;
  const entry = (id, input) => ({
    type: "message", id,
    message: { role: "assistant", usage: { input, output: 10, cacheRead: 20, cacheWrite: 30 } },
  });
  let entries = [
    entry("old", 900),
    { type: "message", id: "missing-old", message: { role: "assistant" } },
  ];
  const ctx = {
    mode: "tui", hasUI: true, cwd: "/project",
    sessionManager: { getBranch: () => [], getEntries: () => entries.map(e => ({ ...e })) },
    ui: {
      theme: { fg: (_color, text) => text, style: text => text, bg: (_color, text) => text },
      setFooter: value => { factory = value; }, setTheme: () => ({ success: true }),
      setTitle() {}, setEditorComponent() {}, setHeader() {}, setWidget() {},
    },
  };
  register({
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, cmd) => commands.set(name, cmd), registerMarkdownTransformer() {},
    getActiveTools: () => [], getAllTools: () => [],
  });
  let footer;
  const install = () => { footer = factory({ requestRender() {} }); };
  const expectUsage = tokens => {
    const line = footer.render(120)[0];
    assert.ok(line.includes(`Tokens totaal: ${tokens}`), line);
    assert.doesNotMatch(line, /Kosten|\$/);
  };
  try {
    handlers.get("session_start")({ reason: "startup" }, ctx);
    install();
    expectUsage("0");
    assert.equal(entries.length, 2, "history is not erased");
    entries.push(entry("new", 1000));
    expectUsage("1.060");
    handlers.get("session_tree")?.({}, ctx);
    expectUsage("1.060");
    await commands.get("oom-footer").handler("", ctx);
    assert.equal(factory, undefined);
    await commands.get("oom-footer").handler("", ctx);
    install();
    expectUsage("1.060");

    handlers.get("session_start")({ reason: "reload" }, ctx);
    install();
    expectUsage("0");
    assert.equal(entries.length, 3);
    entries.push(entry("after-reload", 2000));
    expectUsage("2.060");
    entries.push({ type: "usage", id: "warming", usage: {
      input: 100, output: 0, cacheRead: 20, cacheWrite: 0,
    } });
    expectUsage("2.180");
    entries.push({ type: "message", id: "missing-new", message: { role: "assistant" } });
    expectUsage("2.180*");
    handlers.get("session_start")({ reason: "reload" }, ctx);
    install();
    expectUsage("0");

    entries = [];
    handlers.get("session_start")({ reason: "new" }, ctx);
    install();
    expectUsage("0");
    entries.push(entry("first", 0));
    expectUsage("60");
  } finally {
    footer?.dispose();
    handlers.get("session_shutdown")();
  }
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

await test("orbital header and message dividers fit narrow terminals and follow theme changes", () => {
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
    assert.equal(header.render(100).length, 4, "compact orbital panel is shown by default");
    assert.match(header.render(100)[0], /OomAgent.*ENGINEERING WORKSPACE/);
    assert.match(header.render(100)[1], /Inspecteren.*Bouwen.*Verifiëren/);
    assert.match(header.render(100)[2], /\/help.*\/model.*\/settings.*\/oom-tree/);
    assert.match(header.render(40)[0], /OomAgent/);
    assert.equal(header.render(40).length, 2);
    ctx.ui.theme = {
      fg: (_color, text) => `\x1b[36m${text}\x1b[0m`,
      bg: (_color, text) => text, bold: text => text,
    };
    for (const width of [0, 1, 10, 40, 47, 48, 80, 120]) {
      const lines = header.render(width);
      assert.equal(lines.length, width < 48 ? 2 : 4);
      assert.ok(lines.every(line => visibleWidth(line) === width));
      if (width > 0) assert.ok(lines.every(line => line.includes("\x1b[36m")), "uses the current theme");
    }
    const markdown = "**Hello**\n\n```python\nprint('hello')\n```";
    const output = transform(markdown, { messageType: "user", availableWidth: 80, isStreaming: false });
    assert.match(output, /Mouad/);
    assert.ok(output.includes(markdown), "Markdown content stays intact");
    const streaming = transform(markdown, { messageType: "assistant", availableWidth: 80, isStreaming: true });
    assert.match(streaming, /pi-Oomagent/);
    assert.ok(!streaming.includes("╰"), "no closing divider while streaming");
    commands.get("oom-screen").handler("", ctx);
    assert.match(header.render(100)[0], /ORBITAL NETWORK/);
    for (const width of [48, 64, 80, 120]) {
      assert.ok(header.render(width).every(line => visibleWidth(line) <= width));
    }
    handlers.get("before_agent_start")();
    assert.equal(header.render(100).length, 4);
  } finally {
    header.dispose();
    handlers.get("session_shutdown")();
  }
});

await test("orbital node scene and dotted dividers stay within terminal columns", () => {
  for (const frame of [0, 1, 20]) {
    const scene = sceneLines(frame);
    assert.equal(scene.length, 11);
    assert.ok(scene.every(line => visibleWidth(line.map(cell => cell.text).join("")) === 64));
    assert.ok(scene.flat().some(cell => cell.text === "◎"));
  }
  for (const width of [0, 1, 3, 4, 10, 40, 80]) {
    for (const bottom of [false, true]) {
      const border = messageBorder("日本語 OomAgent", width, bottom);
      assert.ok(visibleWidth(border) <= width);
      if (width >= 4) {
        assert.equal(visibleWidth(border), width);
        assert.ok(border.includes("◎"));
      }
    }
  }
});

await test("project tree reads names only, bounds depth and hides sensitive/noisy entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "oomagent-tree-"));
  try {
    await mkdir(join(root, "src", "deep"), { recursive: true });
    await writeFile(join(root, "src", "deep", "never-shown.txt"), "");
    await writeFile(join(root, "src", "app.ts"), "");
    await writeFile(join(root, "src", "extra.ts"), "");
    await writeFile(join(root, "README.md"), "not read by the tree");
    for (const name of [".git", ".serena", "node_modules"]) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, "hidden.txt"), "");
    }
    for (const name of [".env", ".env.local", "bad\x1b[31m.txt", "日本語.txt"]) {
      await writeFile(join(root, name), "");
    }
    await symlink(join(root, "src"), join(root, "linked"), "dir");
    await symlink(join(root, "README.md"), join(root, "linked-file"));
    const entries = await readProjectTree(root);
    const text = entries.map(entry => entry.text).join("\n");
    assert.match(text, /📁 src/);
    assert.match(text, /📄 README.md/);
    assert.match(text, /日本語/);
    assert.match(text, /bad\?\[31m/);
    assert.match(text, /1 meer/);
    assert.doesNotMatch(text, /hidden|never-shown|\.env|node_modules|\.git|\.serena|linked|\x1b/);
    assert.equal(entries[0].directory, true, "directories appear first");
    for (let i = 0; i < 30; i++) await writeFile(join(root, `file-${i}.txt`), "");
    assert.ok((await readProjectTree(root)).length <= 65);
    await assert.rejects(readProjectTree(join(root, "missing")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test("project panel fits emoji, ANSI, resize, empty, loading and error states", () => {
  const theme = {
    fg: (_color, text) => `\x1b[36m${text}\x1b[0m`,
    bg: (_color, text) => text,
  };
  const entries = Array.from({ length: 20 }, (_, i) => ({
    text: `├─ 📁 日本語-${i}`, directory: true,
  }));
  for (const width of [0, 1, 10, 40, 80, 109, 110, 120, 200]) {
    for (const items of [undefined, [], entries]) {
      const lines = renderProjectPanel(["OomAgent"], items, "/project/日本語", width, theme);
      assert.ok(lines.every(line => visibleWidth(line) === width));
      assert.ok(lines.length <= 12);
      if (width >= 110) assert.match(lines[0], /OomAgent.*│.*📁/);
    }
  }
  assert.match(renderProjectPanel([], undefined, "/project", 80, theme).join("\n"), /laden/);
  assert.match(renderProjectPanel([], undefined, "/project", 80, theme, true).join("\n"), /Niet leesbaar/);
  assert.match(renderProjectPanel([], [], "/project", 80, theme).join("\n"), /Lege map/);
});

await test("header loads a real project panel and toggles it without changing the footer", async () => {
  const root = await mkdtemp(join(tmpdir(), "oomagent-panel-"));
  const handlers = new Map();
  const commands = new Map();
  let factory;
  let footer;
  let redraws = 0;
  register({
    on: (name, fn) => handlers.set(name, fn),
    registerCommand: (name, command) => commands.set(name, command),
    registerMarkdownTransformer() {},
  });
  const ctx = {
    mode: "tui", hasUI: true, cwd: root,
    ui: {
      theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text },
      setFooter: value => { footer = value; }, setTitle() {}, setEditorComponent() {},
      setHeader: value => { factory = value; }, setWidget() {},
      setTheme: () => ({ success: true }),
    },
  };
  let header;
  try {
    await writeFile(join(root, "README.md"), "");
    handlers.get("session_start")({}, ctx);
    const initialFooter = footer;
    header = factory({ requestRender: () => redraws++ });
    assert.match(header.render(120).join("\n"), /Structuur laden/);
    for (let i = 0; i < 50 && !header.render(120).join("\n").includes("README.md"); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.match(header.render(120).join("\n"), /📄 README.md/);
    await commands.get("oom-tree").handler("", ctx);
    assert.equal(header.render(120).length, 4);
    assert.doesNotMatch(header.render(120).join("\n"), /README.md/);
    await commands.get("oom-tree").handler("", ctx);
    assert.match(header.render(120).join("\n"), /README.md/);
    assert.equal(footer, initialFooter);
    assert.ok(redraws > 0);
    header.dispose();
    header.dispose();
    const stopped = redraws;
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal(redraws, stopped);
  } finally {
    header?.dispose();
    handlers.get("session_shutdown")();
    await rm(root, { recursive: true, force: true });
  }
});

await test("theme validates with Pi's loader", async () => {
  const hostRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  const { loadThemeFromPath } = await import(pathToFileURL(join(hostRoot, "modes/interactive/theme/theme.js")).href);
  const theme = loadThemeFromPath(fileURLToPath(new URL("../.pi/themes/oomagent-swiss.json", import.meta.url)));
  assert.equal(theme.name, "oomagent-swiss");
  assert.equal(theme.appearance, "dark");
  assert.ok(theme.fg("accent", "OomAgent").includes("OomAgent"));
  const ticker = renderFooterTicker(28, 1, theme);
  assert.equal(visibleWidth(ticker), 28);
  assert.ok(ticker.includes("\x1b["), "neon rendering uses terminal color/style escapes");
});

await test("non-terminal sessions do not install a footer", () => {
  const handlers = new Map();
  register({ on: (name, fn) => handlers.set(name, fn), registerCommand() {}, registerMarkdownTransformer() {} });
  for (const mode of ["rpc", "print", "json"]) {
    handlers.get("session_start")({}, { mode, hasUI: true, ui: { setFooter() { assert.fail("terminal-only"); } } });
  }
});
