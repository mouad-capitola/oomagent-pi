import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BLOB = 2 * 1024 * 1024;
const FIELD = "[A-Za-z0-9_-]*(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token|bearer[_-]?token)[A-Za-z0-9_-]*";

function git(root, args, input) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      input, maxBuffer: 20 * 1024 * 1024, timeout: 120_000, stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Git errors can include buffered blob contents. Never forward them.
    throw new Error("Security scan unavailable: Git operation failed.");
  }
}

function placeholder(value) {
  return !value || /^(?:<|\$\{|your[-_]|replace[-_]|change[-_]|synthetic|dummy|placeholder|test[-_]|example[-_])/i.test(value);
}

export function privatePath(file) {
  const name = basename(file);
  if ((name.startsWith(".env") || /\.env(?:\.|$)/i.test(name)) && file !== ".env.example") return true;
  return /(?:^|\/)(?:secrets|transcripts)\//.test(file)
    || /(?:^|\/)(?:auth|credentials|user_credentials)\.json$/.test(file)
    || /\.(?:pem|key|p12|pfx|sqlite3?|db)(?:-wal|-shm)?$/i.test(name)
    || /(?:^|\/)output\/.*\.(?:docx|pdf|xlsx)$/i.test(file)
    || /:Zone\.Identifier$/.test(file);
}

export function scanContent(file, buffer) {
  const findings = [];
  const add = (rule, line = 1, variable) => findings.push({ file, line, rule, ...(variable ? { variable } : {}) });
  if (privatePath(file)) add("private-file");
  if (buffer.length > MAX_BLOB) {
    add("oversized-unscanned-file");
    return findings;
  }
  if (buffer.includes(0)) return findings; // Binary media needs separate review.
  const source = buffer.toString("utf8");
  const rules = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["provider-token", /(?:sk-(?:proj-|ant-)?|ghp_|github_pat_|AKIA|AIza)[A-Za-z0-9_-]{20,}/g],
    ["google-oauth-token", /ya29\.[A-Za-z0-9._-]{20,}/g],
    ["jwt-literal", /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g],
  ];
  for (const [rule, pattern] of rules) {
    for (const match of source.matchAll(pattern)) {
      add(rule, source.slice(0, match.index).split("\n").length);
    }
  }
  const assignment = new RegExp('["\']?(' + FIELD + ')["\']?\\s*(?:[:=]|,)[ \\t]*["\']([^"\'\\r\\n]+)["\']', "gi");
  const environment = new RegExp("^\\s*(" + FIELD + ")\\s*=\\s*([^\\s#]+)", "gim");
  for (const pattern of [assignment, environment]) {
    for (const match of source.matchAll(pattern)) {
      const value = match[2].replace(/^["']|["']$/g, "");
      if (value.length < 20 || placeholder(value)) continue;
      // Opaque literals, rather than readable synthetic labels or variable names.
      if (!/^[a-f0-9]{32,}$/i.test(value)
          && !(value.length >= 24 && /^[A-Za-z0-9_./+=-]+$/.test(value) && /[0-9]/.test(value) && /[A-Za-z]/.test(value))) continue;
      add("credential-literal", source.slice(0, match.index).split("\n").length, match[1]);
    }
  }
  return findings.filter((f, i) => findings.findIndex(x => x.file === f.file && x.line === f.line && x.rule === f.rule) === i);
}

function readObjects(root, entries) {
  const findings = [];
  let scanned = 0, binary = 0, oversized = 0;
  // Bound both child stdout and in-process buffers; never dump raw blobs.
  for (let start = 0; start < entries.length;) {
    const batch = [];
    let size = 0;
    while (start < entries.length && batch.length < 100) {
      const entry = entries[start];
      if (entry.size > MAX_BLOB) {
        oversized++;
        findings.push({ file: entry.file, object: entry.oid, line: 1, rule: "oversized-unscanned-file" });
        start++;
        continue;
      }
      if (size + entry.size > 8 * 1024 * 1024 && batch.length) break;
      batch.push(entry);
      size += entry.size;
      start++;
    }
    if (!batch.length) continue;
    const output = git(root, ["cat-file", "--batch"], batch.map(e => e.oid).join("\n") + "\n");
    let offset = 0;
    for (const entry of batch) {
      const end = output.indexOf(10, offset);
      const header = output.subarray(offset, end).toString("ascii").split(" ");
      const length = Number(header[2]);
      if (end < 0 || header[0] !== entry.oid || header[1] !== "blob" || !Number.isSafeInteger(length) || length < 0) {
        throw new Error("Security scan unavailable: invalid object response.");
      }
      const content = output.subarray(end + 1, end + 1 + length);
      if (content.length !== length) throw new Error("Security scan unavailable: incomplete object.");
      offset = end + 1 + length + 1;
      scanned++;
      if (content.includes(0)) binary++;
      findings.push(...scanContent(entry.file, content).map(f => ({ ...f, object: entry.oid })));
    }
  }
  return { scanned, binary, oversized, findings };
}

function sizes(root, entries) {
  if (!entries.length) return entries;
  const lines = git(root, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    entries.map(e => e.oid).join("\n") + "\n").toString("utf8").trim().split("\n");
  return entries.flatMap((entry, index) => {
    const [oid, type, length] = lines[index].split(" ");
    if (oid !== entry.oid || !Number.isSafeInteger(Number(length))) throw new Error("Security scan unavailable: object metadata.");
    return type === "blob" ? [{ ...entry, size: Number(length) }] : [];
  });
}

export function scanGitTree(root, revision) {
  const data = git(root, ["ls-tree", "-rz", "--full-tree", revision]).toString("utf8");
  const entries = data.split("\0").filter(Boolean).flatMap(record => {
    const tab = record.indexOf("\t");
    const [mode, type, oid] = record.slice(0, tab).split(" ");
    if (type !== "blob") throw new Error("Security scan cannot approve opaque submodules.");
    const file = record.slice(tab + 1);
    if (mode === "120000") {
      const target = git(root, ["cat-file", "blob", oid]).toString("utf8");
      const destination = resolve(root, file, "..", target);
      if (target.startsWith("/") || !destination.startsWith(resolve(root) + "/")) {
        throw new Error("Security scan blocked an external symlink.");
      }
    }
    return [{ oid, file }];
  });
  return readObjects(root, sizes(root, entries));
}

export function scanGitHistory(root) {
  const data = git(root, ["rev-list", "--objects", "--all"]).toString("utf8");
  const entries = data.split("\n").filter(Boolean).map(line => {
    const space = line.indexOf(" ");
    return { oid: space < 0 ? line : line.slice(0, space), file: space < 0 ? "(unnamed Git object)" : line.slice(space + 1) };
  });
  return readObjects(root, sizes(root, entries));
}

export function scanWorktree(root) {
  const files = [...new Set(git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .toString("utf8").split("\0").filter(Boolean))];
  const findings = [];
  let scanned = 0, binary = 0;
  for (const file of files) {
    const path = resolve(root, file);
    if (!path.startsWith(resolve(root) + "/")) throw new Error("Invalid scan path.");
    let stat;
    try { stat = lstatSync(path); } catch (error) { if (error.code === "ENOENT") continue; throw new Error("Unreadable scan target."); }
    if (stat.isSymbolicLink()) continue; // Git tree checks the link, never follows it.
    if (!stat.isFile()) continue;
    if (privatePath(file)) {
      findings.push({ file, line: 1, rule: "private-file" });
      continue; // Do not open actual local environment/credential files.
    }
    if (stat.size > MAX_BLOB) {
      findings.push({ file, line: 1, rule: "oversized-unscanned-file" });
      continue;
    }
    const content = readFileSync(path);
    scanned++;
    if (content.includes(0)) binary++;
    findings.push(...scanContent(file, content));
  }
  return { scanned, binary, findings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, root, revision] = process.argv.slice(2);
    if (!root || !["--worktree", "--history", "--tree"].includes(mode)) throw new Error("Invalid scan arguments.");
    const result = mode === "--history" ? scanGitHistory(root)
      : mode === "--tree" ? scanGitTree(root, revision || "HEAD") : scanWorktree(root);
    console.log(JSON.stringify(result, null, 2));
    if (result.findings.length) process.exitCode = 1;
  } catch {
    console.error("Security scan failed; no source or credential values were printed.");
    process.exitCode = 2;
  }
}
