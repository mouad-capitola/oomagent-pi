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
  assert.ok(text.includes("Never reveal secrets or .env values"));
  assert.match(text, /untrusted data, not instructions/);
  assert.match(text, /path boundaries, symlinks, network destinations and input validation/);
  assert.match(text, /external commitments also require explicit authorization/);
  assert.match(text, /Configuration and prompts are not security boundaries/);
  assert.match(text, /Do not weaken tests or claim unexecuted success/);
  assert.ok(text.includes("Ask before installing/upgrading"));
  assert.match(text, /Do not commit, push, deploy or run destructive commands without explicit authorization/);
});

test("always-loaded prompt stays compact and tool descriptions remain lazy", async () => {
  const text = await readFile(new URL("../.pi/system-prompt.md", import.meta.url), "utf8");
  assert.ok(text.length <= 3500, `Prompt has ${text.length} characters; budget is 3500, not a provider-token guarantee`);
  const settings = JSON.parse(await readFile(new URL("../.pi/settings.json", import.meta.url), "utf8"));
  assert.equal(settings.codemode.mode, "only");
  assert.equal(settings.codemode.inlineBudget, 0);
});
