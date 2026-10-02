import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "git_log",
    label: "Git log",
    description: "Show recent commits reachable from HEAD in the current project's Git repository. Read-only; defaults to 20 commits (maximum 100). Reports an empty history when the current branch has no commits.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Number of commits to show; default 20" })),
    }, { additionalProperties: false }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(_toolCallId, { limit = 20 }, signal, _onUpdate, ctx) {
      async function git(args: string[]) {
        return execFileAsync("git", ["--no-pager", ...args], {
          cwd: ctx.cwd,
          signal,
          timeout: 10000,
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
        });
      }
      try {
        signal?.throwIfAborted();
        const { stdout: root } = await git(["rev-parse", "--show-toplevel"]);
        const repositoryRoot = root.trim();
        let output: string;
        try {
          const result = await git([
            "log", `--max-count=${limit}`, "--no-color", "--no-decorate",
            "--format=%h | %aI | %an | %s", "HEAD", "--",
          ]);
          output = result.stdout.trimEnd();
        } catch (error) {
          if (signal?.aborted) throw error;
          // Only treat a missing branch ref as empty history; other failures remain errors.
          const { stdout: branchRef } = await git(["symbolic-ref", "--quiet", "HEAD"]);
          try {
            await git(["show-ref", "--verify", "--quiet", branchRef.trim()]);
          } catch (refError) {
            if ((refError as { code?: number }).code === 1) {
              return {
                content: [{ type: "text", text: "This branch has no commits yet." }],
                details: { repositoryRoot, limit, commitCount: 0, empty: true },
              };
            }
            throw refError;
          }
          throw error;
        }
        return {
          content: [{ type: "text", text: output || "No commits found." }],
          details: {
            repositoryRoot,
            limit,
            commitCount: output ? output.split("\n").length : 0,
            empty: !output,
          },
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        const failure = error as NodeJS.ErrnoException & { stderr?: string };
        if (failure.code === "ENOENT") throw new Error("git_log: Git is not installed or the working directory no longer exists.");
        if (failure.stderr?.includes("not a git repository")) {
          throw new Error("git_log: the current project is not a Git repository.");
        }
        throw new Error(`git_log: cannot read commit history: ${failure.stderr?.trim() || (error instanceof Error ? error.message : String(error))}`);
      }
    },
  }));
}
