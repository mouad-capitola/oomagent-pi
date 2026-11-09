import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { stripVTControlCharacters } from "node:util";
import { readFile } from "node:fs/promises";

// Full registered tool; no network, credentials or real subprocesses.
const deps = { stripVTControlCharacters };
globalThis.__ciStatusTest = deps;
const source = (await readFile(new URL("../.pi/extensions/ci-status.ts", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "")
  .replace("const execFileAsync = promisify(execFile);", "");
const prelude = `
const deps = globalThis.__ciStatusTest;
const stripVTControlCharacters = deps.stripVTControlCharacters;
const Type = Object.fromEntries(["Object", "String", "Optional", "Integer", "Boolean"].map(name => [name, value => value]));
const defineTool = value => value;
const execFileAsync = (...args) => deps.exec(...args);
`;
const module = await import(`data:text/javascript;base64,${Buffer.from(prelude + stripTypeScriptTypes(source)).toString("base64")}`);
delete globalThis.__ciStatusTest;
let tool;
module.default({ registerTool(value) { tool = value; } });
const run = { databaseId: 42, workflowName: "CI", headBranch: "main", status: "completed", conclusion: "failure", createdAt: "2026-11-04" };
const job = { name: "test", conclusion: "failure", steps: [{ name: "Run tests", conclusion: "failure" }] };
function fixture(responses) {
  const calls = [];
  deps.exec = async (...args) => {
    calls.push(args);
    const value = responses.shift();
    if (value instanceof Error) throw value;
    return { stdout: typeof value === "string" ? value : JSON.stringify(value) };
  };
  return calls;
}
const execute = (params = {}, signal) => tool.execute("test", params, signal, undefined, { cwd: "/fixture" });

await test("list resolves origin and pins github.com; read-only bounded subprocess", async () => {
  const calls = fixture(["git@github.com:owner/project.git", [run]]);
  const result = await execute();
  assert.equal(result.details.runs[0].id, 42);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(calls[0].slice(0, 2), ["git", ["config", "--get", "remote.origin.url"]]);
  assert.deepEqual(calls[1][1], ["run", "list", "--limit", "5", "--json", "databaseId,workflowName,headBranch,status,conclusion,createdAt", "--repo", "github.com/owner/project"]);
  assert.equal(calls[1][2].env.GH_HOST, "github.com");
  assert.equal(calls[1][2].env.GH_DEBUG, undefined);
  assert.equal(calls[1][2].timeout, 30000);
  assert.equal(calls[1][2].maxBuffer, 2 * 1024 * 1024);
  assert.ok(calls[1][2].signal instanceof AbortSignal);
  assert.match(result.content[0].text, /Untrusted/);
});

await test("explicit repo skips Git, filters branch safely, accepts empty list and limits", async () => {
  const calls = fixture([[]]);
  assert.deepEqual((await execute({ repo: "owner/project", branch: "--help", limit: 20 })).details.runs, []);
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes("--branch=--help"));
});

await test("invalid input never spawns", async () => {
  const calls = fixture([]);
  for (const params of [
    { repo: "evil.com/owner/project" }, { repo: "owner/.." }, { repo: "-owner/repo" },
    { repo: "owner/repo\n" }, { limit: 0 }, { limit: 21 }, { limit: 1.5 },
    { run_id: 0 }, { run_id: Number.MAX_SAFE_INTEGER + 1 }, { branch: "" },
    { branch: "main\n" }, { run_id: 42, branch: "main" }, { include_logs: "yes" },
  ]) await assert.rejects(execute(params), /ci_status:/);
  assert.equal(calls.length, 0);
});

await test("origin supports HTTPS and SSH but rejects credential URLs and foreign hosts", async () => {
  for (const remote of ["https://github.com/owner/project.git", "ssh://git@github.com/owner/project.git"]) {
    fixture([remote, []]);
    assert.equal((await execute()).details.repo, "owner/project");
  }
  for (const remote of ["https://github.com.evil/owner/repo", "https://user:secret@github.com/owner/repo", "file:///tmp/repo", "https://github.com/owner/repo?token=x"]) {
    const calls = fixture([remote]);
    await assert.rejects(execute(), /origin is not/);
    assert.equal(calls.length, 1);
  }
});

await test("run details include failed jobs, contextual log lines and trusted generated URL", async () => {
  const calls = fixture([{ ...run, jobs: [job], url: "https://evil.invalid" }, "setup\nerror: first failure\nstack detail\nend"]);
  const result = (await execute({ repo: "owner/project", run_id: 42 })).details;
  assert.equal(result.failedJobs[0].steps[0].name, "Run tests");
  assert.match(result.logs.text, /2: error: first failure/);
  assert.equal(result.run.url, "https://github.com/owner/project/actions/runs/42");
  assert.ok(calls[1][1].includes("--log-failed"));
});

await test("successful, pending and logs-disabled runs never request logs", async () => {
  for (const [data, include_logs] of [[{ ...run, conclusion: "success", jobs: [] }, true], [{ ...run, status: "in_progress", jobs: [job] }, true], [{ ...run, jobs: [job] }, false]]) {
    const calls = fixture([data]);
    assert.equal((await execute({ repo: "owner/project", run_id: 42, include_logs })).details.logs, null);
    assert.equal(calls.length, 1);
  }
});

await test("unavailable logs retain status with safe warning", async () => {
  fixture([{ ...run, jobs: [job] }, new Error("private-output")]);
  const result = await execute({ repo: "owner/project", run_id: 42 });
  assert.equal(result.details.run.conclusion, "failure");
  assert.match(result.details.logStatus, /GitHub request failed/);
  assert.ok(!JSON.stringify(result).includes("private-output"));
});

await test("subprocess errors never expose stdout/stderr or exception text", async () => {
  for (const [extra, expected] of [
    [{ code: "ENOENT" }, /unavailable/],
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }, /2 MiB/],
    [{ killed: true }, /timed out/],
    [{ stderr: "HTTP 401 secret" }, /authentication/],
    [{ stderr: "HTTP 429 secret" }, /rate limit/],
    [{ stderr: "HTTP 403 secret" }, /request failed/],
  ]) {
    fixture([Object.assign(new Error("private-output"), extra)]);
    await assert.rejects(execute({ repo: "owner/project" }), error => {
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, /private-output|secret/);
      return true;
    });
  }
});

