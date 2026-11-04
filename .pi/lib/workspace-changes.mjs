import { lstatSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { checkedPath, listFolder, readDocument } from "./workspace-files.mjs";

const ignored = new Set(["node_modules", "vendor", ".venv", "venv", "dist", "build", ".next", "coverage"]);
const MAX_ENTRIES = 4000, MAX_DIRS = 256, MAX_TEXT = 16 * 1024 * 1024;

// Session-local snapshots, never Git's HEAD: compare with the last observed version.
// Polling tolerates atomic saves and dropped filesystem events. Only the active
// project is recursive; other projects are read when their folders are expanded.
export class ChangeTracker {
  constructor(root) {
    this.root = root;
    this.snapshot = new Map();
    this.folders = new Set();
    this.changes = new Map();
    this.warning = "";
  }
  poll(scopes) {
    const next = new Map(), folders = new Set(), events = [];
    let bytes = 0, entries = 0;
    this.warning = "";
    const visit = (path, recursive, newFolder = false) => {
      if (folders.has(path)) return;
      if (folders.size >= MAX_DIRS || entries >= MAX_ENTRIES) {
        this.warning = "Live-limiet bereikt; open een kleinere projectmap.";
        return;
      }
      let rows;
      try { path = checkedPath(this.root, path); rows = listFolder(this.root, path); }
      catch { this.warning = "Een live-map is niet bereikbaar; vorige vergelijking blijft bewaard."; return; }
      folders.add(path);
      for (const row of rows) {
        if (++entries > MAX_ENTRIES) { this.warning = "Live-limiet bereikt; open een kleinere projectmap."; break; }
        if (row.blocked || ignored.has(row.name)) continue;
        try {
          const stat = lstatSync(checkedPath(this.root, row.path));
          const signature = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode].join(":");
          const old = this.snapshot.get(row.path);
          let text;
          if (!row.directory) {
            if (old?.signature === signature) text = old.text;
            else if (stat.size <= 512 * 1024 && bytes + stat.size <= MAX_TEXT) {
              try { text = readDocument(this.root, row.path).text; } catch { /* Metadata only for unsafe/unsupported files. */ }
            }
            if (text === undefined && stat.size <= 512 * 1024 && bytes + stat.size > MAX_TEXT)
              this.warning = "Live-tekstlimiet bereikt; sommige bestanden hebben alleen metadata.";
            if (text !== undefined) {
              bytes += Buffer.byteLength(text);
              if (bytes > MAX_TEXT) { text = undefined; this.warning = "Live-tekstlimiet bereikt; sommige bestanden hebben alleen metadata."; }
            }
          }
          const item = { ...row, signature, text };
          next.set(row.path, item);
          if (!old && (this.folders.has(path) || newFolder)) events.push({ path: row.path, kind: "nieuw", before: row.directory ? undefined : "", after: text });
          else if (old && !row.directory && old.signature !== signature && (old.text === undefined || text === undefined || old.text !== text))
            events.push({ path: row.path, kind: "gewijzigd", before: old.text, after: text });
          if (recursive && row.directory) visit(row.path, true, !old && (this.folders.has(path) || newFolder));
        } catch (error) {
          if (error.code !== "ENOENT") this.warning = "Een live-bestand is niet bereikbaar; geen verwijdering aangenomen.";
        }
      }
    };
    // Parent scopes first to avoid treating baseline files as newly created.
    for (const scope of scopes) visit(scope.path, scope.recursive);
    // Do not claim deletion when scanning was incomplete or inaccessible.
    if (!this.warning) for (const [path, old] of this.snapshot) {
      if (!next.has(path) && folders.has(dirname(path)))
        events.push({ path, kind: "verwijderd", before: old.text, after: old.directory ? undefined : "" });
    }
    for (const event of events) {
      this.changes.delete(event.path);
      this.changes.set(event.path, { ...event, at: Date.now() });
    }
    // Bound retained history and its text independently of the baseline.
    let retained = 0;
    for (const [path, change] of [...this.changes].reverse()) {
      retained += Buffer.byteLength(change.before ?? "") + Buffer.byteLength(change.after ?? "");
      if (retained > MAX_TEXT) this.changes.delete(path);
    }
    while (this.changes.size > 100) this.changes.delete(this.changes.keys().next().value);
    // Dropping an unobserved scope also drops its baseline, avoiding stale
    // snapshots and unbounded retention when browsing many projects.
    this.snapshot = next;
    this.folders = folders;
    return events;
  }
  marker(path) {
    const change = this.changes.get(path);
    if (change) return change.kind === "nieuw" ? "+" : change.kind === "verwijderd" ? "−" : "~";
    for (const changed of this.changes.keys()) {
      const rel = relative(path, changed);
      if (rel && rel !== ".." && !rel.startsWith(".." + sep) && !rel.startsWith(sep)) return "•";
    }
    return "";
  }
}

// Linear, bounded comparison: one changed block, with unchanged prefix/suffix.
// New code comes FIRST, old code second; no quadratic work on large files.
export function changeLines(change) {
  if (!change) return [];
  if (change.before === undefined || change.after === undefined)
    return [{ kind: "info", text: "Alleen metadata beschikbaar; geen veilige tekstvergelijking." }];
  const old = change.before === "" ? [] : change.before.split("\n");
  const now = change.after === "" ? [] : change.after.split("\n");
  let start = 0, end = 0;
  while (start < old.length && start < now.length && old[start] === now[start]) start++;
  while (end < old.length - start && end < now.length - start && old[old.length - 1 - end] === now[now.length - 1 - end]) end++;
  if (start === old.length && start === now.length) return [{ kind: "info", text: "Geen tekstverschil (alleen metadata)." }];
  return [
    { kind: "info", text: "@@ vanaf regel " + (start + 1) + " · nieuw boven / oud onder @@" },
    ...now.slice(start, now.length - end).map((text, i) => ({ kind: "new", line: start + i + 1, text })),
    ...old.slice(start, old.length - end).map((text, i) => ({ kind: "old", line: start + i + 1, text })),
  ];
}
