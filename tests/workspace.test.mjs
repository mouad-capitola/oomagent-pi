import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync, readdirSync, realpathSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";
import { checkedPath, listFolder, readDocument, saveDocument, projectFor, TextBuffer, safeLabel, MAX_FILE_BYTES } from "../.pi/lib/workspace-files.mjs";

// Test against the actual managed Pi host, not the older development peer copy.
const release = readFileSync(join(homedir(), ".pi/agent/install/current-version"), "utf8").trim();
const host = join(homedir(), ".pi/agent/install/releases", release, "node_modules/@earendil-works/pi-coding-agent");
const requireHost = createRequire(join(host, "package.json"));
const tuiUrl = pathToFileURL(requireHost.resolve("@earendil-works/pi-tui")).href;
const codingUrl = pathToFileURL(join(host, "dist/index.js")).href;
const { initTheme } = await import(codingUrl);
initTheme("dark", false);
const themeModule = await import(pathToFileURL(join(host, "dist/modes/interactive/theme/theme.js")).href);
const { validateThemeJson } = await import(pathToFileURL(join(host, "dist/modes/interactive/theme/theme-schema.js")).href);
const themePath = new URL("../.pi/themes/oomagent-swiss.json", import.meta.url);
validateThemeJson("oomagent-swiss", JSON.parse(readFileSync(themePath, "utf8")));
themeModule.setThemeInstance(themeModule.loadThemeFromPath(themePath.pathname, "truecolor"));
const { visibleWidth, stripTerminalSequences, CURSOR_MARKER } = await import(tuiUrl);
const modelUrl = new URL("../.pi/lib/workspace-files.mjs", import.meta.url).href;
const compile = source => "data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source, { mode: "transform" })).toString("base64");
const changesUrl = new URL("../.pi/lib/workspace-changes.mjs", import.meta.url).href;
const uiUrl = compile(readFileSync(new URL("../.pi/lib/workspace-ui.ts", import.meta.url), "utf8")
  .replace('"@earendil-works/pi-coding-agent"', JSON.stringify(codingUrl))
  .replace('"@earendil-works/pi-tui"', JSON.stringify(tuiUrl))
  .replace('"./workspace-files.mjs"', JSON.stringify(modelUrl))
  .replace('"./workspace-changes.mjs"', JSON.stringify(changesUrl)));
const { WorkspaceState, WorkspaceEditor, WelcomeScreen, dateArt } = await import(uiUrl);
const entryUrl = compile(readFileSync(new URL("../.pi/extensions/oomagent-workspace.ts", import.meta.url), "utf8")
  .replace('"../lib/workspace-ui.ts"', JSON.stringify(uiUrl))
  .replace('"../lib/workspace-files.mjs"', JSON.stringify(modelUrl)));
const { default: register } = await import(entryUrl);

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-workspace-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "project"));
  const path = join(root, "project", "code.ts");
  writeFileSync(path, "\uFEFF\tconst value = '日本語';\r\n");
  return { root, path };
}
const theme = { fg: (_c, s) => s, bg: (_c, s) => s, bold: s => s };
const editorTheme = { borderColor: s => s, selectList: { selectedPrefix: s => s, selectedText: s => s, description: s => s, scrollInfo: s => s, noMatch: s => s } };
const keys = { matches: () => false };
function makeEditor(state) {
  const tui = { terminal: { rows: 40, columns: 100 }, requestRender() {} };
  const editor = new WorkspaceEditor(tui, editorTheme, keys, state, { cwd: state.root, ui: { theme } }, () => {});
  editor.focused = true;
  return { editor, tui };
}

