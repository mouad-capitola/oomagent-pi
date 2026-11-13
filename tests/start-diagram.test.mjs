import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, chmodSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, join } from "node:path";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Same host-resolution convention as workspace.test.mjs; no install or network.
const host = process.env.PI_TEST_HOST ?? join(homedir(), ".pi/agent/install/releases",
  readFileSync(join(homedir(), ".pi/agent/install/current-version"), "utf8").trim(), "node_modules/@earendil-works/pi-coding-agent");
const tuiUrl = pathToFileURL(createRequire(join(host, "package.json")).resolve("@earendil-works/pi-tui")).href;
const { visibleWidth, styleText, colorToHex } = await import(tuiUrl);
const compile = source => "data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source, { mode: "transform" })).toString("base64");
const source = readFileSync(new URL("../.pi/lib/start-diagram.ts", import.meta.url), "utf8");
const moduleUrl = compile(source.replace('"@earendil-works/pi-tui"', JSON.stringify(tuiUrl))
  .replace('"./workspace-files.mjs"', JSON.stringify(new URL("../.pi/lib/workspace-files.mjs", import.meta.url).href)));
const { scanTree, diagrams, renderDiagram, renderDate, dateGlow, StartDiagram, renderProjectName } = await import(moduleUrl);
const entry = readFileSync(new URL("../.pi/extensions/oomagent-start.ts", import.meta.url), "utf8");
const { default: register } = await import(compile(entry.replace('"../lib/start-diagram.ts"', JSON.stringify(moduleUrl))
  .replace('"../lib/project-presentation.mjs"', JSON.stringify(new URL("../.pi/lib/project-presentation.mjs", import.meta.url).href))));
