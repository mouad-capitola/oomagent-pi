import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { sessionTokenUsage } from "../.pi/lib/footer-metrics.ts";

test("session tokens sum recorded input, output and caches, not message content", () => {
  const entries = [
    { type: "message", message: { role: "system", content: "old instructions".repeat(1000) } },
    { type: "message", message: { role: "user", content: "test" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer!!" }, { type: "thinking", thinking: "hmmm" }, { type: "toolCall", name: "read", arguments: {} }], usage: { input: 100_000, output: 100_000, cacheRead: 100_000, cacheWrite: 50_000, totalTokens: 350_000 } } },
    { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "data" }] } },
    { type: "message", message: { role: "bashExecution", command: "ignored", output: "ignored", excludeFromContext: true } },
    { type: "usage", usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { type: "compaction", usage: { input: 100, output: 10, cacheRead: 20, cacheWrite: 30 } },
    { type: "branch_summary", usage: { input: 200, output: 20, cacheRead: 40, cacheWrite: 60 } },
    { type: "message", message: { role: "toolResult", usage: { input: 300, output: 30, cacheRead: 60, cacheWrite: 90 } } },
    { type: "compaction" },
  ] as unknown as SessionEntry[];
  assert.deepEqual(sessionTokenUsage([]), { total: 0, incomplete: false });
  assert.deepEqual(sessionTokenUsage(entries), { total: 1_350_960, incomplete: false });
  assert.deepEqual(sessionTokenUsage(entries.slice(2)), { total: 1_350_960, incomplete: false });
});

test("session usage flags missing/invalid counts and counts zero as complete", () => {
  const entries = [
    { type: "message", message: { role: "assistant" } },
    { type: "usage", usage: { input: 5, output: -1, cacheRead: NaN, cacheWrite: Infinity } },
  ] as unknown as SessionEntry[];
  assert.deepEqual(sessionTokenUsage(entries), { total: 5, incomplete: true });
  const zero = [{ type: "usage", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] as unknown as SessionEntry[];
  assert.deepEqual(sessionTokenUsage(zero), { total: 0, incomplete: false });
});

test("preflight discovers and executes TypeScript tests without installing tooling", async () => {
  const root = await mkdtemp(join(tmpdir(), "oomagent-ts-gate-"));
  const runner = fileURLToPath(new URL("../scripts/git-preflight.mjs", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  const run = () => spawnSync(process.execPath, [runner, "pre-commit"], { cwd: root, encoding: "utf8", timeout: 30_000 });
  try {
    git("init");
    await mkdir(join(root, "tests"));
    const file = join(root, "tests/smoke.test.ts");
    await writeFile(file, 'import { test } from "node:test"; const value: number = 1; test("typed smoke", () => { if (value !== 1) throw new Error("bad value"); });\n');
    git("add", ".");
    assert.equal(run().status, 0);
    await writeFile(file, 'import { test } from "node:test"; const value: number = 1; test("typed smoke", () => { throw new Error("typed failure"); });\n');
    git("add", ".");
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stdout + failed.stderr, /typed failure/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