await test("malformed JSON and response shapes fail without echoing data", async () => {
  for (const data of ["private-output", {}, [null], [{ databaseId: -1, status: "completed" }]]) {
    fixture([data]);
    await assert.rejects(execute({ repo: "owner/project" }), /ci_status: (invalid|unexpected)/);
  }
  fixture([{ ...run, databaseId: 43, jobs: [] }]);
  await assert.rejects(execute({ repo: "owner/project", run_id: 42 }), /unexpected run details/);
});

await test("cancellation before/during commands and overall timeout remain failures", async t => {
  const controller = new AbortController();
  controller.abort(new Error("private-output"));
  const calls = fixture([]);
  await assert.rejects(execute({}, controller.signal), /request cancelled/);
  assert.equal(calls.length, 0);
  const active = new AbortController();
  deps.exec = async () => { active.abort(); return { stdout: "[]" }; };
  await assert.rejects(execute({ repo: "owner/project" }, active.signal), /request cancelled/);
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort());
  await assert.rejects(execute({ repo: "owner/project" }), /timed out/);
});

await test("redacts common credentials before output, strips terminal controls and limits excerpts", () => {
  const token = "ghp_" + "a".repeat(36);
  const raw = "\x1b[31merror\x1b[0m token=" + token + "\npassword: \"private value\"\nAuthorization: Bearer private-auth\nhttps://user:pass@example.com/a?key=private-query";
  const cleaned = module.safeText(raw, 10000);
  for (const value of [token, "private value", "private-auth", "private-query", "user:pass", "\x1b"]) assert.ok(!cleaned.includes(value));
  const excerpt = module.logExcerpt(Array.from({ length: 1000 }, () => "error " + "x".repeat(1000)).join("\n"));
  assert.ok(excerpt.text.length <= 12000);
  assert.equal(excerpt.truncated, true);
  assert.match(module.logExcerpt("plain output").text, /plain output/);
  assert.doesNotMatch(module.safeText("-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----", 1000), /private material/);
});

await test("metadata is redacted too; raw fields never enter details", async () => {
  fixture([[{ ...run, workflowName: "password=private-value", extra: "private-extra" }]]);
  const result = await execute({ repo: "owner/project" });
  assert.doesNotMatch(JSON.stringify(result), /private-value|private-extra/);
});

await test("large metadata, jobs and Unicode logs stay bounded with truncation flags", async () => {
  const long = "界".repeat(1000);
  const bigRun = { ...run, workflowName: long, headBranch: long, createdAt: long };
  fixture([Array.from({ length: 20 }, () => bigRun)]);
  const list = await execute({ repo: "owner/project", limit: 20 });
  assert.ok(Buffer.byteLength(list.content[0].text) < 50000);
  const bigJob = { ...job, name: long, steps: Array.from({ length: 20 }, () => ({ name: long, conclusion: "failure" })) };
  fixture([{ ...bigRun, jobs: Array.from({ length: 20 }, () => bigJob) }, ("error " + long + "\n").repeat(200)]);
  const result = await execute({ repo: "owner/project", run_id: 42 });
  assert.equal(result.details.failedJobs.length, 5);
  assert.equal(result.details.failedJobs[0].steps.length, 5);
  assert.equal(result.details.jobsTruncated, true);
  assert.equal(result.details.failedJobs[0].stepsMayBeTruncated, true);
  assert.equal(result.details.logs.truncated, true);
  assert.ok(Buffer.byteLength(result.content[0].text) < 50000);
});

await test("package manifest includes ci_status for shared package loading", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(manifest.pi.extensions.includes("./.pi/extensions/ci-status.ts"));
});

