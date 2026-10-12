import assert from "node:assert/strict";
import { test } from "node:test";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { CodemodeFrame, frameCodemode } from "../.pi/lib/codemode-frame.ts";

const theme = { style: (text, options) => {
  assert.deepEqual(options.fg, { kind: "rgb", r: 179, g: 136, b: 255 });
  return `\x1b[38;2;179;136;255m${text}\x1b[0m`;
} };
const plain = text => text.replace(/\x1b\[[0-9;]*m/g, "");

test("codemode has a closed purple square frame and wraps text without loss", () => {
  const frame = new CodemodeFrame(theme);
  const content = "text 日本語 e\u0301 " .repeat(30);
  frame.call = new Text(content, 0, 0);
  frame.result = new Text("result " + "x".repeat(200), 0, 0);
  for (const width of [0, 1, 4, 8, 20, 80, 160, 240]) {
    const lines = frame.render(width);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    if (width <= 4) continue;
    assert.match(plain(lines[0]), /^┏.*┓$/);
    assert.match(plain(lines.at(-1)), /^┗━+┛$/);
    assert.ok(lines.every(line => visibleWidth(line) === width));
    assert.ok(lines.slice(1, -1).every(line => /^┃ .* ┃$/.test(plain(line))));
    const body = lines.slice(1, -1).map(line => plain(line).slice(2, -2)).join("").replace(/\s/g, "");
    assert.equal(body, (content + "result " + "x".repeat(200)).replace(/\s/g, ""));
  }
});

test("renderer delegates streaming, error, expansion and previous components into one frame", () => {
  const inputs = [];
  const renderers = frameCodemode({
    renderCall(args, _theme, ctx) {
      const component = ctx.lastComponent ?? new Text("", 0, 0);
      component.setText(args.code);
      return component;
    },
    renderResult(result, options, _theme, ctx) {
      inputs.push({ result, options, ctx });
      const component = ctx.lastComponent ?? new Text("", 0, 0);
      component.setText(options.isPartial ? "running" : result.content[0].text);
      return component;
    },
  });
  assert.equal(renderers.renderShell, "self");
  const ctx = { state: {}, isError: false };
  const frame = renderers.renderCall({ code: "text('hello')" }, theme, ctx);
  for (const options of [{ isPartial: true, expanded: false }, { isPartial: false, expanded: true }]) {
    const result = { content: [{ type: "text", text: "done" }], details: { preserved: true } };
    const previous = frame.result;
    const slot = renderers.renderResult(result, options, theme, ctx);
    assert.deepEqual(slot.render(80), [], "result lives inside call frame, not outside its bottom border");
    assert.equal(inputs.at(-1).result, result);
    assert.equal(inputs.at(-1).options, options);
    assert.equal(inputs.at(-1).ctx.lastComponent, previous);
    assert.match(plain(frame.render(80).join("\n")), options.isPartial ? /running/ : /done/);
  }
  ctx.isError = true;
  renderers.renderResult({ content: [{ type: "text", text: "failure" }] }, { isPartial: false, expanded: false }, theme, ctx);
  assert.equal(inputs.at(-1).ctx.isError, true);
  assert.match(plain(frame.render(80).join("\n")), /failure/);
  const other = renderers.renderCall({ code: "second call" }, theme, { state: {} });
  assert.notEqual(other, frame, "concurrent calls have separate frame state");
  assert.doesNotMatch(plain(other.render(80).join("\n")), /failure/);
  frame.invalidate();
});
