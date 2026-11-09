import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { mkdtemp, mkdir, writeFile, rm, symlink, link, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventory, declaredTools, parseAdditions } from "../.pi/lib/pi-inventory.mjs";

async function fixture(fn) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-inventory-test-")));
  const put = async (file, content) => {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  };
  const setup = async (name, prefix = "") => {
    const path = name + (prefix ? "/" + prefix : "");
    await mkdir(join(root, path, ".pi/skills"), { recursive: true });
    await mkdir(join(root, path, ".pi/extensions"), { recursive: true });
    await put(path + "/.pi/mcp.json", JSON.stringify({ mcpServers: {} }));
  };
  try { await fn({ root, put, setup }); } finally { await rm(root, { recursive: true, force: true }); }
}
const noHistory = async () => "";
const skill = name => `---\nname: ${name}\ndescription: private-description\n---\nprivate-body`;
const extension = name => `throw new Error("fixture-must-not-run"); export default pi => pi.registerTool(defineTool({ name: "${name}", execute() {} }));`;

await test("defaults compare both projects and prefer upgrade workspace over upstream .pi", () => fixture(async ({ root, put, setup }) => {
  await setup("oomagent-pi");
  await setup("oomagent-pi-upgrade");
  await setup("oomagent-pi-upgrade", "workspace");
  await put("oomagent-pi/.pi/skills/review/SKILL.md", skill("review"));
  await put("oomagent-pi-upgrade/.pi/skills/upstream/SKILL.md", skill("upstream"));
  await put("oomagent-pi-upgrade/workspace/.pi/skills/debug/SKILL.md", skill("debug"));
  await put("oomagent-pi/.pi/extensions/one.ts", extension("own_tool"));
  await put("oomagent-pi-upgrade/workspace/.pi/extensions/two.ts", extension("other_tool"));
  const report = await inventory({ root }, noHistory);
  assert.deepEqual(report.comparison.skills.onlyFirst, ["review"]);
  assert.deepEqual(report.comparison.skills.onlySecond, ["debug"]);
  assert.deepEqual(report.comparison.declaredTools.onlyFirst, ["own_tool"]);
  assert.deepEqual(report.comparison.declaredTools.onlySecond, ["other_tool"]);
  assert.equal(report.projects[1].configRoot, join(root, "oomagent-pi-upgrade/workspace"));
  assert.equal(report.days, 14);
  assert.doesNotMatch(JSON.stringify(report), /private-description|private-body|fixture-must-not-run|upstream/);
}));

await test("MCP output allowlists only names/enabled and compares enabled differences", () => fixture(async ({ root, put, setup }) => {
  for (const name of ["first", "second"]) await setup(name);
  await put("first/.pi/mcp.json", JSON.stringify({ mcpServers: { browser: { enabled: false, env: { TOKEN: "private-value" }, command: "private-command", args: ["private-argument"], url: "https://private-host", headers: { Authorization: "private-auth" } } } }));
  await put("second/.pi/mcp.json", JSON.stringify({ mcpServers: { browser: {}, other: { enabled: true } } }));
  const report = await inventory({ root, projects: ["first", "second"] }, noHistory);
  assert.deepEqual(report.projects[0].mcpServers, [{ name: "browser", enabled: false }]);
  assert.deepEqual(report.comparison.mcpEnabledDifferences, [{ name: "browser", firstEnabled: false, secondEnabled: true }]);
  assert.deepEqual(report.comparison.mcpServers.onlySecond, ["other"]);
  assert.doesNotMatch(JSON.stringify(report), /private-value|private-command|private-argument|private-host|private-auth/);
}));

await test("declared tools support direct/wrapped literals and index entries; never execute code", () => fixture(async ({ root, put, setup }) => {
  await setup("first");
  await put("first/.pi/extensions/nested/index.js", 'pi.registerTool({ name: "direct" });');
  await put("first/.pi/extensions/a.ts", extension("wrapped") + extension("wrapped"));
  const report = await inventory({ root, projects: ["first"] }, noHistory);
  assert.deepEqual(report.projects[0].extensions.flatMap(item => item.declaredTools).sort(), ["direct", "wrapped"]);
  assert.deepEqual(declaredTools('pi.registerTool(variable); const name = "ignored";'), []);
  assert.equal(report.comparison, null);
}));

await test("invalid input rejected before reads or Git", async () => {
  let calls = 0;
  const reader = async () => { calls++; return ""; };
  for (const projects of [[], ["a", "b", "c"], ["../a"], ["/tmp/a"], [".env"], [".."], ["a/b"], ["a\\b"], ["a", "a"], ["a\0b"]]) {
    await assert.rejects(inventory({ root: "/missing", projects }, reader), /choose one or two/);
  }
  for (const days of [0, 366, 1.5, "14", NaN]) await assert.rejects(inventory({ root: "/missing", days }, reader), /days must/);
  assert.equal(calls, 0);
});

