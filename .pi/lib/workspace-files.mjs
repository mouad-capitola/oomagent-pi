import { constants, lstatSync, realpathSync, readdirSync, openSync, closeSync, fstatSync, fchmodSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from "node:fs";
import { resolve, relative, sep, dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";

export const MAX_FILE_BYTES = 512 * 1024;
export const safeLabel = text => String(text).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "?");
const restricted = name => /^\.env(?:\.|$)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name)
  || /^(?:auth|credentials)\.json$/i.test(name) || [".git", ".ssh", ".aws"].includes(name);

export function checkedPath(root, path) {
  const suppliedRoot = resolve(root);
  root = realpathSync(root);
  let target = resolve(suppliedRoot, path);
  if (target === suppliedRoot || target.startsWith(suppliedRoot + sep)) target = resolve(root, relative(suppliedRoot, target));
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(".." + sep) || resolve(root, rel) !== target) throw Error("Buiten Projects.");
  let current = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    if (restricted(part)) throw Error("Gevoelig of intern pad: niet openen in de werkplek.");
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw Error("Symlinks worden niet gevolgd.");
  }
  if (realpathSync(target) !== target) throw Error("Pad is gewijzigd.");
  return target;
}

export function listFolder(root, path) {
  const target = checkedPath(root, path);
  if (!lstatSync(target).isDirectory()) throw Error("Geen map.");
  const entries = readdirSync(target, { withFileTypes: true });
  if (entries.length > 5000) throw Error("Meer dan 5000 items; open een kleinere map.");
  return entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map(entry => ({ name: entry.name, path: join(target, entry.name), directory: entry.isDirectory(),
      blocked: restricted(entry.name) || entry.isSymbolicLink() || !(entry.isFile() || entry.isDirectory()),
      link: entry.isSymbolicLink() }));
}

export function readDocument(root, path) {
  const target = checkedPath(root, path);
  if (!lstatSync(target).isFile()) throw Error("Alleen gewone bestanden.");
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw Error("Alleen gewone bestanden zonder hardlinks.");
    if (stat.size > MAX_FILE_BYTES) throw Error("Bestand groter dan 512 KiB.");
    const bytes = readFileSync(fd);
    if (bytes.length > MAX_FILE_BYTES) throw Error("Bestand groter dan 512 KiB.");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw Error("Binair bestand of terminalbesturing: niet bewerkbaar.");
    return { path: target, text, bytes, mode: stat.mode, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs };
  } finally { closeSync(fd); }
}

export function saveDocument(root, original, text) {
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw Error("Bestand groter dan 512 KiB.");
  const current = readDocument(root, original.path);
  if (current.dev !== original.dev || current.ino !== original.ino || current.mtimeMs !== original.mtimeMs || !current.bytes.equals(original.bytes))
    throw Error("Conflict: bestand is op schijf gewijzigd. Je concept blijft behouden; open opnieuw na afstemming.");
  const temp = join(dirname(current.path), "." + basename(current.path) + ".workspace-" + randomUUID());
  let fd;
  try {
    fd = openSync(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, current.mode & 0o777);
    fchmodSync(fd, current.mode & 0o777);
    writeFileSync(fd, text, "utf8"); fsyncSync(fd); closeSync(fd); fd = undefined;
    // Revalidate after writing, immediately before the atomic replacement.
    const latest = readDocument(root, current.path);
    if (latest.ino !== current.ino || latest.mtimeMs !== current.mtimeMs || !latest.bytes.equals(current.bytes))
      throw Error("Conflict tijdens opslaan; concept behouden.");
    renameSync(temp, current.path);
    return readDocument(root, current.path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function projectFor(root, path) {
  const target = checkedPath(root, path);
  const first = relative(realpathSync(root), target).split(sep)[0];
  if (!first) throw Error("Selecteer een project onder Projects.");
  const project = checkedPath(root, first);
  if (!lstatSync(project).isDirectory()) throw Error("Selecteer een projectmap.");
  return project;
}

// Edits preserve tabs, BOM and existing line endings. No prompt-editor normalization.
export class TextBuffer {
  constructor(text = "") { this.text = text; this.cursor = 0; this.undoStack = []; }
  replace(start, end, value) {
    if (Buffer.byteLength(this.text) + Buffer.byteLength(value) > MAX_FILE_BYTES) throw Error("Concept te groot.");
    this.undoStack.push({ text: this.text, cursor: this.cursor });
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.text = this.text.slice(0, start) + value + this.text.slice(end);
    this.cursor = start + value.length;
  }
  insert(value) { this.replace(this.cursor, this.cursor, value); }
  undo() { const old = this.undoStack.pop(); if (old) Object.assign(this, old); }
  previous() {
    if (this.text.slice(this.cursor - 2, this.cursor) === "\r\n") return this.cursor - 2;
    const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(this.text.slice(0, this.cursor))];
    return parts.at(-1)?.index ?? 0;
  }
  next() {
    if (this.text.slice(this.cursor, this.cursor + 2) === "\r\n") return this.cursor + 2;
    const part = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(this.text.slice(this.cursor))[Symbol.iterator]().next().value;
    return this.cursor + (part?.segment.length ?? 0);
  }
  lineStart() { return this.cursor === 0 ? 0 : this.text.lastIndexOf("\n", this.cursor - 1) + 1; }
  lineEnd() { const end = this.text.indexOf("\n", this.cursor); return end < 0 ? this.text.length : end - (this.text[end - 1] === "\r" ? 1 : 0); }
  vertical(direction) {
    const start = this.lineStart(), col = this.cursor - start;
    if (direction < 0 && start > 0) {
      const end = start - (this.text[start - 2] === "\r" ? 2 : 1);
      const previous = this.text.lastIndexOf("\n", start - 2) + 1;
      this.cursor = Math.min(previous + col, end);
    } else if (direction > 0) {
      const next = this.text.indexOf("\n", this.cursor);
      if (next < 0) return;
      const end = this.text.indexOf("\n", next + 1);
      this.cursor = Math.min(next + 1 + col, end < 0 ? this.text.length : end - (this.text[end - 1] === "\r" ? 1 : 0));
    }
    // Never leave a cursor in the middle of a surrogate pair.
    if (/[\uDC00-\uDFFF]/.test(this.text[this.cursor] ?? "")) this.cursor--;
  }
}
