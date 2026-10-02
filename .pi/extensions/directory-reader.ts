import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

type Entry = { path: string; type: "directory" | "file" | "symlink" | "other" };

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "directory_reader",
    label: "Directory reader",
    description: "List a project-relative directory and all subdirectories, including hidden entries. Use directory_path '.' for the project root (Pi's working directory). Returns project-relative paths and entry types, not file contents. Symlinks are listed but never followed. Large text output is shortened; details retains the complete listing.",
    parameters: Type.Object({
      directory_path: Type.String({ minLength: 1, description: "Directory relative to the project root; use '.' for the root" }),
    }, { additionalProperties: false }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(_toolCallId, { directory_path }, signal, _onUpdate, ctx) {
      if (isAbsolute(directory_path) || directory_path.includes("\0") || directory_path.split(/[\\/]/).includes("..")) {
        throw new Error("directory_reader: use a relative path without '..' or null bytes.");
      }
      try {
        signal?.throwIfAborted();
        const root = await realpath(ctx.cwd);
        const requested = resolve(root, directory_path);
        if (!isWithin(root, requested)) throw new Error("directory_reader: path is outside the project.");
        // Reject symlinks in every requested path component.
        let component = root;
        for (const part of relative(root, requested).split(sep).filter(Boolean)) {
          component = resolve(component, part);
          if ((await lstat(component)).isSymbolicLink()) {
            throw new Error("directory_reader: directory paths must not pass through symlinks.");
          }
        }
        const resolvedPath = await realpath(requested);
        if (!isWithin(root, resolvedPath)) throw new Error("directory_reader: path is outside the project.");
        if (!(await lstat(resolvedPath)).isDirectory()) {
          throw new Error(`directory_reader: '${directory_path}' is not a directory.`);
        }

        const entries: Entry[] = [];
        const pending = [resolvedPath];
        while (pending.length) {
          signal?.throwIfAborted();
          const directory = pending.pop()!;
          if ((await lstat(directory)).isSymbolicLink()) {
            throw new Error("directory_reader: directory changed to a symlink during traversal.");
          }
          const canonical = await realpath(directory);
          if (!isWithin(root, canonical)) throw new Error("directory_reader: directory moved outside the project.");
          const children = await readdir(canonical, { withFileTypes: true });
          for (const child of children) {
            signal?.throwIfAborted();
            const path = resolve(canonical, child.name);
            const type: Entry["type"] = child.isSymbolicLink() ? "symlink"
              : child.isDirectory() ? "directory" : child.isFile() ? "file" : "other";
            entries.push({ path: relative(root, path).split(sep).join("/"), type });
            if (type === "directory") pending.push(path);
          }
        }
        entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
        const listing = entries.map(entry => `${entry.type}\t${entry.path}`).join("\n") || "(empty directory)";
        const limit = 50000;
        const truncated = listing.length > limit;
        return {
          content: [{ type: "text", text: truncated
            ? listing.slice(0, limit) + `\n[Output shortened; ${entries.length} entries total. Read a narrower directory for the remaining paths.]`
            : listing }],
          details: {
            requestedPath: directory_path,
            resolvedPath,
            entryCount: entries.length,
            symlinksFollowed: false,
            truncated,
            entries,
          },
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") throw new Error(`directory_reader: '${directory_path}' or an entry within it no longer exists.`);
        if (code === "ENOTDIR") throw new Error(`directory_reader: '${directory_path}' contains a component that is not a directory.`);
        if (code === "EACCES" || code === "EPERM") throw new Error(`directory_reader: permission denied while listing '${directory_path}'.`);
        if (error instanceof Error && error.message.startsWith("directory_reader:")) throw error;
        throw new Error(`directory_reader: cannot list '${directory_path}': ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  }));
}
