import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import fsPromises from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { directoryLinkType } from "./helpers/symlinks.mjs";
import { safeLabel } from "../.pi/lib/workspace-files.mjs";

// Reuse the installed peer or an explicitly selected host; no install or network.
const host = process.env.PI_TEST_HOST ?? dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const hostRequire = createRequire(join(host, "package.json"));
const tuiPath = hostRequire.resolve("@earendil-works/pi-tui");
const { visibleWidth, styleText, colorToHex, getCellDimensions, setCellDimensions } = await import(pathToFileURL(tuiPath).href);
// Use Pi's own TS loader: Node 26 no longer supports stripTypeScriptTypes transform mode.
const { createJiti } = hostRequire("jiti");
const jiti = createJiti(import.meta.url, { fsCache: false, tryNative: false, alias: { "@earendil-works/pi-tui": tuiPath } });
const { scanTree, diagrams, renderDiagram, renderDate, dateGlow, StartDiagram, ProjectHeader, renderProjectName } = await jiti.import("../.pi/lib/start-diagram.ts");
const { default: register } = await jiti.import("../.pi/extensions/oomagent-start.ts");
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
  const filename = process.platform === "win32" ? "a-name.txt" : "a\nname.txt";
  writeFileSync(join(root, filename), "CONTENT MUST NOT APPEAR");
  assert.equal(safeLabel("a\nname.txt"), "a?name.txt");
  symlinkSync(root, join(root, "cycle"), directoryLinkType);
  symlinkSync(join(root, "missing-target"), join(root, "broken-link"), directoryLinkType);
  const tree = await scanTree(root);
  const lookup = name => tree.children.find(n => n.name === name);
  assert.ok(lookup(".env"));
  assert.ok(lookup(safeLabel(filename)));
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
  assert.deepEqual(selected.children.map(n => n.name), [".pi", "tests", "README.md"]);
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
  const configPage = pages.find(page => page.parent === "📁 .pi");
  assert.ok(configPage, "the .pi detail pages retain their real parent");
  const headings = renderDiagram(configPage, 120)[2];
  for (const name of ["skills", "flows", "extensions"]) assert.ok(headings.includes(`📁 ${name}`));
  assert.match(rendered, /📄 SKILL.md/);
});
test("startup overview expands files and subfolders and keeps all branches reachable by scrolling", async t => {
  const root = fixture(t);
  const files = {
    ".githooks": "pre-commit",
    ".serena": "project.yml",
    demos: "login/index.html",
    prototypes: "layout/README.md",
    scripts: "check.mjs",
    tests: "start.test.mjs",
  };
  mkdirSync(join(root, ".pi/skills/example"), { recursive: true });
  for (const [folder, file] of Object.entries(files)) {
    mkdirSync(join(root, folder, "node_modules/pkg"), { recursive: true });
    mkdirSync(join(root, folder, ".cache"));
    mkdirSync(dirname(join(root, folder, file)), { recursive: true });
    writeFileSync(join(root, folder, file), "DO NOT READ");
    for (const name of [".env.local", "auth.json", "credentials.json", "private.key"]) {
      writeFileSync(join(root, folder, name), "DO NOT READ");
    }
  }
  writeFileSync(join(root, "README.md"), "DO NOT READ");
  const selected = await scanTree(root, true);
  assert.deepEqual(selected.children.map(n => n.name).sort(), [".pi", ...Object.keys(files), "README.md"].sort());
  for (const [folder, file] of Object.entries(files)) {
    let node = selected.children.find(n => n.name === folder);
    for (const part of file.split("/")) {
      assert.deepEqual(node.children.map(n => n.name), [part], "only the expected branch remains");
      node = node.children[0];
    }
    assert.equal(node.kind, "file");
  }
  assert.ok(!JSON.stringify(selected).includes("DO NOT READ"));
  for (const rows of [24, 40]) for (const width of [48, 80, 120]) {
    const screen = new StartDiagram(selected, { terminal: { rows }, requestRender() {} }, theme);
    t.after(() => screen.dispose());
    const inner = width - 2 * Math.floor(width * 0.05);
    const pages = diagrams(selected, inner);
    const initial = screen.render(width).join("\n");
    assert.ok(initial.includes("📄 pre-commit"), `files are visible without navigation at ${width}x${rows}`);
    if (width >= 80) assert.ok(initial.includes("📁 skills"), "subfolders are expanded on startup");
    const overview = [];
    for (let step = 0; step <= renderDiagram(pages[0], inner).length; step++) {
      const lines = screen.render(width);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
      assert.ok(lines.length <= Math.floor(rows * 0.65), "leave room for chat/editor while scrolling");
      const text = lines.join("\n");
      if (text === overview.at(-1)) break;
      overview.push(text);
      screen.navigate("omlaag");
    }
    for (const folder of [".pi", ...Object.keys(files)]) assert.ok(overview.join("\n").includes(`📁 ${folder}`));
    for (const file of Object.values(files)) for (const part of file.split("/")) {
      assert.ok(overview.join("\n").includes(part), `${file} is reachable without changing pages at ${width}x${rows}`);
    }
    assert.ok(overview.join("\n").includes("📄 README.md"), "root files are included on the overview too");
    for (let step = 0; step < overview.length; step++) screen.navigate("omhoog");
    assert.equal(screen.render(width).join("\n"), initial, "scrolling up restores the startup tree");
    const rendered = [];
    for (let page = 0; page < pages.length; page++) {
      const lines = screen.render(width);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
      rendered.push(...lines);
      screen.navigate("volgende");
    }
    const text = rendered.join("\n");
    for (const [folder, file] of Object.entries(files)) {
      assert.ok(text.includes(`📁 ${folder}`), `${folder} is reachable at width ${width}`);
      assert.ok(text.includes(`📄 ${file.split("/").at(-1)}`), `${file} is visible at width ${width}`);
    }
  }
});
test("root overview respects narrow widths and preserves detail pages", () => {
  const root = { name: "project", kind: "folder", children: [
    { name: ".pi", kind: "folder", children: [{ name: "skills", kind: "folder", children: [{ name: "SKILL.md", kind: "file" }] }] },
    ...[".serena", "tests", "日本語📁".repeat(20)].map(name => ({ name, kind: "folder", children: [] })),
    { name: "README.md", kind: "file" },
  ] };
  for (const width of [1, 2, 12, 30, 48, 80, 120, 200]) {
    const pages = diagrams(root, width);
    assert.equal(pages[0].overview, true);
    assert.deepEqual(pages[0].columns.map(column => column.heading), root.children.map(node => `${node.kind === "folder" ? "📁" : "📄"} ${node.name}`));
    assert.deepEqual(pages[0].columns.map(column => column.nodes), root.children.map(node => node.children ?? []));
    if (width >= 48) {
      const overview = renderDiagram(pages[0], width).join("\n");
      for (const label of ["📁 skills", "📄 SKILL.md", "📄 README.md"]) assert.ok(overview.includes(label));
    }
    assert.ok(pages.slice(1).some(page => page.parent === "📁 .pi"));
    for (const page of pages) assert.ok(renderDiagram(page, width).every(line => visibleWidth(line) <= width));
  }
});
test("initial overview displays nested branches and root files together, including after resize", t => {
  const root = { name: "project", kind: "folder", children: [
    { name: "src", kind: "folder", children: [{ name: "lib", kind: "folder", children: [{ name: "helper.ts", kind: "file" }] }] },
    { name: "docs", kind: "folder", children: [{ name: "guide.md", kind: "file" }] },
    { name: "README.md", kind: "file" },
  ] };
  const tui = { terminal: { rows: 40 }, requestRender() {} };
  const screen = new StartDiagram(root, tui, theme);
  t.after(() => screen.dispose());
  for (const rows of [24, 40, 80]) {
    tui.terminal.rows = rows;
    screen.render(30);
    const lines = screen.render(120);
    const text = lines.join("\n");
    for (const label of ["📁 src", "📁 lib", "📄 helper.ts", "📁 docs", "📄 guide.md", "📄 README.md"]) {
      assert.ok(text.includes(label), `${label} appears without navigation at 120x${rows}`);
    }
    assert.ok(lines.every(line => visibleWidth(line) <= 120));
    assert.ok(lines.length <= Math.floor(rows * 0.65));
  }
});
test("empty directories and missing roots have explicit outcomes", async t => {
  const root = fixture(t);
  assert.equal((await scanTree(root)).note, "leeg");
  await assert.rejects(scanTree(join(root, "missing")), { code: "ENOENT" });
});
test("directory read errors are marked without failing the whole scan on every platform", async t => {
  const root = fixture(t), blocked = join(root, "blocked");
  mkdirSync(blocked);
  const readdir = fsPromises.readdir;
  let failures = 0;
  const mocked = t.mock.method(fsPromises, "readdir", async (path, ...args) => {
    if (path === blocked) { failures++; throw Object.assign(new Error("fixture"), { code: "EACCES" }); }
    return readdir(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  // Import after installing the mock: Jiti captures named built-in imports at load time.
  const isolated = createJiti(import.meta.url, { fsCache: false, moduleCache: false, tryNative: false,
    alias: { "@earendil-works/pi-tui": tuiPath } });
  const { scanTree: scanWithFailure } = await isolated.import("../.pi/lib/start-diagram.ts");
  const tree = await scanWithFailure(root);
  assert.equal(failures, 1);
  assert.equal(tree.children[0].note, "niet leesbaar / verdwenen");
});
test("POSIX unreadable directories are marked without failing the whole scan", async t => {
  if (process.platform === "win32") return t.skip("POSIX mode bits do not implement Windows ACLs; read-error handling is tested separately");
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
    if (rows <= 12) assert.equal(top, Math.min(3, Math.max(0, Math.floor(rows * 0.65) - 1)), "only tiny terminals reduce the top gap to keep content visible");
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
test("other projects get an animated 3D name above the date, without a duplicate caption or input handler", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: new Date(2026, 10, 13) });
  const handlers = {}, commands = {};
  register({ on: (name, fn) => handlers[name] = fn, registerCommand: (name, options) => commands[name] = options.handler });
  t.after(() => handlers.session_shutdown());
  let component, frames = 0;
  const ctx = { mode: "tui", hasUI: true, cwd: "/another/My-App", ui: {
    setHeader(factory) { component = factory({ terminal: { rows: 40 }, requestRender() { frames++; } }, theme); },
    notify() {},
  } };
  for (const mode of ["rpc", "print", "json"]) await handlers.session_start({}, { ...ctx, mode });
  assert.equal(component, undefined);
  await handlers.session_start({}, ctx);
  await Promise.resolve();
  assert.equal(component.handleInput, undefined);
  const lines = component.render(120);
  assert.deepEqual(lines, ["", "", "", ...renderProjectName("My-App", 120, theme), "", ...renderDate(new Date(), 120, 0, theme)]);
  assert.equal(lines.length, 17, "three top rows, six title rows, a gap and seven date rows");
  assert.ok(!lines.join("\n").includes("My-App"), "no duplicate plain caption");
  assert.ok(!lines.slice(3, 9).join("\n").includes("░"), "title retains one depth layer");
  assert.ok(lines.slice(10).join("\n").includes("░"), "date has two depth layers");
  assert.ok(!lines.join("\n").includes("📁") && !lines.join("\n").includes("oomagent-pi"));
  t.mock.timers.tick(1500);
  assert.equal(frames, 10);
  const animated = component.render(120);
  assert.notDeepEqual(animated.slice(3, 9), lines.slice(3, 9), "name glow advances");
  assert.notDeepEqual(animated.slice(10), lines.slice(10), "date glow advances");
  assert.deepEqual(animated.map(stripVTControlCharacters), lines.map(stripVTControlCharacters), "animation never shifts the layout");
  await commands["oom-start"]("omlaag", ctx);
  assert.deepEqual(component.render(120), animated);
  await commands["oom-start"]("verberg", ctx);
  assert.deepEqual(component.render(120), []);
  t.mock.timers.tick(1500);
  assert.equal(frames, 10, "hidden headers stop their timer");
  await commands["oom-start"]("toon", ctx);
  assert.deepEqual(component.render(120), lines);
  await handlers.session_start({ reason: "reload" }, ctx);
  await Promise.resolve();
  t.mock.timers.tick(1500);
  assert.equal(frames, 20, "replacement disposes the old timer");
  handlers.session_shutdown();
  handlers.session_shutdown();
  t.mock.timers.tick(1500);
  assert.equal(frames, 20, "shutdown stops animation, even when called twice");
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
test("name and date share a white face, travelling pastel glow and neutral depth layers", () => {
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
  assert.ok(calls.filter(call => call.text === "▓").every(call => colorToHex(call.fg) === "#454545"));
  assert.ok(calls.filter(call => call.text === "░").every(call => colorToHex(call.fg) === "#292929"));
  for (const render of [() => renderProjectName("Projects", 80, capture), () => renderProjectName("Projects", 80, capture, true), () => renderDate(date, 30, 0, capture)]) {
    calls.length = 0;
    render();
    assert.ok(calls.some(call => call.bold));
    assert.ok(calls.filter(call => call.bold).every(call => colorToHex(call.fg) === "#ffffff"), "name and compact fallbacks also rest in white");
  }
  for (const render of [() => renderDate(date, 80, 10, capture), () => renderProjectName("Projects", 80, capture, false, 10)]) {
    calls.length = 0;
    render();
    const glowingFaces = calls.filter(call => call.text === "█" && colorToHex(call.fg) !== "#ffffff");
    assert.ok(glowingFaces.length > 0, "rainbow highlight must reach both front faces");
    assert.ok(calls.filter(call => call.text === "▓").every(call => colorToHex(call.fg) === "#454545"));
    assert.ok(calls.filter(call => call.text === "░").every(call => colorToHex(call.fg) === "#292929"));
  }
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
test("project header centers both blocks, fits resizes and refreshes the date at midnight", t => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: new Date(2026, 10, 12, 23, 59, 59) });
  const tui = { terminal: { rows: 40 }, requestRender() {} };
  const screen = new ProjectHeader("Projects", tui, theme);
  t.after(() => screen.dispose());
  for (const width of [80, 120, 121, 200]) {
    const lines = screen.render(width).map(stripVTControlCharacters);
    assert.deepEqual(lines.slice(0, 3), ["", "", ""]);
    for (const block of [lines.slice(3, 9), lines.slice(10)]) {
      const left = Math.min(...block.map(line => line.search(/\S/)).filter(x => x >= 0));
      const right = width - Math.max(...block.map(line => visibleWidth(line.trimEnd())));
      assert.ok(Math.abs(left - right) <= 1, `block centered at ${width}: ${left}/${right}`);
    }
    assert.ok(!lines.join("\n").includes("Projects"));
  }
  for (const rows of [14, 18, 24, 26, 27, 40, 80]) for (const width of [0, 1, 2, 30, 40, 41, 80, 120]) {
    tui.terminal.rows = rows;
    const lines = screen.render(width);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    assert.ok(lines.length <= Math.floor(rows * 0.65), "leave room for the chat/editor");
    if (width === 0) assert.deepEqual(lines, []);
    else if (rows < 27) assert.equal(lines.length, 6);
    else if (width >= 41) assert.equal(lines.length, 17);
  }
  tui.terminal.rows = 18;
  assert.match(stripVTControlCharacters(screen.render(80).join("\n")), /12 november 2026/);
  t.mock.timers.tick(1200);
  assert.match(stripVTControlCharacters(screen.render(80).join("\n")), /13 november 2026/);
  screen.invalidate();
});
test("startup headers reserve at least 50px using cell height, including after resize", t => {
  const original = getCellDimensions();
  t.after(() => setCellDimensions(original));
  const tui = { terminal: { rows: 40 }, requestRender() {} };
  const project = new ProjectHeader("Projects", tui, theme);
  const workspace = new StartDiagram(tree, tui, theme);
  t.after(() => { project.dispose(); workspace.dispose(); });
  for (const heightPx of [9, 16, 18, 20, 25, 32, 50, 64]) {
    setCellDimensions({ widthPx: 9, heightPx });
    for (const rows of [14, 24, 27, 40, 80]) for (const screen of [project, workspace]) {
      tui.terminal.rows = rows;
      const lines = screen.render(120).map(stripVTControlCharacters);
      const top = lines.findIndex(line => line.trim());
      assert.ok(top * heightPx >= 50, `top gap at ${rows} rows / ${heightPx}px cells`);
      if (screen === project) assert.equal(top, Math.ceil(50 / heightPx));
      assert.ok(lines.length <= Math.floor(rows * 0.65), "padding must leave chat/editor space");
      assert.ok(lines.every(line => visibleWidth(line) <= 120));
    }
  }
});
test("short single-column branches stay near the centered root", () => {
  const page = { columns: [{ heading: "📁 .githooks", nodes: [{ name: "pre-commit", kind: "file" }] }] };
  const lines = renderDiagram(page, 120);
  const child = lines.find(line => line.includes("pre-commit"));
  assert.ok(child.indexOf("└") > 45, "do not attach short branches to the far left edge");
});
test("project disables codemode registration and exposes standard tools through native discovery", () => {
  const settings = JSON.parse(readFileSync(new URL("../.pi/settings.json", import.meta.url), "utf8"));
  assert.ok(settings.extensions.includes("-builtin:codemode"));
  assert.equal(settings.codemode.mode, "on");
  assert.ok(!settings.defaultTools.some(name => name.includes("codemode")));
  assert.deepEqual(settings.defaultTools, ["tool_search"]);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.pi.extensions.includes("./.pi/extensions/lazy-tools.ts"));
});
