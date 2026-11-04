import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanContent, scanGitTree, scanGitHistory, scanWorktree } from "../scripts/secret-scan.mjs";

test("credential checks redact literals including env defaults and OAuth prefixes", () => {
  const secret = "abcdef0123456789".repeat(4);
  const oauth = ["ya29", "x".repeat(50)].join(".");
  for (const text of [
    `MCP_API_KEY=${secret}`,
    `os.environ.setdefault("ASSEMBLYAI_API_KEY", "${secret}")`,
    `os.getenv("GOOGLE_ACCESS_TOKEN", "${oauth}")`,
    `const OPENAI_API_KEY = "${["sk", "proj", "x".repeat(40)].join("-")}";`,
    ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
  ]) {
    const result = scanContent("source.py", Buffer.from(text));
    assert.ok(result.length);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(result).includes(oauth));
  }
  assert.deepEqual(scanContent(".env.example", Buffer.from("MCP_API_KEY=\n")), []);
  assert.deepEqual(scanContent("source.py", Buffer.from('KEY = os.environ["MCP_API_KEY"]')), []);
});

test("private file names and oversized blobs fail closed even without text", () => {
  for (const name of [".env", ".env.test", "sub/.env.example", "sub/service.env", "secrets/key.json", "auth.json", "state.sqlite3",
    "skills/export/output/customer.docx", "file:Zone.Identifier"]) {
    assert.equal(scanContent(name, Buffer.from([0])).some(x => x.rule === "private-file"), true, name);
  }
  assert.equal(scanContent("large.txt", Buffer.alloc(2 * 1024 * 1024 + 1)).at(-1).rule, "oversized-unscanned-file");
});

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "oomagent-secret-test-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: "pipe" }).trim();
  try {
    git("init"); git("config", "user.name", "Security fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", join(root, "no-hooks"));
    run(root, git);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("index and history cannot be hidden by a clean working copy or later cleanup", () => fixture((root, git) => {
  const source = `MCP_API_KEY=${"abcdef0123456789".repeat(4)}\n`;
  writeFileSync(join(root, ".env.example"), source);
  git("add", "."); git("commit", "-m", "synthetic fixture");
  writeFileSync(join(root, ".env.example"), "MCP_API_KEY=\n");
  assert.equal(scanWorktree(root).findings.length, 0);
  assert.ok(scanGitTree(root, git("write-tree")).findings.length);
  git("add", "."); git("commit", "-m", "remove fixture value");
  assert.equal(scanGitTree(root, "HEAD").findings.length, 0);
  assert.ok(scanGitHistory(root).findings.some(x => x.rule === "credential-literal"));
}));

test("ignored local envs are never opened; external links fail tree approval", () => fixture((root, git) => {
  writeFileSync(join(root, ".gitignore"), ".env*\n");
  writeFileSync(join(root, ".env"), "unread-local-fixture");
  assert.equal(scanWorktree(root).findings.length, 0);
  mkdirSync(join(root, "sub"));
  symlinkSync("/outside/not-read", join(root, "sub", "link"));
  git("add", ".");
  assert.throws(() => scanGitTree(root, git("write-tree")), /external symlink/);
}));
