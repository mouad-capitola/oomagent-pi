import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
const testName = /\.(test|spec)\.(mjs|cjs|js)$/;

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "test_runner",
    label: "Test runner",
    description: "Run Node.js built-in tests (.test/.spec.js, .mjs or .cjs), defaulting to the tests directory. Accepts a project-relative file or directory. No shell commands or package installation. Tests execute trusted project code with Pi's OS permissions and may modify files; this is NOT a sandbox. Symlink paths are blocked. Returns output, exit code, and timeout state.",
    parameters: Type.Object({
      test_path: Type.Optional(Type.String({ minLength: 1, description: "Project-relative test file or directory; default 'tests'" })),
      timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 120, description: "Time limit; default 30 seconds" })),
    }, { additionalProperties: false }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async execute(_id, { test_path = "tests", timeout_seconds = 30 }, signal, _update, ctx) {
      try {
        signal?.throwIfAborted();
        if (isAbsolute(test_path) || win32.isAbsolute(test_path) || test_path.includes("\0") || test_path.split(/[\\/]/).includes("..")) {
          throw new Error("test_runner: test_path must be project-relative without '..' or null bytes.");
        }
        const root = await realpath(ctx.cwd);
        const requested = resolve(root, test_path);
        if (!within(root, requested)) throw new Error("test_runner: path is outside the project.");
        let component = root;
        for (const part of relative(root, requested).split(sep).filter(Boolean)) {
          component = resolve(component, part);
          if ((await lstat(component)).isSymbolicLink()) throw new Error("test_runner: symlink paths are blocked.");
        }
        const files: string[] = [];
        const pending = [requested];
        while (pending.length) {
          signal?.throwIfAborted();
          const path = pending.pop()!;
          const stat = await lstat(path);
          if (stat.isSymbolicLink()) continue;
          const canonical = await realpath(path);
          if (!within(root, canonical)) throw new Error("test_runner: path moved outside the project.");
          if (stat.isDirectory()) {
            const entries = await readdir(canonical, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name === ".git" || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
              pending.push(resolve(canonical, entry.name));
            }
          } else if (stat.isFile() && testName.test(path)) files.push(canonical);
          if (files.length > 500) throw new Error("test_runner: more than 500 tests; choose a narrower directory.");
        }
        if (!files.length) throw new Error("test_runner: no supported test files found; use *.test.mjs, *.test.cjs or *.test.js (also *.spec.*).");
        files.sort();
        let stdout = "";
        let stderr = "";
        let exitCode: number | null = 0;
        let timedOut = false;
        let outputLimitExceeded = false;
        try {
          const result = await execFileAsync(process.execPath, ["--test", ...files], {
            cwd: root,
            signal,
            timeout: timeout_seconds * 1000,
            killSignal: "SIGKILL",
            maxBuffer: 1024 * 1024,
            env: { ...process.env, FORCE_COLOR: "0", NODE_OPTIONS: "" },
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (error) {
          if (signal?.aborted) throw error;
          const failure = error as Error & {
            code?: number | string; killed?: boolean; signal?: string;
            stdout?: string; stderr?: string;
          };
          if (typeof failure.code !== "number" && !failure.killed && failure.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") throw error;
          stdout = failure.stdout || "";
          stderr = failure.stderr || "";
          exitCode = typeof failure.code === "number" ? failure.code : null;
          outputLimitExceeded = failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          timedOut = Boolean(failure.killed && !outputLimitExceeded);
        }
        const passed = exitCode === 0 && !timedOut && !outputLimitExceeded;
        const details = {
          testPath: test_path,
          files: files.map(path => relative(root, path).split(sep).join("/")),
          exitCode, passed, timedOut, outputLimitExceeded, stdout, stderr,
        };
        const output = `Tests ${passed ? "passed" : "failed"}; exit code: ${exitCode ?? "none"}.`
          + (timedOut ? " Time limit exceeded." : "")
          + (outputLimitExceeded ? " Output limit exceeded." : "")
          + `\n\n${stdout}${stderr ? `\n${stderr}` : ""}`;
        return {
          isError: !passed,
          content: [{ type: "text", text: output.length > 50000 ? output.slice(0, 50000) + "\n[Output shortened; full captured output is in details.]" : output }],
          details,
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") throw new Error("test_runner: test path or working directory does not exist.");
        if (code === "EACCES" || code === "EPERM") throw new Error("test_runner: permission denied.");
        if (error instanceof Error && error.message.startsWith("test_runner:")) throw error;
        throw new Error(`test_runner: cannot run tests: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  }));
}
