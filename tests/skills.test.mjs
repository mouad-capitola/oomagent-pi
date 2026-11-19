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
  for (const name of ["questionnaire", "debugging", "code-review", "security-review", "libraries-first", "production-testing", ...Object.keys(templates)]) {
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

test("production-testing is discoverable and requires production runtime without dev fallback", async () => {
  const result = loadSkillsFromDir({ dir: skillsDir, source: "project" });
  const skill = result.skills.find(skill => skill.name === "production-testing");
  assert.ok(skill, "production-testing must be discoverable");
  assert.equal(skill.disableModelInvocation, false);
  assert.equal(skill.baseDir, join(skillsDir, "production-testing"));
  assert.ok(skill.description.length > 0 && skill.description.length <= 1024);
  assert.match(skill.description, /altijd in productiemodus/);
  assert.match(skill.description, /API-, browser-, E2E-, smoke- en securitytests/);
  const body = await readFile(skill.filePath, "utf8");
  for (const [requirement, pattern] of [
    ["require real production artifacts and startup", /echte productie-build en productie-startopdracht/],
    ["separate production mode from live environments", /Productiemodus is niet de live omgeving/],
    ["ban development targets and source mounts", /geen dev-server, development Docker-target, hot-reload of broncodemount/],
    ["block instead of falling back", /Meld runtimevalidatie als geblokkeerd\. Geen dev-fallback/],
    ["verify effective runtime before traffic", /effectieve runtime vóór testverkeer/],
    ["check frontend dependencies too", /inclusief de API achter een frontend/],
    ["inspect runtime evidence", /entrypoint\/command, processen en mounts/],
    ["retain unit and static checks", /Een unit-test-, lint- of typecheckrunner is geen dev-server/],
    ["preserve security controls", /Schakel TLS-, origin-, CSRF-, MFA- of service-keycontroles nooit uit/],
    ["require explicit security scan approval", /expliciete toestemming voor doel en scantype vóór securityscans/],
    ["protect existing stacks", /Vraag toestemming voordat een draaiende stack moet worden omgeschakeld/],
    ["distinguish instructions from enforcement", /geen technische sandbox of automatische runtimecontrole/],
  ]) {
    assert.match(body, pattern, requirement);
  }
  for (const [, relative] of body.matchAll(/\]\((\.\.?\/[^)#]+\.md)\)/g)) {
    await access(join(skill.baseDir, relative));
  }
});

test("repository instructions and frontend QA apply the production-testing gate", async () => {
  const instructions = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const frontend = await readFile(join(skillsDir, "frontend-qa", "SKILL.md"), "utf8");
  assert.ok(instructions.includes(".pi/skills/production-testing/SKILL.md"));
  assert.match(instructions, /validation as blocked; no dev fallback/);
  assert.ok(readme.includes("/skill:production-testing"));
  assert.ok(frontend.includes("../production-testing/SKILL.md"));
  assert.match(frontend, /vóór browserverkeer/);
  assert.match(frontend, /frontend én de aangeroepen API/);
  await access(join(skillsDir, "frontend-qa", "../production-testing/SKILL.md"));
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
