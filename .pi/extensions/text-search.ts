import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function excluded(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === ".env" || name.startsWith(".env.");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "text_search",
    label: "Text search",
    description: "Recursively search project UTF-8 text files for a literal string (not regex). Returns project-relative file paths, 1-based line numbers, and matching lines. Skips symlinks, .git, node_modules, .env files, binary files, and files over 1 MiB. Defaults to case-insensitive search and 100 matching lines. Does not modify files.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "Literal text to find within a single line" }),
      directory_path: Type.Optional(Type.String({ minLength: 1, description: "Project-relative directory; default '.'" })),
      case_sensitive: Type.Optional(Type.Boolean({ description: "Match letter case; default false" })),
      max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Maximum matching lines; default 100" })),
    }, { additionalProperties: false }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, { query, directory_path = ".", case_sensitive = false, max_results = 100 }, signal, _update, ctx) {
      if (/\r|\n|\0/.test(query)) throw new Error("text_search: query must be nonempty text on a single line.");
      if (isAbsolute(directory_path) || directory_path.includes("\0") || directory_path.split(/[\\/]/).includes("..")) {
        throw new Error("text_search: directory_path must be relative, without '..' or null bytes.");
      }
      try {
        signal?.throwIfAborted();
        const root = await realpath(ctx.cwd);
        const start = resolve(root, directory_path);
        if (!within(root, start)) throw new Error("text_search: directory is outside the project.");
        let component = root;
        for (const part of relative(root, start).split(sep).filter(Boolean)) {
          if (excluded(part)) throw new Error("text_search: this directory is excluded from searching.");
          component = resolve(component, part);
          if ((await lstat(component)).isSymbolicLink()) throw new Error("text_search: directory paths must not pass through symlinks.");
        }
        if (!(await lstat(start)).isDirectory()) throw new Error("text_search: directory_path is not a directory.");
        const matches: { path: string; line: number; text: string; lineTruncated: boolean }[] = [];
        const warnings: string[] = [];
        const pending = [start];
        const needle = case_sensitive ? query : query.toLowerCase();
        let filesSearched = 0;
        let filesSkipped = 0;
        let truncated = false;
        search: while (pending.length) {
          signal?.throwIfAborted();
          const directory = pending.pop()!;
          const canonical = await realpath(directory);
          if (!within(root, canonical) || (await lstat(directory)).isSymbolicLink()) {
            throw new Error("text_search: directory changed or moved outside the project.");
          }
          const entries = await readdir(canonical, { withFileTypes: true });
          entries.sort((a, b) => a.name.localeCompare(b.name));
          for (const entry of entries) {
            signal?.throwIfAborted();
            if (excluded(entry.name) || entry.isSymbolicLink()) continue;
            const path = resolve(canonical, entry.name);
            if (entry.isDirectory()) { pending.push(path); continue; }
            if (!entry.isFile()) continue;
            const displayPath = relative(root, path).split(sep).join("/");
            try {
              const actual = await realpath(path);
              if (!within(root, actual)) throw new Error("file moved outside project");
              const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
              let bytes: Buffer;
              try {
                const stat = await handle.stat();
                if (!stat.isFile() || stat.size > 1024 * 1024) { filesSkipped++; continue; }
                // Bounded read also protects against files growing after stat().
                const buffer = Buffer.alloc(1024 * 1024 + 1);
                let count = 0;
                while (count < buffer.length) {
                  signal?.throwIfAborted();
                  const read = await handle.read(buffer, count, buffer.length - count, count);
                  if (!read.bytesRead) break;
                  count += read.bytesRead;
                }
                if (count > 1024 * 1024) { filesSkipped++; continue; }
                bytes = buffer.subarray(0, count);
              } finally { await handle.close(); }
              let text: string;
              try {
                if (bytes.includes(0)) { filesSkipped++; continue; }
                text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
              } catch { filesSkipped++; continue; }
              filesSearched++;
              const lines = text.split(/\r\n|\n|\r/);
              for (let i = 0; i < lines.length; i++) {
                if ((case_sensitive ? lines[i] : lines[i].toLowerCase()).includes(needle)) {
                  if (matches.length === max_results) { truncated = true; break search; }
                  matches.push({ path: displayPath, line: i + 1, text: lines[i].slice(0, 500), lineTruncated: lines[i].length > 500 });
                }
              }
            } catch (error) {
              if (signal?.aborted) throw error;
              filesSkipped++;
              if (warnings.length < 20) warnings.push(`Cannot search file: ${displayPath}`);
            }
          }
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ matches, truncated, filesSearched, filesSkipped, warnings }, null, 2) }],
          details: { query, requestedPath: directory_path, resolvedPath: start, caseSensitive: case_sensitive, matches, truncated, filesSearched, filesSkipped, warnings },
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") throw new Error("text_search: directory or an entry no longer exists.");
        if (code === "EACCES" || code === "EPERM") throw new Error("text_search: permission denied reading the directory.");
        if (error instanceof Error && error.message.startsWith("text_search:")) throw error;
        throw new Error(`text_search: search failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  }));
}
