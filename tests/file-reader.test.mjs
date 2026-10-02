import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test the exported filesystem core without installing Pi or third-party packages.
// Pi registration is checked separately by loading the extension in Pi.
const source = await readFile(new URL("../.pi/extensions/file-reader.ts", import.meta.url), "utf8");
const core = source.slice(0, source.indexOf("export default function"))
  .replace(/^import .* from "@earendil-works\/[^\n]+\n/gm, "");
const { readProjectFile, MAX_FILE_BYTES } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(core)).toString("base64")}`
);

async function fixture(fn) {
  const parent = await mkdtemp(join(tmpdir(), "pi-reader-test-"));
  const root = join(parent, "project");
  await mkdir(root);
  try { await fn(root, parent); }
  finally { await rm(parent, { recursive: true, force: true }); }
}

await test("UTF-8, BOM, empty file, metadata and exact size limit", () => fixture(async root => {
  await writeFile(join(root, "text.txt"), "\ufeffHéllo 🌍");
  const result = await readProjectFile(root, "text.txt");
  assert.equal(result.content[0].text, "Héllo 🌍");
  assert.equal(result.details.requestedPath, "text.txt");
  assert.equal(result.details.resolvedPath, await realpath(join(root, "text.txt")));
  assert.equal(result.details.sizeBytes, Buffer.byteLength("\ufeffHéllo 🌍"));
  assert.equal(result.details.encoding, "utf-8");
  await writeFile(join(root, "empty.txt"), "");
  assert.equal((await readProjectFile(root, "empty.txt")).content[0].text, "");
  await writeFile(join(root, "limit.txt"), Buffer.alloc(MAX_FILE_BYTES, 65));
  assert.equal((await readProjectFile(root, "limit.txt")).details.sizeBytes, MAX_FILE_BYTES);
  await writeFile(join(root, "large.txt"), Buffer.alloc(MAX_FILE_BYTES + 1, 65));
  await assert.rejects(readProjectFile(root, "large.txt"), /size limit/);
}));

await test("UTF-16 BOMs, invalid encoding and binary data", () => fixture(async root => {
  const little = Buffer.from("Héllo", "utf16le");
  const big = Buffer.from(little).swap16();
  for (const [name, bytes, encoding] of [
    ["le.txt", Buffer.concat([Buffer.from([255, 254]), little]), "utf-16le"],
    ["be.txt", Buffer.concat([Buffer.from([254, 255]), big]), "utf-16be"],
  ]) {
    await writeFile(join(root, name), bytes);
    const result = await readProjectFile(root, name);
    assert.equal(result.content[0].text, "Héllo");
    assert.equal(result.details.encoding, encoding);
  }
  for (const [name, bytes, pattern] of [
    ["bad.txt", Buffer.from([0xc3, 0x28]), /invalid utf-8/],
    ["odd.txt", Buffer.from([255, 254, 65]), /invalid utf-16le/],
    ["binary.txt", Buffer.from([65, 0, 66]), /binary content/],
  ]) {
    await writeFile(join(root, name), bytes);
    await assert.rejects(readProjectFile(root, name), pattern);
  }
}));

await test("path traversal, absolute paths, directories and missing files", () => fixture(async root => {
  for (const path of ["", "../outside.txt", "a/../../outside.txt", "..\\outside.txt", "/tmp/a.txt", "C:\\a.txt", "\\\\server\\share\\a.txt", "a\0.txt"]) {
    await assert.rejects(readProjectFile(root, path), /relative/);
  }
  await mkdir(join(root, "folder"));
  await assert.rejects(readProjectFile(root, "folder"), /directory, not a file/);
  await assert.rejects(readProjectFile(root, "missing.txt"), /does not exist/);
  await writeFile(join(root, "file.txt"), "text");
  await assert.rejects(readProjectFile(root, "file.txt/child.txt"), /parent path/);
  await writeFile(join(root, "file.json"), "{}");
  await assert.rejects(readProjectFile(root, "file.json"), /only .txt and .csv/);
}));

await test("symlink boundaries, prefix sibling and loops", () => fixture(async (root, parent) => {
  const sibling = join(parent, "project-other");
  await mkdir(sibling);
  await writeFile(join(sibling, "outside.txt"), "outside");
  await symlink(join(sibling, "outside.txt"), join(root, "outside.txt"));
  await assert.rejects(readProjectFile(root, "outside.txt"), /outside the project/);
  await symlink(sibling, join(root, "outside-dir"));
  await assert.rejects(readProjectFile(root, "outside-dir/outside.txt"), /outside the project/);
  await writeFile(join(root, "inside.txt"), "inside");
  await symlink("inside.txt", join(root, "alias.txt"));
  assert.equal((await readProjectFile(root, "alias.txt")).content[0].text, "inside");
  await symlink("loop.txt", join(root, "loop.txt"));
  await assert.rejects(readProjectFile(root, "loop.txt"), /symlink loop/);
}));

await test("CSV quoting, multiline fields, empty values and malformed CSV", () => fixture(async root => {
  await writeFile(join(root, "data.csv"), '\ufeffname,note\r\nAda,"a,b\n""quoted"""\r\nBob,\r\n');
  const result = await readProjectFile(root, "data.csv");
  assert.deepEqual(result.details.columns, ["name", "note"]);
  assert.deepEqual(result.details.rows, [{ name: "Ada", note: 'a,b\n"quoted"' }, { name: "Bob", note: "" }]);
  for (const text of ["", "a,a\nx,y", "a,b\nx", 'a\n"unclosed', 'a\n"x"oops']) {
    await writeFile(join(root, "bad.csv"), text);
    await assert.rejects(readProjectFile(root, "bad.csv"), /file_reader:/);
  }
}));

await test("permission denied", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => fixture(async root => {
  const path = join(root, "private.txt");
  await writeFile(path, "private");
  await chmod(path, 0);
  try { await assert.rejects(readProjectFile(root, "private.txt"), /permission denied/); }
  finally { await chmod(path, 0o600); }
}));

await test("cancellation", () => fixture(async root => {
  await writeFile(join(root, "file.txt"), "hello");
  await assert.rejects(readProjectFile(root, "file.txt", AbortSignal.abort()), /abort/i);
}));
