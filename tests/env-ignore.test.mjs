import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("environment files and backups are ignored, only the root example is shareable", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temporary = mkdtempSync(join(tmpdir(), "oomagent-env-ignore-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  try {
    execFileSync("git", ["init", "--bare", temporary], { stdio: "ignore", env });
    const ignored = [
      ".env", ".env.local", ".env.production", ".env.test", ".env.dev", ".env.bak", ".env~",
      ".envrc", "service.env", "service.env.backup", "nested/.env", "nested/.env.production", "nested/.env.example",
    ];
    const allowed = [".env.example", "src/fastapi/alembic/env.py", "src/config.py", "package.json"];
    for (const [files, expected] of [[ignored, 0], [allowed, 1]]) {
      for (const file of files) {
        const result = spawnSync("git", ["--git-dir=" + temporary, "--work-tree=" + root,
          "check-ignore", "-q", "--no-index", "--", file], { cwd: root, env, encoding: "utf8" });
        assert.equal(result.status, expected, file);
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
