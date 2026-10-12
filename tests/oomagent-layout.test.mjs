import assert from "node:assert/strict";
import { test } from "node:test";
import { footerPalette } from "../.pi/extensions/oomagent-ui.ts";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Text, visibleWidth, stripTerminalSequences, CURSOR_MARKER } from "@earendil-works/pi-tui";
import { bubbleLines, cleanText, createLayout } from "../prototypes/oomagent-layout/layout.mjs";
import { createPreviewFooter } from "../prototypes/oomagent-layout/footer.mjs";
const { renderLayoutFrame } = await import(new URL("./layout.js", import.meta.resolve("@earendil-works/pi-tui")));
const { loadThemeFromPath } = await import(new URL("./modes/interactive/theme/theme.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
const theme = loadThemeFromPath(fileURLToPath(new URL("../.pi/themes/oomagent-swiss.json", import.meta.url)), "truecolor");
const flat = box => [box, ...box.children.flatMap(flat)];
const make = (options = {}) => createLayout({ theme, footer: new Text("EXISTING FOOTER", 0, 0), redraw() {}, quit() {}, ...options });

test("bubbles align users right and assistant left, including long Unicode text", () => {
  for (const width of [8, 20, 40, 80]) {
    for (const role of ["user", "assistant"]) {
      const lines = bubbleLines({ role, text: "Hallo 日本語 🔧 e\u0301 ".repeat(25) }, width, theme);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
      assert.equal(stripTerminalSequences(lines[0]).indexOf("╭"), role === "user" ? width - visibleWidth(lines[0].trimStart()) : 0);
    }
  }
  assert.equal(cleanText("safe\x1b[2J\x1b]52;c;secret\x07!\u202e"), "safe!");
  assert.equal(cleanText("x".repeat(9000)).length, 8000);
});

test("native layout keeps editor left, CodeMode right, footer full width on resize", () => {
  const layout = make();
  layout.input.focused = true;
  layout.input.setValue("日本語 🔧");
  try {
    for (const width of [12, 40, 79, 80, 120, 200, 280]) {
      for (const height of [12, 24, 50]) {
        layout.resize(width, height);
        const frame = renderLayoutFrame(layout.root, width, height, () => {});
        assert.equal(frame.lines.length, height);
        assert.ok(frame.lines.every(line => visibleWidth(line) <= width), `${width}x${height}`);
        const boxes = flat(frame.root);
        const input = boxes.find(box => box.component === layout.input);
        const chat = boxes.find(box => box.component === layout.chatScroll);
        assert.equal(input.rect.x, chat.rect.x);
        assert.equal(input.rect.width, chat.rect.width);
        assert.ok(input.rect.y >= chat.rect.y + chat.rect.height);
        assert.equal(boxes.find(box => box.component.text === "EXISTING FOOTER")?.rect.width, width);
        if (width >= 80) {
          const code = boxes.find(box => box.component === layout.codeScroll);
          assert.ok(code.rect.x >= input.rect.x + input.rect.width);
          assert.ok(frame.lines.some(line => line.includes(CURSOR_MARKER)));
        }
      }
    }
  } finally { layout.dispose(); }
});

test("narrow mode switches panes without losing the input draft", () => {
  const layout = make();
  try {
    layout.resize(40, 24);
    layout.input.setValue("draft");
    assert.equal(layout.handleShortcut("\t"), true);
    assert.equal(layout.pane, "code");
    const frame = renderLayoutFrame(layout.root, 40, 24, () => {});
    assert.ok(flat(frame.root).some(box => box.component === layout.codeScroll));
    assert.ok(!flat(frame.root).some(box => box.component === layout.input));
    layout.handleShortcut("\t");
    assert.equal(layout.input.getValue(), "draft");
    assert.equal(layout.handleShortcut("\x1b[5~"), true);
    assert.equal(layout.handleShortcut("\x1b[6~"), true);
  } finally { layout.dispose(); }
});

test("demo input is inert, duplicate submission preserves draft, and errors persist", async () => {
  let starts = 0, finishes = 0;
  const layout = make({ onBegin: () => starts++, onFinish: () => finishes++ });
  try {
    layout.submit("/error");
    layout.input.setValue("unfinished draft");
    layout.submit("another request");
    assert.equal(starts, 1);
    assert.equal(layout.input.getValue(), "unfinished draft");
    await new Promise(resolve => setTimeout(resolve, 1100));
    const plain = stripTerminalSequences(renderLayoutFrame(layout.root, 120, 30, () => {}).lines.join("\n"));
    assert.match(plain, /FOUT/);
    assert.match(plain, /gesimuleerd/);
    assert.equal(finishes, 1);
    assert.equal(layout.busy, false);
  } finally { layout.dispose(); layout.dispose(); }
});

test("disposing mid-demo cancels subsequent updates and Ctrl+C requests exit", async () => {
  let updates = 0, exits = 0;
  const layout = make({ redraw: () => updates++, quit: () => exits++ });
  layout.submit("test");
  layout.dispose();
  const before = updates;
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(updates, before);
  assert.equal(layout.busy, false);
  layout.handleShortcut("\x03");
  assert.equal(exits, 1);
});

test("actual footer renderer is reused with zero tools and no quota network access", async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = () => { assert.fail("offline preview must not request quota or models"); };
  let footer;
  try {
    footer = createPreviewFooter(theme, { requestRender() {} }, "/nonexistent-offline-preview");
    const lines = footer.component.render(200);
    const plain = stripTerminalSequences(lines.join("\n"));
    assert.match(plain, /🔧 TOOLS 0/);
    assert.match(plain, /◉ TOKENS 0/);
    assert.match(plain, /OOMAGENT-MOUAD/);
    assert.ok(lines.every(line => visibleWidth(line) === 200));
    footer.begin(); footer.finish();
    await new Promise(resolve => setTimeout(resolve, 30));
  } finally { footer?.dispose(); footer?.dispose(); globalThis.fetch = fetchBefore; }
});

test("preview refuses non-interactive launch instead of corrupting a pipe", () => {
  const result = spawnSync(process.execPath, ["prototypes/oomagent-layout/preview.mjs"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /apart terminalvenster/);
});

test("both paper panels have closed borders, equal widths and centred outer margins", () => {
  const layout = make();
  try {
    for (const [width, height] of [[80, 24], [120, 36], [280, 80], [400, 100]]) {
      layout.resize(width, height);
      const frame = renderLayoutFrame(layout.root, width, height, () => {});
      const boxes = flat(frame.root);
      const left = boxes.find(box => box.component === layout.leftCard).rect;
      const right = boxes.find(box => box.component === layout.rightCard).rect;
      assert.equal(left.width, right.width);
      assert.equal(left.height, right.height);
      assert.ok(left.width <= 168);
      assert.ok(left.height <= 80);
      assert.ok(left.x >= 2 && left.y >= 2);
      assert.ok(Math.abs(left.x - (width - right.x - right.width)) <= 1);
      assert.ok(right.x - left.x - left.width >= 4);
      for (const rect of [left, right]) {
        const rows = frame.lines.slice(rect.y, rect.y + rect.height).map(stripTerminalSequences);
        assert.match(rows[0].slice(rect.x, rect.x + rect.width), /^╭.*╮$/);
        assert.match(rows.at(-1).slice(rect.x, rect.x + rect.width), /^╰─+╯$/);
        for (const row of rows.slice(1, -1)) {
          assert.equal(row[rect.x], "│");
          assert.equal(row[rect.x + rect.width - 1], "│");
        }
      }
      assert.match(frame.lines.join("\n"), /\x1b\[48;2;16;18;20m/);
    }
  } finally { layout.dispose(); }
});

test("short messages use content-sized bubbles instead of filling the paper", () => {
  const user = bubbleLines({ role: "user", text: "Hoi!" }, 80, theme);
  const assistant = bubbleLines({ role: "assistant", text: "Hallo!" }, 80, theme);
  assert.ok(visibleWidth(user[0].trimStart()) < 20);
  assert.equal(visibleWidth(user[0]), 80);
  assert.ok(visibleWidth(assistant[0]) < 20);
  assert.equal(stripTerminalSequences(assistant[0])[0], "╭");
});

test("large panels double the old limits and use exactly the footer token cyan", () => {
  const layout = make();
  try {
    layout.resize(400, 100);
    const frame = renderLayoutFrame(layout.root, 400, 100, () => {});
    const boxes = flat(frame.root);
    for (const card of [layout.leftCard, layout.rightCard]) {
      const box = boxes.find(box => box.component === card);
      assert.equal(box.rect.width, 168);
      assert.equal(box.rect.height, 80);
    }
    assert.deepEqual(footerPalette(theme).cyan, { kind: "rgb", r: 73, g: 211, b: 222 });
    assert.match(frame.lines.join("\n"), /\x1b\[38;2;73;211;222m/);
    assert.doesNotMatch(frame.lines.join("\n"), /48;2;237;241;245|48;2;211;238;220/);
  } finally { layout.dispose(); }
});

test("chat and retained CodeMode history scroll independently with visible scrollbars", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const layout = make();
  try {
    layout.resize(120, 24);
    for (let i = 0; i < 18; i++) {
      layout.submit(`testbericht ${i}`);
      t.mock.timers.tick(900);
    }
    renderLayoutFrame(layout.root, 120, 24, () => {});
    for (const scroll of [layout.chatScroll, layout.codeScroll]) {
      assert.equal(scroll.scrollbar, "always");
      assert.equal(scroll.overscroll, "contain");
      assert.ok(scroll.scrollTop > 0);
    }
    layout.chatScroll.scrollToStart();
    const codeBefore = layout.codeScroll.scrollTop;
    layout.handleShortcut("\x1b[6~");
    assert.ok(layout.chatScroll.scrollTop > 0);
    assert.equal(layout.codeScroll.scrollTop, codeBefore);
    const chatBefore = layout.chatScroll.scrollTop;
    layout.handleShortcut("\t");
    layout.handleShortcut("\x1b[5~");
    assert.ok(layout.codeScroll.scrollTop < codeBefore);
    assert.equal(layout.chatScroll.scrollTop, chatBefore);
  } finally { layout.dispose(); t.mock.timers.reset(); }
});

test("256-colour themes never leak forced truecolour, including nested resets and HUD", () => {
  const theme256 = loadThemeFromPath(fileURLToPath(new URL("../.pi/themes/oomagent-swiss.json", import.meta.url)), "256color");
  const footer = createPreviewFooter(theme256, { requestRender() {} }, "/nonexistent-offline-preview");
  const layout = make({ theme: theme256, footer: footer.component });
  try {
    layout.input.focused = true;
    layout.input.setValue("test");
    const output = renderLayoutFrame(layout.root, 120, 30, () => {}).lines.join("\n");
    assert.match(output, /\x1b\[38;5;\d+m/);
    assert.match(output, /\x1b\[48;5;\d+m/);
    assert.doesNotMatch(output, /\x1b\[(?:38|48);2;/);
    assert.match(output, /█/);
    const expected = theme256.style("", { fg: footerPalette(theme256).cyan }).split("\x1b[39m")[0];
    assert.ok(output.includes(expected));
  } finally { layout.dispose(); footer.dispose(); }
});

test("preview selects Pi's terminal capability detection rather than forced RGB", () => {
  const script = `
    import { getTerminalColorMode } from '@earendil-works/pi-tui';
    console.log(getTerminalColorMode());
  `;
  for (const [termProgram, expected] of [["Apple_Terminal", "256color"], ["iTerm.app", "truecolor"]]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, TERM: "xterm-256color", TERM_PROGRAM: termProgram, PI_IMAGE_PROTOCOL: "none" },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), expected);
  }
});

test("native mouse wheel and scrollbar dragging act on the hovered pane only", async t => {
  const { TuiAltScreen } = await import("@earendil-works/pi-tui");
  const { getScrollbarGeometry } = await import(new URL("./layout.js", import.meta.resolve("@earendil-works/pi-tui")));
  let receive;
  const terminal = {
    columns: 120, rows: 24, kittyProtocolActive: false,
    start(input) { receive = input; }, stop() {}, write() {},
    moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
    setTitle() {}, setProgress() {}, async drainInput() {},
  };
  const tui = new TuiAltScreen(terminal, true, undefined, { mouse: true, copyOnSelect: false });
  const layout = make({ redraw: () => tui.requestRender() });
  t.mock.timers.enable({ apis: ["setInterval"] });
  try {
    layout.resize(120, 24);
    for (let i = 0; i < 18; i++) { layout.submit(`message ${i}`); t.mock.timers.tick(900); }
    tui.setLayoutRoot(layout.root);
    tui.setFocus(layout.input);
    tui.start();
    await new Promise(resolve => setTimeout(resolve, 30));
    const frame = renderLayoutFrame(layout.root, 120, 24, () => {});
    const boxes = flat(frame.root);
    const chat = boxes.find(box => box.component === layout.chatScroll);
    const code = boxes.find(box => box.component === layout.codeScroll);
    const chatBefore = layout.chatScroll.scrollTop;
    const codeBefore = layout.codeScroll.scrollTop;
    const mouse = (button, x, y, suffix = "M") => receive(`\x1b[<${button};${x + 1};${y + 1}${suffix}`);
    mouse(64, chat.rect.x + 2, chat.rect.y + 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(layout.chatScroll.scrollTop < chatBefore);
    assert.equal(layout.codeScroll.scrollTop, codeBefore);
    const chatAfter = layout.chatScroll.scrollTop;
    mouse(64, code.rect.x + 2, code.rect.y + 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(layout.codeScroll.scrollTop < codeBefore);
    assert.equal(layout.chatScroll.scrollTop, chatAfter);
    // Grab the native scrollbar thumb and drag it to the track's start.
    const fresh = renderLayoutFrame(layout.root, 120, 24, () => {});
    const geometry = getScrollbarGeometry(flat(fresh.root).find(box => box.component === layout.codeScroll));
    mouse(0, geometry.column, geometry.thumbTop);
    mouse(32, geometry.column, geometry.trackTop);
    mouse(0, geometry.column, geometry.trackTop, "m");
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(layout.codeScroll.scrollTop, 0);
    assert.equal(layout.chatScroll.scrollTop, chatAfter);
    mouse(64, code.rect.x + 2, code.rect.y + 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(layout.chatScroll.scrollTop, chatAfter, "CodeMode at its top must never spill into chat");
    layout.codeScroll.scrollToEnd(); tui.requestRender();
    await new Promise(resolve => setTimeout(resolve, 20));
    mouse(65, code.rect.x + 2, code.rect.y + 2);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(layout.chatScroll.scrollTop, chatAfter, "CodeMode bottom is contained too");
    mouse(0, code.rect.x + 2, code.rect.y + 2);
    mouse(0, code.rect.x + 2, code.rect.y + 2, "m");
    assert.equal(layout.pane, "code", "click selects the keyboard scrolling pane");
    layout.handleShortcut("\x1b[5~");
    assert.equal(layout.chatScroll.scrollTop, chatAfter);
    const codeAfter = layout.codeScroll.scrollTop;
    layout.chatScroll.scrollToStart(); tui.requestRender();
    await new Promise(resolve => setTimeout(resolve, 20));
    mouse(64, chat.rect.x + 2, chat.rect.y + 2);
    assert.equal(layout.codeScroll.scrollTop, codeAfter, "chat boundary is independent too");
    mouse(64, 0, 0);
    assert.equal(layout.chatScroll.scrollTop, 0, "gutter scrolling is ignored");
    assert.equal(layout.codeScroll.scrollTop, codeAfter);
  } finally { tui.stop(); layout.dispose(); t.mock.timers.reset(); }
});

test("typing and scrolling reuse formatted history across native measurement widths", () => {
  let bubbleStyles = 0;
  const countedTheme = Object.create(theme);
  countedTheme.style = (text, style) => {
    if (text.includes("Welkom!") || text.includes("Mijn berichten")) bubbleStyles++;
    return theme.style(text, style);
  };
  const layout = make({ theme: countedTheme });
  const render = () => renderLayoutFrame(layout.root, 120, 30, () => {});
  try {
    render();
    assert.ok(bubbleStyles > 0);
    bubbleStyles = 0;
    layout.input.handleInput("a");
    render();
    layout.chatScroll.scrollBy(-1);
    render();
    assert.equal(bubbleStyles, 0, "unchanged history must not be restyled on input or scroll");
    assert.equal(layout.input.getValue(), "a");
    layout.root.invalidate();
    render();
    assert.ok(bubbleStyles > 0, "theme invalidation must rebuild styled history");
  } finally { layout.dispose(); }
});

test("pane caches refresh for dimensions, demo steps, errors and history eviction", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const layout = make();
  const chat = layout.chatScroll.child;
  const code = layout.codeScroll.child;
  const plain = component => stripTerminalSequences(component.render(50).join("\n"));
  try {
    const initialChat = chat.render(50);
    const initialCode = code.render(50);
    assert.strictEqual(chat.render(50), initialChat);
    chat.render(60);
    assert.strictEqual(chat.render(50), initialChat, "measurement widths must not evict each other");
    for (const width of [70, 80, 90]) chat.render(width);
    assert.notStrictEqual(chat.render(50), initialChat, "cache retains at most four sizes");
    assert.deepEqual(chat.render(50), initialChat, "eviction does not change rendering");
    layout.resize(120, 50);
    assert.notStrictEqual(chat.render(50), initialChat, "height affects paper padding");
    layout.submit("/error");
    assert.notStrictEqual(code.render(50), initialCode);
    assert.match(plain(code), /voorbeeld gestart/);
    t.mock.timers.tick(450);
    assert.match(plain(code), /Uitvoering bezig/);
    t.mock.timers.tick(450);
    assert.match(plain(code), /FOUT/);
    assert.match(plain(chat), /De fout blijft/);
    for (let i = 0; i < 55; i++) {
      layout.submit("cached-message-" + i);
      t.mock.timers.tick(900);
      chat.render(50); code.render(50);
    }
    assert.doesNotMatch(plain(chat), /cached-message-0\b/);
    assert.match(plain(chat), /cached-message-54/);
    assert.doesNotMatch(plain(code), /FOUT/, "evicted output must not survive in cache");
    const beforeInvalidation = code.render(50);
    layout.root.invalidate();
    assert.notStrictEqual(code.render(50), beforeInvalidation);
    assert.deepEqual(code.render(50), beforeInvalidation, "invalidation preserves output");
  } finally { layout.dispose(); t.mock.timers.reset(); }
});

test("only the input placeholder says Typ je bericht", () => {
  const layout = make();
  try {
    const output = stripTerminalSequences(renderLayoutFrame(layout.root, 120, 30, () => {}).lines.join("\n"));
    assert.equal(output.match(/Typ je bericht/g)?.length, 1);
  } finally { layout.dispose(); }
});

test("preview footer is one bounded row with explicitly unknown weekly usage", () => {
  const footer = createPreviewFooter(theme, { requestRender() {} }, "/nonexistent-offline-preview");
  try {
    for (const width of [0, 1, 40, 80, 120, 200, 400]) {
      const lines = footer.component.render(width);
      assert.equal(lines.length, 1);
      assert.equal(visibleWidth(lines[0]), width);
      if (width >= 80) assert.match(stripTerminalSequences(lines[0]), /ChatGPT week \?%/);
    }
    const wide = stripTerminalSequences(footer.component.render(400)[0]);
    for (const label of ["TOKENS", "TOOLS", "OWN", "THINKING", "CTX", "OOMAGENT-MOUAD"]) assert.ok(wide.includes(label));
  } finally { footer.dispose(); }
});
