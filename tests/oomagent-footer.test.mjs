import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve the host-supplied peer from Pi's dependency tree.
const require = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
const tuiUrl = pathToFileURL(require.resolve("@earendil-works/pi-tui")).href;
const { visibleWidth } = await import(tuiUrl);

const source = (await readFile(new URL("../.pi/extensions/oomagent-ui.ts", import.meta.url), "utf8"))
  .replace(/^import .*pi-coding-agent.*;$/m, "class CustomEditor {}")
  .replace('"@earendil-works/pi-tui"', JSON.stringify(tuiUrl));
const { default: register } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);

await test("footer dynamically renders branch, available tools and status; toggles and disposes", async () => {
  const handlers = new Map();
  const commands = new Map();
  let tools = [
    ...["read", "bash", "edit", "write", "codemode"].map(name => ({ name, exposure: "direct" })),
    { name: "search", exposure: "deferred" },
    { name: "document", exposure: "codemode" },
    { name: "disabled", exposure: "direct" },
    { name: "hidden", exposure: "hidden" },
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
  let branch = "main";
  const colors = new Map();
  const backgrounds = [];
  const ctx = {
    mode: "tui", hasUI: true,
    isIdle: () => idle,
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
    onBranchChange: fn => { branchChanged = fn; return () => disposed++; },
  });
  const footer = makeFooter();
  try {
    assert.deepEqual(footer.render(80).map(line => line.trimEnd()), ["π OomAgent | main | 7 tools | Ready ✓"]);
    for (const width of [0, 1, 10, 40, 120]) {
      assert.equal(footer.render(width).length, 1);
      assert.ok(footer.render(width).every(line => visibleWidth(line) <= width));
    }
    assert.equal(colors.get("π OomAgent"), "success");
    assert.equal(colors.get("7 tools"), "accent");
    assert.equal(colors.get("Ready ✓"), "success");
    assert.ok(backgrounds.every(color => color === "userMessageBg"));

    branch = "feature/日本語";
    branchChanged();
    assert.equal(redraws, 1);
    assert.match(footer.render(80)[0], /feature\/日本語/);
    tools = [...tools, { name: "new-tool", exposure: "deferred" }];
    assert.match(footer.render(80)[0], /8 tools/);
    activeTools = activeTools.filter(name => name !== "bash");
    assert.match(footer.render(80)[0], /7 tools/);
    idle = false;
    assert.match(footer.render(80)[0], /Working…/);
    idle = true;
    branch = undefined;
    assert.match(footer.render(80)[0], /geen branch.*Ready ✓/);
    tools = [];
    assert.match(footer.render(80)[0], /0 tools/);
    ctx.ui.theme = { fg: (_color, text) => `\x1b[32m${text}\x1b[0m`, bg: (_color, text) => text };
    for (const width of [0, 1, 10, 40, 80]) assert.ok(visibleWidth(footer.render(width)[0]) <= width);
  } finally {
    footer.dispose();
    footer.dispose();
  }
  assert.equal(disposed, 1);
  await commands.get("oom-footer").handler("", ctx);
  assert.equal(factory, undefined);
  await commands.get("oom-footer").handler("", ctx);
  assert.equal(typeof factory, "function");
  makeFooter().dispose();
  handlers.get("session_shutdown")();
});

await test("non-terminal sessions do not install a footer", () => {
  const handlers = new Map();
  register({ on: (name, fn) => handlers.set(name, fn), registerCommand() {}, registerMarkdownTransformer() {} });
  for (const mode of ["rpc", "print", "json"]) {
    handlers.get("session_start")({}, { mode, hasUI: true, ui: { setFooter() { assert.fail("terminal-only"); } } });
  }
});
