import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "project_info",
    label: "Project info",
    description: "Return the current working directory, Git branch, and Git repository root. Unavailable Git values are null.",
    parameters: Type.Object({}),
    outputSchema: Type.Object({
      cwd: Type.String(),
      branch: Type.Union([Type.String(), Type.Null()]),
      repositoryRoot: Type.Union([Type.String(), Type.Null()]),
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
          });
          return stdout.trim() || null;
        } catch (error) {
          if (signal?.aborted) throw error;
          return null;
        }
      }

      const [branch, repositoryRoot] = await Promise.all([
        gitValue(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        gitValue(["rev-parse", "--show-toplevel"]),
      ]);
      const info = { cwd: ctx.cwd, branch, repositoryRoot };
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
        details: info,
        structuredContent: info,
      };
    },
  }));
}
