import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hostRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const { loadSkillsFromDir } = await import(pathToFileURL(join(hostRoot, "core/skills.js")).href);
const skillsDir = fileURLToPath(new URL("../.pi/skills/", import.meta.url));
const templates = {
  "agent-evaluatie": "evaluatierapport.md",
  "prompt-injection-review": "reviewrapport.md",
  "opleverchecklist": "opleverrapport.md",
};

test("shared skills load without diagnostics and keep existing workflows", async () => {
  const result = loadSkillsFromDir({ dir: skillsDir, source: "project" });
  assert.deepEqual(result.diagnostics, []);
  const names = result.skills.map(skill => skill.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of ["questionnaire", "debugging", "code-review", "security-review", "libraries-first", ...Object.keys(templates)]) {
    assert.ok(names.includes(name), `${name} must be discoverable`);
  }
  for (const [name, template] of Object.entries(templates)) {
    const skill = result.skills.find(skill => skill.name === name);
    assert.equal(skill.disableModelInvocation, false);
    assert.ok(skill.description.length > 0 && skill.description.length <= 1024);
    const body = await readFile(skill.filePath, "utf8");
    assert.ok(body.includes(`assets/${template}`));
    await access(join(skill.baseDir, "assets", template));
  }
});

test("libraries-first is automatically eligible and documents research and fallback boundaries", async () => {
  const result = loadSkillsFromDir({ dir: skillsDir, source: "project" });
  const skill = result.skills.find(skill => skill.name === "libraries-first");
  assert.ok(skill, "libraries-first must be discoverable");
  assert.equal(skill.disableModelInvocation, false);
  assert.ok(skill.description.length > 0 && skill.description.length <= 1024);
  assert.match(skill.description, /tests/);
  assert.match(skill.description, /codewijzigingen/);
  const body = await readFile(skill.filePath, "utf8");
  for (const [requirement, pattern] of [
    ["reuse existing dependencies and platform APIs", /bestaande dependencies, testframeworks, standaardbibliotheek en platform-API's/],
    ["verify external candidates", /officiële documentatie en package-registers/],
    ["report an unsuccessful search", /Geen geschikte library gevonden binnen/],
    ["distinguish unavailable research", /niet kunnen verifiëren/],
    ["discuss custom implementation first", /Bespreek dit vóór je een eigen alternatief bouwt/],
    ["require approval for installation", /Installeer of upgrade alleen na expliciete toestemming/],
    ["preserve installed libraries", /Wijzig geen geïnstalleerde libraries/],
    ["avoid claiming unexecuted checks", /Claim geen geslaagde checks die niet zijn uitgevoerd/],
  ]) {
    assert.match(body, pattern, requirement);
  }
});
