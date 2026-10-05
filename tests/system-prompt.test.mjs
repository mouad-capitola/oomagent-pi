import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { test } from "node:test";

test("loaded append prompt includes conversational guidance without removing task safeguards", async () => {
  const append = new URL("../.pi/APPEND_SYSTEM.md", import.meta.url);
  const source = new URL("../.pi/system-prompt.md", import.meta.url);
  assert.equal(await realpath(append), await realpath(source));
  const text = await readFile(append, "utf8");
  assert.match(text, /## Conversation/);
  assert.match(text, /relaxed, friendly tone like a beste vriend/);
  assert.match(text, /Whatssup, beste vriend!/);
  assert.doesNotMatch(text, /mattie/i);
  assert.match(text, /without forcing slang into every reply/);
  assert.match(text, /Keep concrete technical work accurate and clear/);
  assert.match(text, /use 📁 for folders and 📄 for files in a fenced text block/);
  assert.match(text, /root on the left, children indented to the right/);
  assert.match(text, /consistent ├──, └── and │ connectors/);
  assert.match(text, /Preserve actual names, distinguish symlinks/);
  assert.match(text, /Do not call tools, inspect files, activate Serena/);
  assert.match(text, /Apply repository instructions silently/);
  assert.match(text, /If a greeting also contains a concrete request/);
  assert.match(text, /Follow the project instructions supplied for the current task/);
  assert.match(text, /Before taking project actions, read applicable nested AGENTS\.md/);
  assert.match(text, /## Security/);
  assert.match(text, /Do not commit, push, deploy or run destructive commands without explicit authorization/);
});