await test("missing project/config gives partial result, not false comparison", () => fixture(async ({ root, setup }) => {
  await setup("first");
  const report = await inventory({ root, projects: ["first", "missing"] }, noHistory);
  assert.equal(report.projects[0].available, true);
  assert.equal(report.projects[1].available, false);
  assert.equal(report.comparison, null);
}));

await test("symlink project, .pi, skill and MCP files are not followed", () => fixture(async ({ root, put, setup }) => {
  await setup("source");
  await put("source/.pi/skills/private/SKILL.md", skill("private"));
  await symlink(join(root, "source"), join(root, "alias"));
  const blocked = await inventory({ root, projects: ["alias"] }, noHistory);
  assert.equal(blocked.projects[0].available, false);
  await setup("first");
  await symlink(join(root, "source/.pi/skills/private"), join(root, "first/.pi/skills/link"));
  await symlink(join(root, "source/.pi/mcp.json"), join(root, "first/.pi/extensions/linked.ts"));
  const report = await inventory({ root, projects: ["first"] }, noHistory);
  assert.deepEqual(report.projects[0].skills, []);
  assert.deepEqual(report.projects[0].extensions, []);
  assert.ok(report.projects[0].warnings.length);
  await mkdir(join(root, "second"));
  await symlink(join(root, "source/.pi"), join(root, "second/.pi"));
  assert.equal((await inventory({ root, projects: ["second"] }, noHistory)).projects[0].available, false);
}));

await test("symlink MCP configuration and hardlinked extension rejected without values", () => fixture(async ({ root, put }) => {
  await mkdir(join(root, "first/.pi/extensions"), { recursive: true });
  await put("sensitive.txt", "private-sensitive-value");
  await symlink(join(root, "sensitive.txt"), join(root, "first/.pi/mcp.json"));
  await link(join(root, "sensitive.txt"), join(root, "first/.pi/extensions/leak.ts"));
  const report = await inventory({ root, projects: ["first"] }, noHistory);
  assert.deepEqual(report.projects[0].mcpServers, []);
  assert.deepEqual(report.projects[0].extensions, []);
  assert.doesNotMatch(JSON.stringify(report), /private-sensitive-value/);
}));

await test("oversized files, invalid UTF-8 and invalid frontmatter omitted", () => fixture(async ({ root, put, setup }) => {
  await setup("first");
  await put("first/.pi/extensions/large.ts", "x".repeat(1024 * 1024 + 1));
  await put("first/.pi/extensions/invalid.ts", Buffer.from([0xff]));
  await put("first/.pi/skills/no-name/SKILL.md", "# no frontmatter");
  await put("first/.pi/skills/crlf/SKILL.md", skill("valid").replaceAll("\n", "\r\n"));
  const report = await inventory({ root, projects: ["first"] }, noHistory);
  assert.deepEqual(report.projects[0].extensions, []);
  assert.deepEqual(report.projects[0].skills.map(item => item.name), ["valid"]);
  assert.ok(report.projects[0].warnings.length >= 2);
}));

await test("malformed MCP never echoes input or error text", () => fixture(async ({ root, put, setup }) => {
  await setup("first");
  for (const raw of ["private-json", "null", '{"mcpServers":[]}', '{"mcpServers":{"invalid":null}}']) {
    await put("first/.pi/mcp.json", raw);
    const report = await inventory({ root, projects: ["first"] }, noHistory);
    assert.deepEqual(report.projects[0].mcpServers, []);
    assert.ok(report.projects[0].warnings.length);
    assert.doesNotMatch(JSON.stringify(report), /private-json/);
  }
}));

await test("history parser keeps relevant added paths only with dates, caps records", () => {
  const commit = "\x1eabcdef1\0" + "2026-11-04T11:26:38+01:00\0\0\n";
  const parsed = parseAdditions(commit + ".pi/extensions/new.ts\0.pi/skills/new/SKILL.md\0.pi/skills/new/assets/private.txt\0.env\0");
  assert.equal(parsed.addedFiles.length, 2);
  assert.equal(parsed.addedFiles[0].date, "2026-11-04T11:26:38+01:00");
  assert.equal(parsed.truncated, false);
  assert.equal(parseAdditions((commit + ".pi/extensions/new.ts\0").repeat(101)).truncated, true);
  assert.equal(parseAdditions("private-unexpected-output").addedFiles.length, 0);
});

await test("history reader uses config root and requested period; errors stay generic", () => fixture(async ({ root, setup }) => {
  await setup("first", "workspace");
  const calls = [];
  const report = await inventory({ root, projects: ["first"], days: 30 }, async (...args) => {
    calls.push(args);
    throw new Error("private-stderr");
  });
  assert.equal(calls[0][0], join(root, "first/workspace"));
  assert.equal(calls[0][1], 30);
  assert.equal(report.projects[0].history.available, false);
  assert.doesNotMatch(JSON.stringify(report), /private-stderr/);
}));

