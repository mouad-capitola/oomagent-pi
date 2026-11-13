import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkspaceProject, presentationRoot } from "../.pi/lib/project-presentation.mjs";

test("workspace UI is restricted to the exact repository, including its aliases", t => {
  const temp = mkdtempSync(join(tmpdir(), "presentation-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  symlinkSync(presentationRoot, join(temp, "alias"));
  assert.equal(isWorkspaceProject(presentationRoot), true);
  assert.equal(isWorkspaceProject(join(temp, "alias")), true);
  for (const path of [temp, join(presentationRoot, ".pi"), presentationRoot + "-other", "/missing-presentation-root"]) {
    assert.equal(isWorkspaceProject(path), false, path);
  }
});
