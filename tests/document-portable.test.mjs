import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { readFile, mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tool;
const calls = [];
globalThis.__documentPortable = { exec: async (...args) => { calls.push(args); return { stdout: JSON.stringify({ text: "Extracted on Linux", pageCount: 2, extractionTruncated: false }) }; } };
const url = new URL("../.pi/extensions/document-reader.ts", import.meta.url);
const source = (await readFile(url, "utf8"))
  .replace(/^import .* from "@earendil-works\/[^\n]+\n/gm, "")
  .replace("const execFileAsync = promisify(execFile);", "const execFileAsync = globalThis.__documentPortable.exec;")
  .replaceAll("import.meta.url", JSON.stringify(url.href));
const prelude = 'const process = {platform: "linux"}; const Type = new Proxy({}, {get: () => x => x}); const defineTool = x => x;\n';
const module = await import(`data:text/javascript;base64,${Buffer.from(prelude + stripTypeScriptTypes(source)).toString("base64")}`);
delete globalThis.__documentPortable;
module.default({ registerTool(value) { tool = value; } });

test("Linux document reader invokes the pinned local Python tool and bounds output", async t => {
  const dir = await mkdtemp(join(tmpdir(), "document user "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "report.pdf"), "synthetic fixture");
  const result = await tool.execute("test", { file_path: "report.pdf", max_characters: 9 }, undefined, undefined, { cwd: dir });
  assert.match(calls[0][0], /\.portable\/python\/bin\/python$/);
  assert.match(calls[0][1][0], /portable\/document-text.py$/);
  assert.equal(calls[0][2].timeout, 60000);
  assert.equal(result.details.pageCount, 2);
  assert.equal(result.details.truncated, true);
  assert.match(result.content[0].text, /^Extracted\n/);
  for (const path of ["../report.pdf", "/tmp/report.pdf", ".env/report.pdf"]) {
    await assert.rejects(tool.execute("test", { file_path: path }, undefined, undefined, { cwd: dir }), /relative|blocked/);
  }
  await symlink("/etc/passwd", join(dir, "outside.pdf"));
  await assert.rejects(tool.execute("test", { file_path: "outside.pdf" }, undefined, undefined, { cwd: dir }), /outside/);
  assert.equal(calls.length, 1);
});