await test("no repository is handled by actual read-only Git subprocess", () => fixture(async ({ root, setup }) => {
  await setup("first");
  const report = await inventory({ root, projects: ["first"] });
  assert.equal(report.projects[0].history.available, false);
}));

await test("cancellation before inventory and during history fails without reason leakage", () => fixture(async ({ root, setup }) => {
  const before = new AbortController();
  before.abort(new Error("private-abort"));
  await assert.rejects(inventory({ root, signal: before.signal }), /request cancelled/);
  await setup("first");
  const during = new AbortController();
  await assert.rejects(inventory({ root, projects: ["first"], signal: during.signal }, async () => {
    during.abort(new Error("private-abort"));
    return "";
  }), /request cancelled/);
}));

await test("directory bounds and duplicate tool comparison are explicit", () => fixture(async ({ root, put, setup }) => {
  await setup("first");
  await setup("second");
  for (let i = 0; i < 101; i++) await put(`first/.pi/extensions/tool-${String(i).padStart(3, "0")}.ts`, extension("shared"));
  await put("second/.pi/extensions/tool.ts", extension("shared"));
  const report = await inventory({ root, projects: ["first", "second"] }, noHistory);
  assert.equal(report.projects[0].extensions.length, 100);
  assert.equal(report.comparison.partial, true);
  assert.deepEqual(report.comparison.declaredTools.shared, ["shared"]);
}));

await test("Projects root symlink is rejected", () => fixture(async ({ root }) => {
  await mkdir(join(root, "real"));
  await symlink(join(root, "real"), join(root, "alias"));
  await assert.rejects(inventory({ root: join(root, "alias") }, noHistory), /Projects directory unavailable or unsafe/);
}));

await test("package manifest exposes pi_inventory without removing ci_status", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(manifest.pi.extensions.includes("./.pi/extensions/pi-inventory.ts"));
  assert.ok(manifest.pi.extensions.includes("./.pi/extensions/ci-status.ts"));
});

const deps = {};
globalThis.__inventoryExtensionTest = deps;
const source = (await readFile(new URL("../.pi/extensions/pi-inventory.ts", import.meta.url), "utf8")).replace(/^import .*;\n/gm, "");
const prelude = `
const deps = globalThis.__inventoryExtensionTest;
const homedir = () => "/home/test";
const join = (...parts) => parts.join("/");
const Type = Object.fromEntries(["Object", "String", "Optional", "Integer", "Array"].map(name => [name, value => value]));
const defineTool = value => value;
const inventory = (...args) => deps.inventory(...args);
const truncateHead = (...args) => deps.truncate(...args);
`;
const wrapper = await import(`data:text/javascript;base64,${Buffer.from(prelude + stripTypeScriptTypes(source)).toString("base64")}`);
delete globalThis.__inventoryExtensionTest;
let tool;
wrapper.default({
  registerTool(value) { tool = value; },
  getAllTools: () => [{ name: "registered_only" }, { name: "active_tool" }, { name: "unsafe\nname" }],
  getActiveTools: () => ["active_tool"],
});
const execute = (params = {}, signal) => tool.execute("test", params, signal, undefined, { cwd: "/current-session" });

await test("registered wrapper separates live session metadata from project configuration", async () => {
  let input;
  deps.inventory = async args => { input = args; return { projects: [{ project: "configured-only" }] }; };
  deps.truncate = (content, options) => {
    assert.deepEqual(options, { maxBytes: 40000, maxLines: 1500 });
    return { content, truncated: false };
  };
  const result = await execute({ days: 30 });
  const report = JSON.parse(result.content[0].text);
  assert.equal(input.root, "/home/test/Projects");
  assert.equal(input.days, 30);
  assert.ok(input.signal instanceof AbortSignal);
  assert.deepEqual(report.currentSession.registeredTools, ["active_tool", "registered_only"]);
  assert.deepEqual(report.currentSession.activeTools, ["active_tool"]);
  assert.equal(report.currentSession.operationalTests, "not performed");
  assert.equal(report.currentSession.cwd, "/current-session");
  assert.equal(tool.annotations.openWorldHint, false);
});

await test("wrapper marks output truncation and does not return unbounded details", async () => {
  deps.inventory = async () => ({ projects: [{ project: "first" }], large: "x".repeat(50000) });
  deps.truncate = () => ({ content: "bounded", truncated: true });
  const result = await execute();
  assert.match(result.content[0].text, /Inventory truncated/);
  assert.deepEqual(result.details, { projectCount: 1, truncated: true });
});

await test("wrapper passes cancellation into inventory and propagates failures", async () => {
  const controller = new AbortController();
  controller.abort();
  deps.inventory = async args => {
    assert.equal(args.signal.aborted, true);
    throw new Error("pi_inventory: request cancelled or timed out.");
  };
  await assert.rejects(execute({}, controller.signal), /request cancelled/);
});