test("file edits preserve UTF-8 BOM, tabs, CRLF and permissions", t => {
  const { root, path } = fixture(t), original = readDocument(root, path);
  const saved = saveDocument(root, original, original.text + "// added\r\n");
  assert.equal(saved.text, "\uFEFF\tconst value = '日本語';\r\n// added\r\n");
  assert.equal(statSync(path).mode & 0o777, original.mode & 0o777);
  assert.equal(readdirSync(join(root, "project")).length, 1);
});
test("external edits and inode replacement refuse overwrite and retain original", t => {
  const { root, path } = fixture(t), original = readDocument(root, path);
  writeFileSync(path, "another session");
  assert.throws(() => saveDocument(root, original, "mine"), /Conflict/);
  assert.equal(readFileSync(path, "utf8"), "another session");
});
test("boundaries, secrets, symlinks, hardlinks, binary and invalid UTF-8 are blocked", t => {
  const { root, path } = fixture(t);
  assert.throws(() => checkedPath(root, "../outside"), /Buiten/);
  assert.throws(() => checkedPath(root, root + "-other"), /Buiten/);
  writeFileSync(join(root, ".env.local"), "not a real secret");
  symlinkSync(path, join(root, "linked"));
  symlinkSync(tmpdir(), join(root, "outside"));
  assert.throws(() => readDocument(root, ".env.local"), /Gevoelig/);
  assert.throws(() => readDocument(root, "linked"), /Symlink/);
  assert.throws(() => checkedPath(root, "outside"), /Symlink/);
  const entries = listFolder(root, root);
  assert.ok(entries.find(e => e.name === ".env.local").blocked);
  assert.ok(entries.find(e => e.name === "linked").link);
  writeFileSync(join(root, "binary"), Buffer.from([0, 5, 3]));
  assert.throws(() => readDocument(root, "binary"), /Binair/);
  writeFileSync(join(root, "invalid"), Buffer.from([255]));
  assert.throws(() => readDocument(root, "invalid"));
  linkSync(path, join(root, "hard"));
  assert.throws(() => readDocument(root, path), /hardlinks/);
  assert.equal(safeLabel("evil\x1b[2J\u202e"), "evil?[2J?");
});
test("file size boundary and project selection are explicit", t => {
  const { root, path } = fixture(t);
  writeFileSync(path, "x".repeat(MAX_FILE_BYTES));
  assert.equal(readDocument(root, path).bytes.length, MAX_FILE_BYTES);
  writeFileSync(path, "x".repeat(MAX_FILE_BYTES + 1));
  assert.throws(() => readDocument(root, path), /512 KiB/);
  assert.equal(projectFor(root, path), join(root, "project"));
  assert.throws(() => projectFor(root, root), /Selecteer/);
});
test("buffer moves, deletes and undoes Unicode without normalizing tabs or CRLF", () => {
  assert.equal(new TextBuffer("\nfirst").lineStart(), 0);
  const b = new TextBuffer("a🔧e\u0301\r\n\tx");
  b.cursor = 1; b.cursor = b.next(); assert.equal(b.cursor, 3);
  b.replace(b.previous(), b.cursor, ""); assert.equal(b.text, "ae\u0301\r\n\tx");
  b.undo(); assert.equal(b.text, "a🔧e\u0301\r\n\tx");
  b.cursor = b.text.indexOf("\r"); b.cursor = b.next(); assert.equal(b.text[b.cursor], "\t");
  b.cursor = b.previous(); assert.equal(b.text[b.cursor], "\r");
  b.cursor = 0; assert.equal(b.lineStart(), 0);
});
test("tree opens lazily and dirty buffers cannot be silently replaced", t => {
  const { root } = fixture(t), state = new WorkspaceState(root);
  state.rebuild(); assert.equal(state.rows.length, 1);
  state.openSelected(); assert.equal(state.rows.length, 2);
  state.selected = 1; state.openSelected(); state.buffer.insert("x");
  assert.ok(state.dirty);
  assert.throws(() => state.openSelected(), /concept/);
  state.save(); assert.equal(state.dirty, false);
});
test("file input stays separate from chat; paste, newline, undo, save and escape", t => {
  const { root, path } = fixture(t), state = new WorkspaceState(root);
  state.rebuild(); state.openSelected(); state.selected = 1; state.openSelected();
  const { editor } = makeEditor(state);
  let submitted = 0; editor.onSubmit = () => submitted++;
  editor.setText("chat draft");
  editor.handleInput("\x1b[200~hello\nworld\x1b[201~");
  assert.ok(state.buffer.text.startsWith("hello\r\nworld"));
  editor.handleInput("\r"); assert.equal(submitted, 0);
  editor.handleInput("\x1a"); // undo newline
  assert.ok(state.buffer.text.startsWith("hello\r\nworld\uFEFF"));
  editor.handleInput("\x13"); assert.equal(state.dirty, false);
  assert.ok(readFileSync(path, "utf8").startsWith("hello\r\nworld"));
  editor.handleInput("\x1b"); assert.equal(state.pane, "chat");
  assert.equal(editor.getText(), "chat draft");
  editor.handleInput("\r"); assert.equal(submitted, 1);
});
test("terminal frames fit resize, Unicode, focus and tiny terminal bounds", t => {
  const { root } = fixture(t), state = new WorkspaceState(root);
  state.rebuild(); state.openSelected(); state.selected = 1; state.openSelected();
  const { editor, tui } = makeEditor(state);
  for (const pane of ["tree", "file", "chat"]) {
    state.pane = pane;
    for (const width of [1, 20, 31, 32, 60, 100, 200]) {
      for (const height of [12, 24, 40, 80]) {
        tui.terminal.rows = height;
        const frame = editor.render(width);
        assert.ok(frame.every(line => visibleWidth(line) <= width), pane + " " + width + "x" + height);
        assert.ok(frame.filter(line => line.includes(CURSOR_MARKER)).length <= 1);
        if (width >= 60 && height >= 24) assert.match(stripTerminalSequences(frame.join("\n")), /Projects/);
      }
    }
  }
});
test("welcome consumes ready locally and supports cancel and centered resize", () => {
  let ready;
  const tui = { terminal: { rows: 30 }, requestRender() {} };
  const screen = new WelcomeScreen(tui, theme, value => ready = value);
  assert.equal(dateArt(new Date(2026, 9, 14)).length, 6);
  for (const width of [1, 20, 42, 100]) {
    const lines = screen.render(width);
    assert.equal(lines.length, 30);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
  screen.handleInput("ready"); screen.handleInput("\r");
  assert.equal(ready, true);
  screen.handleInput("\x1b"); assert.equal(ready, false);
});
test("tmux workbench leaves the internal workspace disabled without registering handlers", () => {
  const previous = process.env.OOMAGENT_TMUX;
  try {
    process.env.OOMAGENT_TMUX = "1";
    register(new Proxy({}, { get() { assert.fail("Internal workspace registered inside tmux"); } }));
  } finally {
    if (previous === undefined) delete process.env.OOMAGENT_TMUX;
    else process.env.OOMAGENT_TMUX = previous;
  }
});

test("non-TUI sessions never install UI or start welcome screen", async () => {
  const handlers = new Map();
  register({ on: (name, fn) => handlers.set(name, fn), events: { on() {} }, registerCommand() {} });
  await handlers.get("session_start")({}, { mode: "rpc", hasUI: true, ui: new Proxy({}, { get() { assert.fail("RPC UI accessed"); } }) });
  handlers.get("session_shutdown")();
  assert.equal(handlers.get("before_agent_start")(), undefined);
});
test("reload follows saved external edits but never overwrites a dirty buffer", t => {
  const { root, path } = fixture(t), state = new WorkspaceState(root);
  state.rebuild(); state.openSelected(); state.selected = 1; state.openSelected();
  writeFileSync(path, "agent edit");
  state.reloadFile();
  assert.equal(state.buffer.text, "agent edit");
  state.buffer.insert("mine");
  writeFileSync(path, "other edit");
  assert.throws(() => state.reloadFile(), /Concept/);
  assert.equal(state.buffer.text, "mineagent edit");
});
test("canonical root aliases work while descendant symlinks stay blocked", t => {
  const { root, path } = fixture(t);
  const alias = root + "-alias";
  symlinkSync(root, alias);
  t.after(() => rmSync(alias));
  assert.equal(checkedPath(alias, join(alias, "project/code.ts")), path);
  assert.equal(projectFor(alias, path), join(root, "project"));
});
test("long Unicode lines retain exactly one visible editor cursor", t => {
  const { root } = fixture(t), state = new WorkspaceState(root);
  state.rebuild(); state.openSelected(); state.selected = 1; state.openSelected();
  state.buffer = new TextBuffer("日本語🔧".repeat(80));
  state.buffer.cursor = state.buffer.text.length;
  state.pane = "file";
  const { editor } = makeEditor(state);
  const frame = editor.render(80);
  assert.equal(frame.filter(line => line.includes(CURSOR_MARKER)).length, 1);
  assert.ok(frame.every(line => visibleWidth(line) <= 80));
});
test("syntax colors and icons preserve text, cursor and cache invalidation", t => {
  const { root } = fixture(t), state = new WorkspaceState(root);
  state.rebuild(); state.openSelected(); state.selected = 1; state.openSelected();
  state.buffer = new TextBuffer('const answer = "hello";');
  state.buffer.cursor = 8;
  const { editor } = makeEditor(state);
  const frame = editor.render(100).join("\n");
  assert.match(frame, /\x1b\[/);
  assert.match(stripTerminalSequences(frame), /const answer = "hello";/);
  assert.match(frame, /📁/);
  assert.match(frame, /📄/);
  assert.equal(frame.split(CURSOR_MARKER).length - 1, 1);
  assert.match(frame, /38;2;86;156;214/); // VS Code keyword blue
  state.buffer = new TextBuffer('const changed = 42;');
  editor.invalidate();
  assert.match(stripTerminalSequences(editor.render(100).join("\n")), /const changed = 42;/);
});
test("mouse opens a folder/file and a chat click does not submit or discard", t => {
  const { root } = fixture(t), state = new WorkspaceState(root);
  state.rebuild();
  const { editor } = makeEditor(state);
  editor.render(100);
  const event = { type: "press", button: "left", x: 3, y: 1, screenX: 3, screenY: 1, width: 100, height: 22, ctrl: false, alt: false, shift: false };
  editor.handleMouse(event); assert.equal(state.rows.length, 2);
  editor.handleMouse({ ...event, y: 2 }); assert.equal(state.pane, "file");
  editor.handleInput("change"); assert.ok(state.dirty);
  editor.handleMouse({ ...event, x: 50, y: 19 });
  assert.equal(state.pane, "chat");
  assert.ok(state.dirty);
});

test("live refresh preserves selection and dirty buffers while marking exact changed paths", t => {
  const { root, path } = fixture(t), state = new WorkspaceState(root);
  state.rebuild(); state.openSelected(); state.selected = 1; state.openSelected();
  state.poll(join(root, "project"));
  state.buffer.insert("my draft ");
  writeFileSync(path, "external edit");
  writeFileSync(join(root, "project/a.ts"), "new");
  const events = state.poll(join(root, "project"));
  assert.ok(events.some(e => e.path === path));
  assert.equal(state.rows[state.selected].path, path);
  assert.ok(state.buffer.text.startsWith("my draft "));
  assert.match(state.message, /concept behouden/);
  assert.equal(state.changes.marker(path), "~");
});

test("changed files open in read-only new-above-old diff; F4 returns to editable code", t => {
  const { root, path } = fixture(t), state = new WorkspaceState(root);
  state.rebuild(); state.openSelected();
  state.poll(join(root, "project"));
  writeFileSync(path, "const newValue = 2;");
  state.poll(join(root, "project"));
  state.selected = state.rows.findIndex(row => row.path === path);
  state.openSelected();
  const { editor } = makeEditor(state);
  let frame = editor.render(100).join("\n");
  assert.match(frame, /DIFF/);
  assert.ok(frame.indexOf("\x1b[32m") < frame.indexOf("\x1b[31m"));
  assert.match(stripTerminalSequences(frame), /const newValue = 2/);
  editor.handleInput("do not insert");
  assert.equal(state.dirty, false);
  for (const width of [32, 60, 100]) assert.ok(editor.render(width).every(line => visibleWidth(line) <= width));
  editor.handleInput("\x1bOS"); // F4
  assert.equal(state.reviewPath, undefined);
  editor.handleInput("edit ");
  assert.ok(state.dirty);
});

test("hover requests a pointer without moving keyboard focus or opening a file", t => {
  const { root } = fixture(t), state = new WorkspaceState(root);
  state.rebuild();
  const { editor, tui } = makeEditor(state);
  const writes = [];
  tui.terminal.write = text => writes.push(text);
  editor.render(100);
  const move = { type: "move", button: "none", x: 3, y: 1, screenX: 3, screenY: 1, width: 100, height: 22, ctrl: false, alt: false, shift: false };
  const result = editor.handleMouse(move);
  assert.equal(state.pane, "chat");
  assert.equal(state.rows.length, 1);
  assert.equal(state.hoveredPath, state.rows[0].path);
  assert.equal(result.render, true);
  assert.equal(writes.at(-1), "\x1b]22;pointer\x1b\\");
  editor.handleMouse({ ...move, x: 80 });
  assert.equal(state.hoveredPath, undefined);
  assert.equal(writes.at(-1), "\x1b]22;default\x1b\\");
});
