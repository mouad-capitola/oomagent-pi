import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../scripts/git-preflight.mjs", import.meta.url));
const zero = "0".repeat(40);
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "oomagent-gate-test-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const run = (mode, input = "") => spawnSync(process.execPath, [runner, mode], { cwd: root, input, encoding: "utf8", timeout: 30_000 });
  try {
    git("init");
    git("config", "user.name", "Preflight Test");
    git("config", "user.email", "preflight@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", join(root, "no-hooks"));
    mkdirSync(join(root, "tests"));
    const file = join(root, "tests/smoke.test.mjs");
    fn({ root, git, run, file });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const pass = 'import { test } from "node:test"; test("smoke", () => {});\n';
const fail = 'import { test } from "node:test"; test("smoke", () => { throw new Error("expected failure"); });\n';

test("pre-commit checks staged content, not unstaged edits, and makes no fixes", () => fixture(({ git, run, file }) => {
  writeFileSync(file, pass);
  git("add", ".");
  writeFileSync(file, fail);
  assert.equal(run("pre-commit").status, 0);
  assert.equal(readFileSync(file, "utf8"), fail);
  git("add", ".");
  writeFileSync(file, pass);
  const result = run("pre-commit");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GEBLOKKEERD/);
  assert.equal(readFileSync(file, "utf8"), pass);
}));

test("missing tests and whitespace errors fail closed", () => fixture(({ root, git, run, file }) => {
  writeFileSync(join(root, "README.md"), "hello\n");
  git("add", ".");
  assert.equal(run("pre-commit").status, 1);
  writeFileSync(file, pass);
  writeFileSync(join(root, "README.md"), "hello   \n");
  git("add", ".");
  assert.equal(run("pre-commit").status, 1);
}));

test("pre-push checks every outgoing commit, including a failure fixed later", () => fixture(({ git, run, file }) => {
  writeFileSync(file, pass); git("add", "."); git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(file, fail); git("add", "."); git("commit", "-m", "bad");
  writeFileSync(file, pass); git("add", "."); git("commit", "-m", "fixed");
  const tip = git("rev-parse", "HEAD");
  assert.equal(run("pre-push", `refs/heads/main ${tip} refs/heads/main ${base}\n`).status, 1);
  assert.equal(run("pre-push", `refs/heads/main ${tip} refs/heads/new ${zero}\n`).status, 1);
}));

test("pre-push passes clean commits, skips deletions and rejects malformed input", () => fixture(({ git, run, file }) => {
  writeFileSync(file, pass); git("add", "."); git("commit", "-m", "clean");
  const tip = git("rev-parse", "HEAD");
  assert.equal(run("pre-push", `refs/heads/main ${tip} refs/heads/new ${zero}\n`).status, 0);
  assert.equal(run("pre-push", `refs/heads/main ${zero} refs/heads/main ${tip}\n`).status, 0);
  assert.equal(run("pre-push", "invalid\n").status, 1);
}));
