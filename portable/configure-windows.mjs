import { mkdirSync, readFileSync, lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuration, createOnce } from "./configure.mjs";

export function windowsConfiguration(root, shellPath) {
  const state = join(root, ".portable/windows");
  const { settings } = configuration(root);
  settings.shellPath = shellPath;
  settings.defaultTools = settings.defaultTools.filter(tool => tool !== "+bash");
  settings.defaultTools.push("-bash", "+powershell");
  settings.extensions = settings.extensions.filter(path => path !== join(root, "portable/footer.ts"));
  settings.extensions.push(join(root, ".pi/extensions/oomagent-ui.ts"));
  const python = join(state, "python/Scripts/python.exe");
  const mcp = { autoEnableCodemode: false, mcpServers: {
    "oomagent-test": { command: python, args: [join(root, "scripts/test-mcp.py")], exposure: "deferred" },
    serena: { command: join(state, "python/Scripts/serena.exe"), args: ["start-mcp-server", "--context", "ide", "--transport", "stdio", "--enable-web-dashboard", "false", "--enable-gui-log-window", "false", "--open-web-dashboard", "false"], exposure: "deferred", timeout: 120 },
    playwright: { command: join(state, "node-v25.6.1-win-x64/node.exe"), args: [join(state, "browser/node_modules/@playwright/mcp/cli.js"), "--config", join(state, "playwright.json")], exposure: "deferred" },
  } };
  const browser = JSON.parse(readFileSync(join(root, ".pi/playwright-mcp.json"), "utf8"));
  browser.outputDir = join(state, "browser-output");
  return { settings, mcp, browser };
}

export function configureWindows(root, shellPath) {
  const state = join(root, ".portable/windows");
  for (const dir of [join(root, ".portable"), state, join(state, "agent")]) {
    mkdirSync(dir, { recursive: true });
    if (lstatSync(dir).isSymbolicLink()) throw new Error("Refusing linked configuration directory.");
  }
  const { settings, mcp, browser } = windowsConfiguration(root, shellPath);
  for (const [file, data] of [["agent/settings.json", settings], ["agent/mcp.json", mcp], ["playwright.json", browser]]) {
    createOnce(join(state, file), JSON.stringify(data, null, 2) + "\n");
  }
  createOnce(join(state, "agent/APPEND_SYSTEM.md"), readFileSync(join(root, ".pi/system-prompt.md")));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Git Bash path required.");
  configureWindows(fileURLToPath(new URL("../", import.meta.url)), process.argv[2]);
}
