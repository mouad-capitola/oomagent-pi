import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extensionUrl = new URL("../.pi/extensions/oomagent-context.ts", import.meta.url);
const source = await readFile(extensionUrl, "utf8");
const { default: register, isCasualMessage, branchHasTask, isLocalProjectRule } =
  await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const hostRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const { normalizeBuildSystemPromptOptions, buildSystemPrompt, diffSystemPromptSections, buildSystemPromptSections } =
  await import(pathToFileURL(join(hostRoot, "core/system-prompt.js")).href);

const cwd = resolve(fileURLToPath(new URL("../", import.meta.url)));
const projectFile = { path: join(cwd, "AGENTS.md"), content: await readFile(new URL("../AGENTS.md", import.meta.url), "utf8") };
const addendum = await readFile(new URL("../.pi/system-prompt.md", import.meta.url), "utf8");
const globalFile = { path: "/shared-agent/AGENTS.md", content: "Always preserve global instructions." };
const parentFile = { path: join(dirname(cwd), "AGENTS.md"), content: "Always preserve parent instructions." };
const base = {
  cwd, appendSystemPrompt: addendum,
  contextFiles: [globalFile, parentFile, projectFile],
  selectedTools: ["read"], toolSnippets: { read: "Read files" },
};
const user = content => ({ type: "message", message: { role: "user", content } });
const handlers = new Map();
register({ on: (event, handler) => handlers.set(event, handler) });
const run = async (prompt, branch = [], images = undefined) => {
  const event = { prompt, images, systemPromptOptions: normalizeBuildSystemPromptOptions(base) };
  await handlers.get("before_agent_start")(event, { cwd, sessionManager: { getBranch: () => branch } });
  return event.systemPromptOptions;
};

test("only exact casual messages qualify; mixed tasks, attachments and ambiguity retain rules", () => {
  for (const text of ["hi", " HI! ", "Hoi...", "dank je wel", "thanks", "Hello?", "tot ziens"]) {
    assert.equal(isCasualMessage(text), true, text);
  }
  for (const text of ["", "hi, fix de footer", "bedankt, commit dit", "ja", "doe maar", "status", "hi\nrun tests", "hiii"]) {
    assert.equal(isCasualMessage(text), false, text);
  }
  assert.equal(isCasualMessage("hi", true), false);
});

test("local context matching preserves global, ancestor and unrelated configuration", () => {
  for (const path of [join(cwd, "AGENTS.md"), "AGENTS.override.md", "src/CLAUDE.MD"]) {
    assert.equal(isLocalProjectRule(path, cwd), true, path);
  }
  for (const path of [globalFile.path, parentFile.path, join(cwd + "-other", "AGENTS.md"), "README.md", "../AGENTS.md"]) {
    assert.equal(isLocalProjectRule(path, cwd), false, path);
  }
});

test("first greeting actually omits local project content from Pi's rendered prompt", async () => {
  const options = await run("hi");
  const prompt = buildSystemPrompt(options);
  assert.equal(options.contextFiles.length, 2);
  assert.ok(!prompt.includes(projectFile.content));
  assert.ok(!prompt.includes("## Development workflow"));
  assert.ok(prompt.includes(addendum));
  assert.ok(prompt.includes(globalFile.content));
  assert.ok(prompt.includes(parentFile.content));
  assert.match(prompt, /Never reveal secrets/);
  assert.deepEqual(base.contextFiles, [globalFile, parentFile, projectFile], "base resources must not be mutated");
});

test("a real task loads project rules through Pi's structured prompt delta", async () => {
  const greeting = await run("hi");
  const task = await run("Maak de footer overzichtelijker", [user("hi")]);
  const patch = diffSystemPromptSections(buildSystemPromptSections(greeting), buildSystemPromptSections(task));
  assert.ok(patch.project_context.includes(projectFile.content));
  assert.match(buildSystemPrompt(task), /## Development workflow/);
  assert.match(buildSystemPrompt(task), /Explore with Serena/);
  assert.match(buildSystemPrompt(task), /use Lightpanda/);
});

test("task history keeps rules for follow-ups; greeting-only branches remain light", async () => {
  const branch = [user([{ type: "text", text: "hi" }]), user("Fix de bug")];
  assert.equal(branchHasTask(branch), true);
  assert.ok(buildSystemPrompt(await run("thanks", branch)).includes(projectFile.content));
  assert.ok(!buildSystemPrompt(await run("hi", [user("hoi"), user("bedankt")])).includes(projectFile.content));
  assert.ok(buildSystemPrompt(await run("hi", [], [{ type: "image" }])).includes(projectFile.content));
  assert.ok(buildSystemPrompt(await run("hi", [user([{ type: "image" }])])).includes(projectFile.content));
  assert.equal(branchHasTask([user(undefined)]), true, "unknown history is conservative");
  assert.equal(branchHasTask([{ type: "custom" }]), false);
});

test("package loads the context extension and the ten-step workflow remains in project rules", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.pi.extensions.includes("./.pi/extensions/oomagent-context.ts"));
  for (let step = 1; step <= 10; step++) assert.ok(projectFile.content.includes(`\n${step}. `));
});
