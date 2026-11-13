import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

// Set PI_TEST_RUNTIME_DIST to test the installed Pi runtime instead of the older
// project peer. No session authentication, tool execution, or provider calls.
test("native Pi renders message borders and a single closed codemode frame", async t => {
  const root = process.env.PI_TEST_RUNTIME_DIST ?? dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  const load = path => import(pathToFileURL(join(root, path)).href);
  const hostRequire = createRequire(join(root, "../package.json"));
  const { visibleWidth } = await import(pathToFileURL(hostRequire.resolve("@earendil-works/pi-tui")).href);
  const { loadExtensions } = await load("core/extensions/loader.js");
  const themes = await load("modes/interactive/theme/theme.js");
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const result = await loadExtensions([join(cwd, ".pi/extensions/oomagent-ui.ts")], cwd);
  assert.equal(result.errors.length, 0);
  const ext = result.extensions[0];
  // This renderer-only harness dispatches session_start without AgentSession.
  // Bind the settings read that Pi normally initializes before that event.
  result.runtime.getSettings = () => ({ quietStartup: false });
  if (!ext.toolRenderers?.length) { t.skip("Tool renderer composition requires Pi 1.0.4; set PI_TEST_RUNTIME_DIST"); return; }
  const { ToolExecutionComponent } = await load("modes/interactive/components/tool-execution.js");
  const { UserMessageComponent } = await load("modes/interactive/components/user-message.js");
  const { AssistantMessageComponent } = await load("modes/interactive/components/assistant-message.js");
  const { codemodeRenderers } = await load("extensions/codemode/renderer.js");
  themes.setThemeInstance(themes.loadThemeFromPath(join(cwd, ".pi/themes/oomagent-swiss.json"), "truecolor"));
  const ui = { theme: themes.theme, setFooter() {}, setHeader() {}, setEditorComponent() {}, setWidget() {}, setTitle() {}, setTheme: () => ({ success: true }) };
  try {
    for (const fn of ext.handlers.get("session_start")) await fn({}, { mode: "tui", hasUI: true, ui, sessionManager: { getEntries: () => [] } });
    const text = "Lange tekst blijft binnen het kader. 日本語 **vet** ".repeat(35) + '\n\n```js\nconst value = "' + "x".repeat(300) + '";\n```';
    const msg = { role: "assistant", content: [{ type: "text", text }], api: "test", provider: "test", model: "test", stopReason: "stop", timestamp: 0 };
    const transformer = ext.markdownTransformer.transformer;
    const user = new UserMessageComponent(text, undefined, 1, [transformer]);
    const assistant = new AssistantMessageComponent(msg, false, undefined, undefined, 1, [transformer]);
    const renders = ext.toolRenderers[0]("codemode", () => codemodeRenderers);
    assert.equal(ext.toolRenderers[0]("bash", () => codemodeRenderers), codemodeRenderers, "other tools unchanged");
    const tool = new ToolExecutionComponent("codemode", "test-id", { code: 'text("' + "日本語 ".repeat(50) + '")' }, { showImages: false }, renders, { requestRender() {} }, cwd);
    const plain = s => s.replace(/\x1b\[[0-9;]*m/g, "");
    for (const width of [40, 80, 120, 200, 280]) {
      for (const component of [user, assistant]) {
        const lines = component.render(width);
        assert.ok(lines.every(line => visibleWidth(line) <= width));
        const top = lines.find(line => plain(line).includes("┏"));
        assert.equal(visibleWidth(plain(top).trim()), width - 2, "message border spans Markdown's inner width");
      }
      for (const partial of [true, false]) for (const expanded of [false, true]) {
        tool.setExpanded(expanded);
        tool.updateResult({ content: [{ type: "text", text: "result " + "x".repeat(300) }], details: { calls: [{ name: "test", args: "{}", status: partial ? "running" : "error" }] }, isError: !partial }, partial);
        const lines = tool.render(width).filter(line => line.length);
        assert.ok(lines.every(line => visibleWidth(line) === width));
        assert.match(plain(lines[0]), /^┏.*codemode.*┓$/);
        assert.match(plain(lines.at(-1)), /^┗━+┛$/);
        assert.ok(lines.slice(1, -1).every(line => /^┃.*┃$/.test(plain(line))));
        assert.ok(lines[0].includes("38;2;179;136;255"));
      }
    }
  } finally {
    for (const fn of ext.handlers.get("session_shutdown")) await fn({}, {});
  }
});
