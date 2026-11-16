import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, posix, win32 } from "node:path";
import { tmpdir } from "node:os";
import { isWithinRoot, scanContent, scanGitTree, scanGitHistory, scanWorktree } from "../scripts/secret-scan.mjs";

for (const [name, paths, root] of [
  ["POSIX", posix, "/workspace/repo"],
  ["Windows", win32, "C:\\workspace\\repo"],
  ["Windows UNC", win32, "\\\\server\\share\\repo"],
]) {
  test(`${name} containment accepts children but rejects root, parents and sibling prefixes`, () => {
    for (const child of ["README.md", "sub/file.txt", "..notes/file.txt"]) {
      assert.equal(isWithinRoot(root, paths.resolve(root, child), paths), true, child);
    }
    for (const outside of [root, paths.dirname(root), `${root}-other/file.txt`, paths.resolve(root, "../outside.txt")]) {
      assert.equal(isWithinRoot(root, outside, paths), false, outside);
    }
  });
}

test("Windows containment handles mixed separators and rejects other drives or shares", () => {
  assert.equal(isWithinRoot("C:\\repo", "C:/repo/sub/file.txt", win32), true);
  assert.equal(isWithinRoot("C:\\repo", "D:\\repo\\file.txt", win32), false);
  assert.equal(isWithinRoot("\\\\server\\share\\repo", "\\\\server\\other\\repo\\file.txt", win32), false);
});

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
  // Store the actual symlink mode in Git without requiring Windows symlink privileges.
  writeFileSync(join(root, "sub", "link"), "/outside/not-read");
  git("add", ".");
  const object = git("hash-object", "-w", "sub/link");
  git("update-index", "--cacheinfo", `120000,${object},sub/link`);
  assert.throws(() => scanGitTree(root, git("write-tree")), /external symlink/);
}));

test("tree accepts internal relative links and rejects escaping or absolute targets", () => fixture((root, git) => {
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "inside.txt"), "safe fixture\n");
  git("add", "inside.txt");
  for (const [target, allowed] of [
    ["../inside.txt", true],
    ["../../outside.txt", false],
    [`../../${root.split(/[\\/]/).at(-1)}-other/inside.txt`, false],
    ["..", false],
    [join(root, "inside.txt"), false],
    ["/outside/not-read", false],
    ...(process.platform === "win32" ? [["Z:\\outside\\not-read", false], ["\\\\server\\share\\not-read", false]] : []),
  ]) {
    writeFileSync(join(root, "sub", "link"), target);
    const object = git("hash-object", "-w", "sub/link");
    git("update-index", "--add", "--cacheinfo", `120000,${object},sub/link`);
    const tree = git("write-tree");
    if (allowed) assert.deepEqual(scanGitTree(root, tree).findings, [], target);
    else assert.throws(() => scanGitTree(root, tree), /external symlink/, target);
  }
}));
