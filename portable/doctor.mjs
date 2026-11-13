// Diagnostics never send a model request or run a security scan.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const checks = [
  ["Pi + chat-frame patch", join(root, "pi"), ["--version"]],
  ["TUIOS", join(root, "tuios"), ["--version"]],
  ["Lightpanda", "lightpanda", ["version"]],
  ["Serena", "serena", ["--help"]],
  ["Python", join(root, ".portable/python/bin/python"), ["-c", "import mcp, pypdf, docx, markitdown; print('MCP + document tools OK')"]],
  ["Playwright", join(root, ".portable/browser/node_modules/.bin/playwright"), ["--version"]],
  ["GitHub CLI", "gh", ["--version"]],
  ["Neovim", "nvim", ["--version"]],
  ["ripgrep", "rg", ["--version"]],
  ["Java / ZAP runtime", "java", ["-version"]],
];
let failed = false;
for (const [name, command, args] of checks) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
  const ok = !result.error && result.status === 0;
  console.log(`${ok ? "OK" : "FAIL"} ${name}`);
  if (!ok) failed = true;
}
if (process.argv.includes("--mcp")) {
  const result = spawnSync(join(root, "pi"), ["mcp", "list"], { stdio: "inherit", timeout: 180000 });
  if (result.error || result.status !== 0) failed = true;
}
if (!existsSync(join(root, ".portable/agent/auth.json"))) console.log("SETUP Pi: use /login (credentials are not transferred).");
if (!process.env.EXA_API_KEY) console.log("OPTIONAL Exa: set EXA_API_KEY in .portable/state/local.env to enable web_search.");
console.log("ZAP starts locally with ./pi; scans still require explicit target permission.");
process.exitCode = failed ? 1 : 0;