const theme = { fg: (_color, text) => text, style: (text, options) => styleText(text, options, "truecolor") };

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "start-diagram-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test("scan includes hidden names, caps depth, collapses dependencies and never follows links", async t => {
  const root = fixture(t);
  for (const path of [".pi/skills/example/deeper", ".git/objects", "node_modules/library"]) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, ".env"), "CONTENT MUST NOT APPEAR");
  writeFileSync(join(root, "a\nname.txt"), "CONTENT MUST NOT APPEAR");
  symlinkSync(root, join(root, "cycle"));
  symlinkSync("/missing-target", join(root, "broken-link"));
  const tree = await scanTree(root);
  const lookup = name => tree.children.find(n => n.name === name);
  assert.ok(lookup(".env"));
  assert.ok(lookup("a?name.txt"));
  for (const name of [".git", "node_modules"]) {
    assert.equal(lookup(name).note, "ingeklapt");
    assert.equal(lookup(name).children, undefined);
  }
  for (const name of ["cycle", "broken-link"]) {
    assert.equal(lookup(name).kind, "link");
    assert.equal(lookup(name).children, undefined);
  }
  assert.equal(lookup(".pi").children[0].children[0].note, "dieptelimiet");
  assert.ok(!JSON.stringify(tree).includes("CONTENT MUST NOT APPEAR"));
  assert.ok(!JSON.stringify(tree).includes("deeper"));
});
test("important selection retains real skill/flow ancestry and deep files without technical noise", async t => {
  const root = fixture(t);
  for (const path of [".pi/skills/example/references", ".pi/flows/demo", ".pi/extensions", ".pi/npm/cache", ".git/objects", "node_modules/pkg", "tests"]) mkdirSync(join(root, path), { recursive: true });
  for (const path of [".pi/skills/example/SKILL.md", ".pi/skills/example/references/guide.md", ".pi/flows/demo/flow.json", ".pi/extensions/start.ts", ".pi/settings.json", ".pi/.env", "README.md"]) writeFileSync(join(root, path), "DO NOT READ");
  const selected = await scanTree(root, true);
  assert.deepEqual(selected.children.map(n => n.name), [".pi", "README.md"]);
  const pi = selected.children[0];
  assert.deepEqual(pi.children.map(n => n.name), ["skills", "flows", "extensions", "settings.json"]);
  const skill = pi.children[0].children[0];
  assert.equal(skill.name, "example");
  assert.equal(skill.children[0].children[0].name, "guide.md");
  assert.equal(skill.children[1].name, "SKILL.md");
  assert.equal(pi.children[1].children[0].children[0].name, "flow.json");
  assert.ok(!JSON.stringify(selected).includes("DO NOT READ"));
  const rendered = diagrams(selected, 120).flatMap(page => renderDiagram(page, 120)).join("\n");
  const pages = diagrams(selected, 120);
  assert.equal(pages[0].parent, "📁 .pi");
  const headings = renderDiagram(pages[0], 120)[2];
  for (const name of ["skills", "flows", "extensions"]) assert.ok(headings.includes(`📁 ${name}`));
  assert.match(rendered, /📄 SKILL.md/);
});
test("empty directories and missing roots have explicit outcomes", async t => {
  const root = fixture(t);
  assert.equal((await scanTree(root)).note, "leeg");
  await assert.rejects(scanTree(join(root, "missing")), { code: "ENOENT" });
});
test("unreadable directories are marked without failing the whole scan", async t => {
  if (process.getuid?.() === 0) return t.skip("root bypasses directory permissions");
  const root = fixture(t), blocked = join(root, "blocked");
  mkdirSync(blocked);
  chmodSync(blocked, 0);
  try {
    const tree = await scanTree(root);
    assert.equal(tree.children[0].note, "niet leesbaar / verdwenen");
  } finally { chmodSync(blocked, 0o700); }
});
test("scan budget includes exactly 10000 entries and explicitly marks the remainder", async t => {
  const root = fixture(t);
  for (let i = 0; i < 10001; i++) writeFileSync(join(root, `file-${i}`), "");
  const tree = await scanTree(root);
  assert.equal(tree.children.length, 10000);
  assert.equal(tree.note, "rest weggelaten: limiet 10000 items");
});
const tree = { name: "oomagent-pi", kind: "folder", children: [
  { name: "src", kind: "folder", children: [{ name: "日本語📁".repeat(60), kind: "file" }] },
  ...Array.from({ length: 12 }, (_, i) => ({ name: `file-${i}.txt`, kind: "file" })),
] };
test("organigram columns preserve subtrees and list many files underneath each folder", () => {
  for (const width of [1, 2, 12, 30, 48, 80, 120, 200]) {
    const pages = diagrams(tree, width);
    const columns = pages.flatMap(page => page.columns);
    assert.equal(columns[0].heading, "📁 src");
    assert.deepEqual(columns[0].nodes, tree.children[0].children);
    assert.deepEqual(columns.slice(1).map(column => column.heading), tree.children.slice(1).map(node => `📄 ${node.name}`));
    assert.ok(columns.slice(1).every(column => column.nodes.length === 0));
    assert.ok(!JSON.stringify(columns).includes("Root-items"));
    for (const page of pages) {
      const lines = renderDiagram(page, width);
      assert.ok(lines.every(line => visibleWidth(line) <= width), `overflow at ${width}`);
      assert.ok(lines.some(line => line.includes("│")));
    }
  }
  const lines = renderDiagram(diagrams(tree, 120)[0], 120);
  assert.match(lines[1], /[┴┼]/, "shared centered root branches into columns");
  const allPages = diagrams(tree, 120).flatMap(page => renderDiagram(page, 120)).join("\n");
  for (const node of tree.children.slice(1)) assert.ok(allPages.includes(node.name), "each root file stays a direct child");
  assert.ok(diagrams(tree, 30).length > diagrams(tree, 120).length);
});
test("header centers horizontally, moves down on roomy terminals and leaves 35% for chat/editor", t => {
  const tui = { terminal: { rows: 40 }, requestRender() {} };
  const screen = new StartDiagram(tree, tui, theme);
  t.after(() => screen.dispose());
  assert.equal(screen.handleInput, undefined, "widget must never consume typed text/arrows/Enter");
  let lines = screen.render(120);
  assert.equal(visibleWidth(lines.find(line => line.includes("📁 oomagent-pi")).split("📁")[0]), Math.floor((120 - visibleWidth("📁 oomagent-pi")) / 2));
  assert.ok(lines.some(line => line.includes("📄 file-0.txt")));
  const before = lines.join("\n");
  screen.navigate("omlaag");
  assert.notEqual(screen.render(120).join("\n"), before);
  screen.render(30);
  screen.navigate("volgende");
  assert.match(screen.render(30).join("\n"), /2\/13/);
  screen.navigate("vorige");
  assert.match(screen.render(30).join("\n"), /1\/13/);
  for (const rows of [1, 4, 12, 40, 55, 80]) for (const width of [1, 30, 80, 120, 200]) {
    tui.terminal.rows = rows;
    lines = screen.render(width);
    const margin = Math.floor(width * 0.05);
    assert.ok(lines.length <= Math.max(1, Math.floor(rows * 0.65)));
    const top = lines.findIndex(line => line.trim());
    assert.ok(top >= 0 && top <= 8);
    if (rows <= 12) assert.equal(top, 0, "small terminals do not lose space to padding");
    if (rows >= 40) assert.ok(top >= 3, "roomy terminals move the whole block down");
    assert.ok(lines.length - top <= Math.max(1, Math.min(22, Math.floor(rows * 0.55))));
    assert.ok(lines.every(line => line.startsWith(" ".repeat(margin)) && visibleWidth(line) <= width - margin));
  }
  screen.invalidate();
});
test("TUI lifecycle uses the transcript header, never an editor widget or overlay", async () => {
  const handlers = {}, commands = {};
  register({ on: (name, fn) => handlers[name] = fn, registerCommand: (name, options) => commands[name] = options.handler });
  let installed = 0, removed = 0;
  let onInstall = () => {};
  const ctx = { mode: "tui", hasUI: true, cwd: fileURLToPath(new URL("../", import.meta.url)), ui: {
    setHeader: factory => {
      const component = factory({ terminal: { rows: 40 }, requestRender() {} }, theme);
      const lines = component.render(120);
      if (!lines.length) { removed++; return; }
      installed++;
      assert.ok(lines.join("\n").includes(`📁 ${basename(ctx.cwd)}`), "header names the actual checkout, including isolated Git snapshots");
      onInstall();
    },
    custom: () => assert.fail("no overlay"),
    setEditorComponent: () => assert.fail("leave editor intact"),
    setWidget: () => assert.fail("diagram must not sit below the chat"),
    notify: (_text, level) => assert.equal(level, "info"),
  } };
  for (const mode of ["rpc", "print", "json"]) await handlers.session_start({ reason: "startup" }, { ...ctx, mode });
  assert.equal(installed, 0);
  for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
    await new Promise(resolve => { onInstall = resolve; handlers.session_start({ reason }, ctx); });
  }
  assert.equal(installed, 5);
  await commands["oom-start"]("omlaag", ctx);
  await commands["oom-start"]("", ctx);
  assert.equal(installed, 5, "navigation/help must not replace the widget");
  await commands["oom-start"]("verberg", ctx);
  assert.equal(removed, 1);
  await commands["oom-start"]("toon", ctx);
  assert.equal(installed, 6);
  handlers.session_shutdown();
});
test("other projects get their own name without a diagram, editor, or input handler", async () => {
  const handlers = {}, commands = {};
  register({ on: (name, fn) => handlers[name] = fn, registerCommand: (name, options) => commands[name] = options.handler });
  let component;
  const ctx = { mode: "tui", hasUI: true, cwd: "/another/My-App", ui: {
    setHeader(factory) { component = factory({ terminal: { rows: 40 } }, theme); },
    notify() {},
  } };
  await handlers.session_start({}, ctx);
  await Promise.resolve();
  assert.equal(component.handleInput, undefined);
  const lines = component.render(120).join("\n");
  assert.match(lines, /My-App/);
  for (const glyph of ["█", "▓"]) assert.ok(lines.includes(glyph));
  assert.ok(!lines.includes("░"), "project title has only one shadow layer");
  assert.equal(component.render(120).length, 7, "five face rows, one shadow row and caption");
  assert.ok(!lines.includes("📁") && !lines.includes("oomagent-pi"));
  await commands["oom-start"]("omlaag", ctx);
  await commands["oom-start"]("verberg", ctx);
  assert.deepEqual(component.render(120), []);
  await commands["oom-start"]("toon", ctx);
  assert.match(component.render(120).join("\n"), /My-App/);
  handlers.session_shutdown();
});
test("project names fit narrow terminals and retain Unicode without terminal controls", () => {
  for (const name of ["My-App", "a".repeat(500), "日本語📁", "evil\x1b[2J\nname", "école", ""]) {
    for (const width of [0, 1, 2, 12, 30, 80, 120]) {
      const lines = renderProjectName(name, width, theme);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
      assert.ok(!lines.join("").includes("\x1b[2J"));
      assert.ok(lines.every(line => !line.includes("\n")));
    }
  }
  assert.match(renderProjectName("日本語", 80, theme).join(""), /日本語/);
  assert.equal(renderProjectName("My-App", 120, theme, true).length, 1);
});
test("date has a travelling pastel face glow, white resting face and two dark depth layers", () => {
  const calls = [];
  const capture = { style(text, options) { calls.push({ text, ...options }); return text; } };
  const date = new Date(2026, 10, 12, 23, 59, 59);
  const lines = renderDate(date, 80, 0, capture);
  assert.equal(lines.length, 7);
  assert.ok(!lines.join("\n").includes("november"), "no duplicate date caption");
  assert.ok(lines.slice(0, 5).every(line => line.includes("█")));
  assert.match(lines[5], /▓/);
  assert.match(lines[6], /░/);
  const faces = calls.filter(call => call.text === "█");
  assert.ok(faces.length > 50 && faces.every(call => colorToHex(call.fg) === "#ffffff" && call.bold));
  assert.ok(calls.filter(call => call.text === "▓").every(call => colorToHex(call.fg) === "#454545"), "quiet interval is neutral");
  assert.ok(calls.filter(call => call.text === "░").every(call => colorToHex(call.fg) === "#292929"));
  calls.length = 0;
  renderDate(date, 80, 10, capture);
  const glowingFaces = calls.filter(call => call.text === "█" && colorToHex(call.fg) !== "#ffffff");
  assert.ok(glowingFaces.length > 0, "pastel highlight must reach the front, not just the shadow");
  assert.ok(calls.filter(call => call.text === "▓").every(call => colorToHex(call.fg) === "#454545"));
  assert.ok(calls.filter(call => call.text === "░").every(call => colorToHex(call.fg) === "#292929"));
  assert.equal(colorToHex(dateGlow(2, 41, 10)), "#fffac2");
  assert.equal(colorToHex(dateGlow(8, 41, 10)), "#f5ccf4");
  const lit = frame => Array.from({ length: 41 }, (_, x) => x).filter(x => colorToHex(dateGlow(x, 41, frame)) !== "#ffffff");
  assert.deepEqual(lit(0), []);
  assert.deepEqual(lit(10), [2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(lit(11), [3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(lit(60), []);
  assert.deepEqual(lit(65), []);
  assert.match(renderDate(new Date(2026, 10, 13), 80, 0, capture, true)[0], /13 november 2026/);
  assert.equal(renderDate(date, 30, 0, capture).length, 1);
  for (const width of [0, 1, 2, 10, 30, 80]) {
    assert.ok(renderDate(date, width, 100, theme).every(line => visibleWidth(line) <= width));
  }
});
test("animation requests frames and stops after disposal", t => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: new Date(2026, 10, 12, 23, 59, 59) });
  let frames = 0;
  const screen = new StartDiagram(tree, { terminal: { rows: 40 }, requestRender() { frames++; } }, theme);
  t.after(() => screen.dispose());
  assert.match(screen.render(40).join("\n").replace(/\x1b\[[0-9;]*m/g, ""), /12 november 2026/);
  t.mock.timers.tick(1200);
  assert.ok(frames > 0);
  assert.match(screen.render(40).join("\n").replace(/\x1b\[[0-9;]*m/g, ""), /13 november 2026/);
  screen.dispose();
  screen.dispose();
  const before = frames;
  t.mock.timers.tick(1200);
  assert.equal(frames, before);
});
test("short single-column branches stay near the centered root", () => {
  const page = { columns: [{ heading: "📁 .githooks", nodes: [{ name: "pre-commit", kind: "file" }] }] };
  const lines = renderDiagram(page, 120);
  const child = lines.find(line => line.includes("pre-commit"));
  assert.ok(child.indexOf("└") > 45, "do not attach short branches to the far left edge");
});
test("project disables codemode registration and retains direct standard tools", () => {
  const settings = JSON.parse(readFileSync(new URL("../.pi/settings.json", import.meta.url), "utf8"));
  assert.ok(settings.extensions.includes("-builtin:codemode"));
  assert.equal(settings.codemode.mode, "on");
  assert.ok(!settings.defaultTools.some(name => name.includes("codemode")));
  for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls", "tool_search"]) assert.ok(settings.defaultTools.includes(name));
});
