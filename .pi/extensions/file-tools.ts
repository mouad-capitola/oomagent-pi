import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

async function projectPath(cwd: string, requested: string): Promise<string> {
  if (!requested || isAbsolute(requested) || requested.includes("\0") || requested.split(/[\\/]/).includes("..")) {
    throw new Error("Use a project-relative file path without '..' or null bytes.");
  }
  const root = await realpath(cwd);
  const path = resolve(root, requested);
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("File path must be inside the project.");
  const parts = rel.split(sep);
  if (parts.some(part => part === ".git" || part === ".env" || part.startsWith(".env."))) {
    throw new Error("Changes to .git and .env files are blocked.");
  }
  let component = root;
  for (const [index, part] of parts.entries()) {
    component = resolve(component, part);
    try {
      const stat = await lstat(component);
      if (stat.isSymbolicLink()) throw new Error("Symlinks are not allowed in file paths.");
      if (index < parts.length - 1 && !stat.isDirectory()) throw new Error("Parent path is not a directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && index === parts.length - 1) break;
      throw error;
    }
  }
  return path;
}

function failure(tool: string, error: unknown): Error {
  const code = (error as NodeJS.ErrnoException).code;
  const message = code === "ENOENT" ? "File or parent directory does not exist."
    : code === "EEXIST" ? "File already exists; use file_editor to change it."
    : code === "EISDIR" ? "Path points to a directory."
    : code === "EACCES" || code === "EPERM" ? "Permission denied."
    : error instanceof Error ? error.message : String(error);
  return new Error(`${tool}: ${message}`);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "file_writer",
    label: "File writer",
    description: "Create a new UTF-8 file inside the project. Never overwrites existing files. Parent directories must exist. Symlink paths, .git, and .env files are blocked.",
    parameters: Type.Object({
      file_path: Type.String({ minLength: 1 }),
      content: Type.String({ description: "Complete UTF-8 contents for the new file" }),
    }, { additionalProperties: false }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async execute(_id, { file_path, content }, signal, _update, ctx) {
      try {
        const path = await projectPath(ctx.cwd, file_path);
        return await withFileMutationQueue(path, async () => {
          signal?.throwIfAborted();
          await projectPath(ctx.cwd, file_path);
          const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try { await handle.writeFile(content, "utf8"); }
          catch (error) { await unlink(path); throw error; }
          finally { await handle.close(); }
          return {
            content: [{ type: "text", text: `Created ${file_path}` }],
            details: { requestedPath: file_path, resolvedPath: path, sizeBytes: Buffer.byteLength(content, "utf8") },
          };
        });
      } catch (error) { if (signal?.aborted) throw error; throw failure("file_writer", error); }
    },
  }));

  pi.registerTool(defineTool({
    name: "file_editor",
    label: "File editor",
    description: "Replace exactly one literal occurrence of old_text with new_text in an existing UTF-8 project file (maximum 1 MiB). Fails if there are zero or multiple matches. Uses atomic replacement, preserving permission bits. Symlink paths, .git, and .env files are blocked.",
    parameters: Type.Object({
      file_path: Type.String({ minLength: 1 }),
      old_text: Type.String({ minLength: 1, description: "Exact, unique text to replace" }),
      new_text: Type.String({ description: "Replacement text; empty string deletes the match" }),
    }, { additionalProperties: false }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    async execute(_id, { file_path, old_text, new_text }, signal, _update, ctx) {
      try {
        const path = await projectPath(ctx.cwd, file_path);
        return await withFileMutationQueue(path, async () => {
          signal?.throwIfAborted();
          await projectPath(ctx.cwd, file_path);
          const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          let text: string;
          let mode: number;
          try {
            const stat = await handle.stat();
            if (!stat.isFile()) throw new Error("Path is not a regular file.");
            if (stat.size > 1024 * 1024) throw new Error("File exceeds the 1 MiB editing limit.");
            mode = stat.mode & 0o777;
            const bytes = await handle.readFile({ signal });
            if (bytes.length > 1024 * 1024 || bytes.includes(0)) throw new Error("File is too large or contains binary data.");
            text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
          } finally { await handle.close(); }
          const index = text.indexOf(old_text);
          if (index < 0) throw new Error("old_text was not found; file unchanged.");
          if (text.indexOf(old_text, index + 1) >= 0) throw new Error("old_text occurs multiple times; provide a more specific match.");
          const updated = text.slice(0, index) + new_text + text.slice(index + old_text.length);
          const temporary = resolve(dirname(path), `.pi-edit-${randomUUID()}.tmp`);
          try {
            const temp = await open(temporary, "wx", 0o600);
            try {
              await temp.writeFile(updated, "utf8");
              await temp.chmod(mode);
            } finally { await temp.close(); }
            signal?.throwIfAborted();
            await projectPath(ctx.cwd, file_path);
            await rename(temporary, path);
          } finally {
            await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
          }
          return {
            content: [{ type: "text", text: `Edited ${file_path}: replaced one occurrence.` }],
            details: { requestedPath: file_path, resolvedPath: path, replacements: 1, sizeBytes: Buffer.byteLength(updated, "utf8") },
          };
        });
      } catch (error) { if (signal?.aborted) throw error; throw failure("file_editor", error); }
    },
  }));
}
