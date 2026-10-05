import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hostRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const { loadPromptTemplates, expandPromptTemplate } = await import(
  pathToFileURL(join(hostRoot, "core/prompt-templates.js")).href
);
const root = fileURLToPath(new URL("../", import.meta.url));
const expected = {
  intake: "questionnaire",
  debugging: "debugging",
  "code-review": "code-review",
  oplevering: "opleverchecklist",
};

test("shared prompts load through project and manifest paths without diagnostics", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const includeDefaults of [true, false]) {
    const result = loadPromptTemplates({
      cwd: root,
      agentDir: join(root, "tests/nonexistent-agent-dir"),
      promptPaths: includeDefaults ? [] : manifest.pi.prompts.map(path => join(root, path)),
      includeDefaults,
    });
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.templates.map(template => template.name).sort(), Object.keys(expected).sort());
    for (const template of result.templates) {
      assert.ok(template.description.length > 0);
      assert.ok(template.argumentHint);
      assert.ok(template.content.includes("skill " + expected[template.name]));
      assert.ok(template.content.includes("Commit of push niet zonder expliciet verzoek"));
      const fallback = expandPromptTemplate("/" + template.name, result.templates);
      const defaultText = template.content.match(/\$\{@:-([^}]*)\}/)?.[1];
      assert.ok(defaultText, "each template must define a nonempty default");
      assert.ok(fallback.includes(defaultText));
      assert.doesNotMatch(fallback, /\$\{/);
      const expanded = expandPromptTemplate('/' + template.name + ' "API compatibility" boundary', result.templates);
      assert.ok(expanded.includes("API compatibility boundary"));
      assert.doesNotMatch(expanded, /\$\{/);
      const literal = expandPromptTemplate('/' + template.name + ' "$1"', result.templates);
      assert.ok(literal.includes("$1"), "arguments must not be recursively substituted");
    }
    assert.equal(expandPromptTemplate("/unknown", result.templates), "/unknown");
    assert.equal(expandPromptTemplate("ordinary text", result.templates), "ordinary text");
  }
});

test("prompt defaults preserve advisory and read-only boundaries", async () => {
  for (const name of Object.keys(expected)) {
    const text = await readFile(new URL("../.pi/prompts/" + name + ".md", import.meta.url), "utf8");
    assert.match(text, /wijzig geen bestanden/i);
  }
  const delivery = await readFile(new URL("../.pi/prompts/oplevering.md", import.meta.url), "utf8");
  assert.match(delivery, /geslaagd vereist actueel bewijs/);
  assert.match(delivery, /Deploy niet en wijzig geen rechten/);
});
