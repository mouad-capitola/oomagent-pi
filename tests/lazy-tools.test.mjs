import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use the installed Pi SDK, not a replacement loader/ranker or provider call.
// PI_TEST_HOST optionally points at a global pi-coding-agent package directory.
const hostUrl = process.env.PI_TEST_HOST
  ? pathToFileURL(join(process.env.PI_TEST_HOST, "dist/index.js")).href
  : import.meta.resolve("@earendil-works/pi-coding-agent");
const host = await import(hostUrl);
const extensionDir = new URL("../.pi/extensions/", import.meta.url);
const extensionNames = [
  "lazy-tools", "ci-status", "directory-reader", "document-reader", "file-reader",
  "file-tools", "git-log", "git-status", "oomagent-tools", "pi-inventory",
  "test-runner", "text-search", "web-reader", "web-search",
];
const builtinNames = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const customNames = [
  "ci_status", "directory_reader", "document_reader", "file_reader", "file_writer",
  "file_editor", "git_log", "git_status", "project_info", "pi_inventory", "test_runner",
  "text_search", "web_reader", "web_summarizer", "web_search",
];
const deferredNames = [...builtinNames, ...customNames];

async function fixture(t, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-lazy-tools-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await mkdir(cwd);
  await mkdir(agentDir);
  t.after(() => rm(root, { recursive: true, force: true }));
  let api;
  const settingsManager = host.SettingsManager.inMemory({
    defaultTools: ["tool_search"], cacheWarming: "off",
    compaction: { enabled: false }, retry: { enabled: false },
    ...settings,
  });
  const resourceLoader = new host.DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true,
    noThemes: true, noContextFiles: true,
    additionalExtensionPaths: extensionNames.map(name => fileURLToPath(new URL(`${name}.ts`, extensionDir))),
    extensionFactories: [host.createToolSearchExtension(), pi => { api = pi; }],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const modelRuntime = await host.ModelRuntime.create({
    authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"),
  });
  const { session } = await host.createAgentSession({
    cwd, agentDir, modelRuntime, settingsManager, resourceLoader,
    sessionManager: host.SessionManager.inMemory(cwd),
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  const call = (name, params, signal) => {
    const tool = session.agent.state.tools.find(tool => tool.name === name);
    assert.ok(tool, `${name} must be declared before invocation`);
    return tool.execute(`test-${name}`, params, signal);
  };
  const load = query => call("tool_search", { query, limit: 1 });
  return { api, session, cwd, call, load, resourceLoader };
}

test("fresh session declares only discovery; all 22 configured tools remain searchable", async t => {
  const { api, session } = await fixture(t);
  assert.deepEqual(session.getActiveToolNames(), ["tool_search"]);
  assert.deepEqual(session.agent.state.tools.map(tool => tool.name), ["tool_search"]);
  const all = api.getAllTools();
  for (const name of deferredNames) {
    assert.equal(all.find(tool => tool.name === name)?.exposure, "deferred", name);
  }
  const searchDeclaration = JSON.stringify(session.agent.state.tools);
  for (const name of deferredNames) assert.ok(!searchDeclaration.includes(`"name":"${name}"`), name);
  assert.ok(!session.systemPrompt.includes("Use edit for targeted changes"));
  assert.match(session.systemPrompt, /tool_search/);
});

test("native discovery loads each exact match without losing previous tools or executing them", async t => {
  const { session, load } = await fixture(t);
  const expected = ["tool_search"];
  for (const name of deferredNames) {
    assert.deepEqual((await load(name)).details.loaded, [name]);
    expected.push(name);
    assert.deepEqual(new Set(session.getActiveToolNames()), new Set(expected));
    assert.ok(session.agent.state.tools.some(tool => tool.name === name));
  }
  assert.match(session.systemPrompt, /Use read to examine files instead of cat or sed/);
  assert.match(session.systemPrompt, /Use edit for targeted changes/);
  assert.match(session.systemPrompt, /Use write only for new files or complete rewrites/);
});

test("unknown queries and invalid searches leave the loadout alone", async t => {
  const { session, load, call } = await fixture(t);
  assert.deepEqual((await load("zzzznonexistentzzzz")).details.loaded, []);
  await assert.rejects(call("tool_search", { query: "", limit: 1 }), /must not be empty/);
  await assert.rejects(call("tool_search", { query: "read", limit: 0 }), /positive integer/);
  assert.deepEqual(session.getActiveToolNames(), ["tool_search"]);
});

test("lazy builtins preserve schemas, prompt rules, renderers and argument preparation", async t => {
  const { api, load, session, resourceLoader } = await fixture(t);
  const factories = [
    host.createReadToolDefinition, host.createBashToolDefinition, host.createEditToolDefinition,
    host.createWriteToolDefinition, host.createGrepToolDefinition,
    host.createFindToolDefinition, host.createLsToolDefinition,
  ];
  for (const factory of factories) {
    const original = factory(process.cwd());
    const registered = api.getAllTools().find(tool => tool.name === original.name);
    assert.deepEqual(registered.parameters, original.parameters);
    assert.equal(registered.description, original.description);
    assert.deepEqual(registered.promptGuidelines ?? [], original.promptGuidelines ?? []);
    await load(original.name);
    assert.ok(session.agent.state.tools.some(tool => tool.name === original.name));
  }
  // The extension spreads the full native definition instead of reimplementing
  // validation, rendering or execution; assert its registered definitions too.
  const extension = resourceLoader.getExtensions().extensions.find(item => item.tools.has("read"));
  assert.ok(extension);
  for (const registered of extension.tools.values()) {
    const tool = registered.definition;
    const original = factories.map(factory => factory(process.cwd())).find(item => item.name === tool.name);
    for (const key of ["renderCall", "renderResult", "renderShell", "prepareArguments", "constrainedSampling", "outputSchema"]) {
      // Shell renderer factories return fresh closures on every call.
      if (typeof original[key] === "function") {
        assert.equal(typeof tool[key], "function", `${tool.name}.${key}`);
        assert.equal(tool[key].toString(), original[key].toString(), `${tool.name}.${key}`);
      } else {
        assert.deepEqual(tool[key], original[key], `${tool.name}.${key}`);
      }
    }
  }
});

test("discovered native file tools operate in the session directory and retain errors/cancellation", async t => {
  const { cwd, call, load } = await fixture(t);
  for (const name of ["write", "read", "edit", "ls"]) await load(name);
  await call("write", { path: "sample.txt", content: "before\n" });
  assert.equal(await readFile(join(cwd, "sample.txt"), "utf8"), "before\n");
  assert.match((await call("read", { path: "sample.txt" })).content[0].text, /before/);
  await call("edit", { path: "sample.txt", edits: [{ oldText: "before", newText: "after" }] });
  assert.equal(await readFile(join(cwd, "sample.txt"), "utf8"), "after\n");
  assert.match((await call("ls", {})).content[0].text, /sample\.txt/);
  await assert.rejects(call("edit", { path: "sample.txt", edits: [{ oldText: "missing", newText: "wrong" }] }));
  assert.equal(await readFile(join(cwd, "sample.txt"), "utf8"), "after\n");
  await assert.rejects(call("read", { path: "sample.txt" }, AbortSignal.abort()), /abort/i);
  await load("file_reader");
  await writeFile(join(cwd, "data.csv"), "name\nAda\n");
  assert.deepEqual((await call("file_reader", { file_path: "data.csv" })).details.rows, [{ name: "Ada" }]);
});

test("lazy bash preserves the user's shell prefix and explicit shell executable", async t => {
  const { call, load } = await fixture(t, { shellCommandPrefix: "export PI_LAZY_TEST=prefix-preserved" });
  await load("bash");
  assert.match((await call("bash", { command: 'printf "%s" "$PI_LAZY_TEST"' })).content[0].text, /prefix-preserved/);
  const isolated = await fixture(t, { shellPath: join(tmpdir(), "pi-lazy-nonexistent-shell") });
  await isolated.load("bash");
  await assert.rejects(isolated.call("bash", { command: "echo should-not-run" }));
});

test("repository settings and package entry keep discovery available without MCP", async () => {
  const settings = JSON.parse(await readFile(new URL("../.pi/settings.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(settings.defaultTools, ["tool_search"]);
  assert.ok(!settings.extensions.includes("-builtin:tool-search"));
  assert.ok(settings.extensions.includes("-builtin:codemode"));
  assert.ok(pkg.pi.extensions.includes("./.pi/extensions/lazy-tools.ts"));
});
