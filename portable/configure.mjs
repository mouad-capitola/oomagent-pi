// Generate machine-local configuration. Credentials and user edits are never overwritten.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export function configuration(root) {
  const state = join(root, ".portable");
  const extensions = readdirSync(join(root, ".pi/extensions"))
    .filter(name => name.endsWith(".ts") && name !== "oomagent-ui.ts")
    .sort().map(name => join(root, ".pi/extensions", name));
  return {
    settings: {
      defaultProvider: "openai-codex", defaultModel: "gpt-6-astra", defaultThinkingLevel: "xhigh",
      hideThinkingBlock: true, quietStartup: false, tuiMode: "fullscreen", theme: "oomagent-swiss",
      extensions: ["-builtin:codemode", ...extensions, join(root, "portable/footer.ts")],
      defaultTools: ["+read", "+bash", "+edit", "+write", "+grep", "+find", "+ls", "+tool_search", "-codemode"],
      skills: [join(root, ".pi/skills")], prompts: [join(root, ".pi/prompts")], themes: [join(root, ".pi/themes")],
    },
    mcp: {
      autoEnableCodemode: false,
      mcpServers: {
        "oomagent-test": {
          command: join(state, "python/bin/python"), args: [join(root, "scripts/test-mcp.py")], exposure: "deferred",
          description: "Lokale MCP-testserver met een hello-tool",
        },
        lightpanda: {
          command: join(state, "bin/lightpanda"), args: ["mcp", "--block-private-networks", "--obey-robots"], exposure: "deferred",
          description: "Lightpanda-browser: webpagina's bezoeken, lezen en bedienen",
        },
        serena: {
          command: join(state, "python/bin/serena"),
          args: ["start-mcp-server", "--context", "ide", "--transport", "stdio", "--enable-web-dashboard", "false", "--enable-gui-log-window", "false", "--open-web-dashboard", "false"],
          exposure: "deferred", timeout: 120,
          description: "Serena: semantische codeanalyse en bewerking via taalservers",
        },
        playwright: {
          command: join(state, "browser/node_modules/.bin/playwright-mcp"),
          args: ["--config", join(root, ".pi/playwright-mcp.json")], exposure: "deferred",
          description: "Playwright met een apart browserprofiel; geen gekopieerde browserlogin. Vereist WSLg voor het zichtbare venster.",
        },
        zap: {
          url: "http://127.0.0.1:8282/",
          headers: { Authorization: "!python3 " + shellQuote(join(root, "portable/zap-key.py")) }, exposure: "deferred",
          description: "Lokale ZAP securitytests en scanresultaten. Start scans alleen met expliciete toestemming voor het doelwit.",
        },
      },
    },
  };
}

export function createOnce(path, content, mode = 0o600) {
  try { writeFileSync(path, content, { flag: "wx", mode }); return true; }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("Refusing unsafe existing config: " + path);
    return false;
  }
}

export function configure(root, home = homedir()) {
  const state = join(root, ".portable");
  for (const path of [state, join(state, "agent"), join(state, "state"), join(state, "bin")]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (lstatSync(path).isSymbolicLink()) throw new Error("Refusing state symlink.");
  }
  const { settings, mcp } = configuration(root);
  for (const [name, data] of [["settings", settings], ["mcp", mcp]]) {
    createOnce(join(state, "agent", name + ".json"), JSON.stringify(data, null, 2) + "\n");
  }
  createOnce(join(state, "agent/APPEND_SYSTEM.md"), readFileSync(join(root, ".pi/system-prompt.md")));
  createOnce(join(state, "state/local.env"), "# Optional, private shell configuration. Never commit this file.\n# EXA_API_KEY='your-key-here'\n");
  // Keep original TUIOS defaults and preserve any existing Windows/WSL configuration.
  const tuios = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "tuios");
  mkdirSync(tuios, { recursive: true, mode: 0o700 });
  createOnce(join(tuios, "config.toml"), readFileSync(join(root, "portable/tuios.toml")));
  for (const name of ["pi", "tuios", "tools"]) {
    const destination = join(state, "bin", name);
    createOnce(destination, "#!/bin/sh\nexec bash " + shellQuote(join(root, name)) + ' "$@"\n', 0o700);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  configure(fileURLToPath(new URL("../", import.meta.url)));
}
