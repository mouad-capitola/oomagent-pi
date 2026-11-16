import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Official Lightpanda 1.0.4 image, pinned to the verified manifest.
export const LIGHTPANDA_IMAGE = "lightpanda/browser@sha256:a9d899882899802bc3a6b82622a7ca394f8e1b828452869a0965d2e5097e6116";

export function lightpandaCommand(args, platform = process.platform, home = homedir()) {
  if (platform === "win32") {
    return {
      command: "docker",
      args: ["run", "--rm", "--interactive", "--pull=never", "--env", "LIGHTPANDA_DISABLE_TELEMETRY=true", LIGHTPANDA_IMAGE, "/bin/lightpanda", ...args],
    };
  }
  return { command: join(home, ".local", "bin", "lightpanda"), args };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { command, args } = lightpandaCommand(process.argv.slice(2));
  const child = spawn(command, args, {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, LIGHTPANDA_DISABLE_TELEMETRY: "true" },
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
  child.once("error", () => {
    console.error("Cannot start Lightpanda. Check the native binary or Docker Desktop and the pinned image.");
    process.exitCode = 1;
  });
  child.once("exit", code => { process.exitCode = code ?? 1; });
}
