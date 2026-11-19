import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hostRoot = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const { loadSkillsFromDir } = await import(pathToFileURL(join(hostRoot, "core/skills.js")).href);
const skillsDir = fileURLToPath(new URL("../.pi/skills/", import.meta.url));

test("time estimation is discoverable without diagnostics and eligible for automatic selection", () => {
  const result = loadSkillsFromDir({ dir: skillsDir, source: "project" });
  assert.deepEqual(result.diagnostics, []);
  const skill = result.skills.find(skill => skill.name === "tijdsinschatting");
  assert.ok(skill);
  assert.equal(skill.disableModelInvocation, false);
  assert.equal(skill.baseDir, join(skillsDir, "tijdsinschatting"));
  assert.ok(skill.description.length > 0 && skill.description.length <= 1024);
  assert.match(skill.description, /iedere nieuwe taak/);
});

test("time estimates cover initial timing, revised remaining time and honest limitations", async () => {
  const body = await readFile(join(skillsDir, "tijdsinschatting", "SKILL.md"), "utf8");
  for (const pattern of [
    /vóór het eerste onderzoek of de eerste toolactie/,
    /grove bandbreedte/,
    /totale duur nog onzeker/,
    /wachttijd/,
    /herziene schatting van de resterende tijd/,
    /geen garantie/,
    /alleen als die met betrouwbare begin- en eindtijd is gemeten/,
    /Sla geen controles of toestemmingsvragen over/,
    /Respecteer expliciete uitvoerformaten/,
    /geen automatische timer of technische afdwinging/,
  ]) assert.match(body, pattern);
  assert.ok(body.includes("~/.pi/agent/AGENTS.md"));
});
