import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

type StatusEntry = {
  path: string;
  originalPath?: string;
  indexStatus: string;
  workingTreeStatus: string;
  untracked: boolean;
  conflict: boolean;
};

export function parseStatus(output: string): { branchSummary: string; files: StatusEntry[] } {
  const records = output.split("\0");
  const header = records.shift();
  if (!header?.startsWith("## ")) throw new Error("git_status: unexpected Git status format.");
  const files: StatusEntry[] = [];
  const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    const status = record.slice(0, 2);
    const entry: StatusEntry = {
      path: record.slice(3),
      indexStatus: status[0],
      workingTreeStatus: status[1],
      untracked: status === "??",
      conflict: conflicts.has(status),
    };
    // With -z, rename/copy records contain destination followed by original path.
    if (status.includes("R") || status.includes("C")) {
      const originalPath = records[++i];
      if (!originalPath) throw new Error("git_status: incomplete rename/copy record.");
      entry.originalPath = originalPath;
    }
    files.push(entry);
  }
  return { branchSummary: header.slice(3), files };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "git_status",
    label: "Git status",
    description: "Show local Git status: branch/upstream summary, staged and unstaged changes, untracked files, and conflicts. Includes individual untracked files; ignores Git-ignored files. Paths are relative to the repository root. Read-only, no file contents or remote network requests.",
    parameters: Type.Object({}, { additionalProperties: false }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(_id, _params, signal, _update, ctx) {
      async function git(args: string[]) {
        return execFileAsync("git", ["--no-pager", ...args], {
          cwd: ctx.cwd,
          signal,
          timeout: 10000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
        });
      }
      try {
        signal?.throwIfAborted();
        const { stdout: root } = await git(["rev-parse", "--show-toplevel"]);
        const { stdout } = await git(["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all"]);
        const { branchSummary, files } = parseStatus(stdout);
        const info = {
          repositoryRoot: root.trimEnd(),
          branchSummary,
          clean: files.length === 0,
          counts: {
            total: files.length,
            staged: files.filter(file => !file.untracked && !file.conflict && file.indexStatus !== " ").length,
            unstaged: files.filter(file => !file.untracked && !file.conflict && file.workingTreeStatus !== " ").length,
            untracked: files.filter(file => file.untracked).length,
            conflicts: files.filter(file => file.conflict).length,
          },
          files,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
          details: info,
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        const failure = error as NodeJS.ErrnoException & { stderr?: string };
        if (failure.code === "ENOENT") throw new Error("git_status: Git is not installed or the working directory does not exist.");
        if (failure.stderr?.includes("not a git repository")) throw new Error("git_status: the current project is not a Git repository.");
        if (error instanceof Error && error.message.startsWith("git_status:")) throw error;
        throw new Error(`git_status: cannot read status: ${failure.stderr?.trim() || (error instanceof Error ? error.message : String(error))}`);
      }
    },
  }));
}
