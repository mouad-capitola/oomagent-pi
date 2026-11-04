import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChangeTracker, changeLines } from "../.pi/lib/workspace-changes.mjs";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-changes-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  mkdirSync(project);
  const file = join(project, "code.ts");
  writeFileSync(file, "const old = 1;\n");
  const tracker = new ChangeTracker(root);
  const scopes = [{ path: root, recursive: false }, { path: project, recursive: true }];
  assert.deepEqual(tracker.poll(scopes), []);
  return { root, project, file, tracker, scopes };
}

test("tracks nested active-project edits, additions, deletion, atomic saves and ancestors", t => {
  const { root, project, file, tracker, scopes } = fixture(t);
  const temp = join(project, "temporary");
  writeFileSync(temp, "const now = 2;\n");
  renameSync(temp, file);
  let events = tracker.poll(scopes);
  assert.equal(events.length, 1);
  assert.equal(events[0].before, "const old = 1;\n");
  assert.equal(events[0].after, "const now = 2;\n");
  assert.equal(tracker.marker(project), "•");
  assert.equal(tracker.marker(root + "-outside"), "");
  assert.equal(tracker.marker(file), "~");
  assert.deepEqual(tracker.poll(scopes), []);
  mkdirSync(join(project, "nested"));
  writeFileSync(join(project, "nested/new.ts"), "new");
  events = tracker.poll(scopes);
  assert.ok(events.some(e => e.path.endsWith("nested/new.ts") && e.kind === "nieuw"));
  rmSync(file);
  events = tracker.poll(scopes);
  assert.equal(events.find(e => e.path === file).kind, "verwijderd");
  assert.equal(tracker.changes.get(file).before, "const now = 2;\n");
});

test("rename is honestly represented as removal and addition", t => {
  const { project, file, tracker, scopes } = fixture(t);
  renameSync(file, join(project, "renamed.ts"));
  const events = tracker.poll(scopes);
  assert.deepEqual(events.map(e => e.kind).sort(), ["nieuw", "verwijderd"]);
});

test("does not traverse symlinks, secrets, generated folders or other unopened projects", t => {
  const { root, project, tracker, scopes } = fixture(t);
  mkdirSync(join(root, "other"));
  writeFileSync(join(root, "other/hidden.txt"), "not observed");
  writeFileSync(join(project, ".env.local"), "fixture only");
  mkdirSync(join(project, "node_modules"));
  writeFileSync(join(project, "node_modules/package.js"), "ignored");
  symlinkSync(join(root, "other"), join(project, "link"));
  tracker.poll(scopes);
  assert.ok(!tracker.snapshot.has(join(root, "other/hidden.txt")));
  assert.ok(!tracker.snapshot.has(join(project, ".env.local")));
  assert.ok(!tracker.snapshot.has(join(project, "link")));
  assert.ok(!tracker.snapshot.has(join(project, "node_modules")));
  const expanded = [...scopes, { path: join(root, "other"), recursive: false }];
  assert.ok(!tracker.poll(expanded).some(e => e.path.endsWith("hidden.txt")));
  writeFileSync(join(root, "other/hidden.txt"), "changed");
  assert.ok(tracker.poll(expanded).some(e => e.path.endsWith("hidden.txt")));
});

test("binary and oversized changes get metadata only; history is bounded", t => {
  const { project, file, tracker, scopes } = fixture(t);
  writeFileSync(file, Buffer.from([0, 1, 2]));
  tracker.poll(scopes);
  assert.equal(tracker.changes.get(file).after, undefined);
  assert.match(changeLines(tracker.changes.get(file))[0].text, /metadata/);
  writeFileSync(file, "x".repeat(512 * 1024 + 1));
  tracker.poll(scopes);
  assert.equal(tracker.changes.get(file).after, undefined);
  for (let i = 0; i < 110; i++) writeFileSync(join(project, "new-" + i), "text");
  tracker.poll(scopes);
  assert.equal(tracker.changes.size, 100);
});

test("comparison puts new green-role lines before old red-role lines, with original line numbers", () => {
  const lines = changeLines({ before: "same\nold\ntail", after: "same\nnew\ntail" });
  assert.deepEqual(lines.slice(1), [
    { kind: "new", line: 2, text: "new" },
    { kind: "old", line: 2, text: "old" },
  ]);
  assert.deepEqual(changeLines({ before: "", after: "new" }).slice(1), [{ kind: "new", line: 1, text: "new" }]);
  assert.deepEqual(changeLines({ before: "old", after: "" }).slice(1), [{ kind: "old", line: 1, text: "old" }]);
  assert.equal(changeLines({ before: "same", after: "same" }).length, 1);
});

test("failed scope scans do not report false deletions", t => {
  const { root, tracker, scopes } = fixture(t);
  const events = tracker.poll([...scopes, { path: join(root, "missing"), recursive: true }]);
  assert.equal(events.length, 0);
  assert.match(tracker.warning, /niet bereikbaar/);
});
