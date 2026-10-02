import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "project_info",
    label: "Project info",
    description: "Summarize project structure (two levels, maximum 200 entries) and local Git information: branch, repository root, working-tree status, upstream, remote names, and latest commit. Does not read file contents or contact remotes. .git and node_modules contents are omitted. Unavailable Git values are null.",
    parameters: Type.Object({}),
    outputSchema: Type.Object({
      cwd: Type.String(),
      branch: Type.Union([Type.String(), Type.Null()]),
      repositoryRoot: Type.Union([Type.String(), Type.Null()]),
      structure: Type.Array(Type.Object({
        path: Type.String(),
        type: Type.String(),
      })),
      structureTruncated: Type.Boolean(),
      warnings: Type.Array(Type.String()),
      git: Type.Object({
        status: Type.Union([Type.String(), Type.Null()]),
        clean: Type.Union([Type.Boolean(), Type.Null()]),
        upstream: Type.Union([Type.String(), Type.Null()]),
        remotes: Type.Array(Type.String()),
        latestCommit: Type.Union([Type.String(), Type.Null()]),
      }),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      async function gitValue(args: string[]): Promise<string | null> {
        try {
          const { stdout } = await execFileAsync("git", args, {
            cwd: ctx.cwd,
            signal,
            timeout: 5000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
          });
          return stdout.trim();
        } catch (error) {
          if (signal?.aborted) throw error;
          return null;
        }
      }

      const [branch, repositoryRoot] = await Promise.all([
        gitValue(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        gitValue(["rev-parse", "--show-toplevel"]),
      ]);
      const warnings: string[] = [];
      const structure: { path: string; type: string }[] = [];
      let structureTruncated = false;
      const pending = [{ path: "", depth: 0 }];
      while (pending.length && !structureTruncated) {
        signal?.throwIfAborted();
        const directory = pending.shift()!;
        try {
          const children = await readdir(resolve(ctx.cwd, directory.path), { withFileTypes: true });
          children.sort((a, b) => a.name.localeCompare(b.name));
          for (const child of children) {
            if (structure.length >= 200) { structureTruncated = true; break; }
            const path = directory.path ? `${directory.path}/${child.name}` : child.name;
            const type = child.isSymbolicLink() ? "symlink" : child.isDirectory() ? "directory" : child.isFile() ? "file" : "other";
            structure.push({ path, type });
            if (type === "directory" && directory.depth < 1 && child.name !== ".git" && child.name !== "node_modules") {
              pending.push({ path, depth: directory.depth + 1 });
            }
          }
        } catch {
          if (signal?.aborted) signal.throwIfAborted();
          warnings.push(`Cannot list directory: ${directory.path || "."}`);
        }
      }
      const [status, upstream, remotes, latestCommit] = repositoryRoot
        ? await Promise.all([
          gitValue(["status", "--short", "--untracked-files=normal"]),
          gitValue(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
          gitValue(["remote"]),
          gitValue(["--no-pager", "log", "-1", "--no-color", "--format=%h | %aI | %an | %s"]),
        ]) : [null, null, null, null];
      if (!repositoryRoot) warnings.push("Git repository information is unavailable.");
      const info = {
        cwd: ctx.cwd,
        branch,
        repositoryRoot,
        structure,
        structureTruncated,
        warnings,
        git: {
          status,
          clean: status === null ? null : status === "",
          upstream,
          remotes: remotes ? remotes.split("\n") : [],
          latestCommit,
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        details: info,
        structuredContent: info,
      };
    },
  }));
}
