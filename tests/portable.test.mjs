import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { configuration, configure, createOnce, shellQuote } from "../portable/configure.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
test("portable profile resolves every resource without a Mac path or project dependency", () => {
  const { settings, mcp } = configuration(root);
  for (const path of [...settings.extensions, ...settings.skills, ...settings.prompts, ...settings.themes]) {
    if (!path.startsWith("-builtin:")) assert.ok(existsSync(path), path);
  }
  assert.equal(settings.defaultThinkingLevel, "xhigh");
  assert.ok(settings.extensions.includes("-builtin:codemode"));
  assert.equal(mcp.autoEnableCodemode, false);
  assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ["lightpanda", "oomagent-test", "playwright", "serena", "zap"]);
  assert.equal(mcp.mcpServers.zap.url, "http://127.0.0.1:8282/");
  assert.ok(mcp.mcpServers.zap.headers.Authorization.startsWith("!python3 "));
  for (const server of Object.values(mcp.mcpServers)) assert.equal(server.exposure, "deferred");
  assert.ok(mcp.mcpServers.lightpanda.args.includes("--block-private-networks"));
});

test("configuration is idempotent, leaves credentials/settings intact and creates no Projects", t => {
  const temp = mkdtempSync(join(tmpdir(), "portable user's checkout "));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const checkout = join(temp, "pi with spaces"), home = join(temp, "home");
  for (const dir of [".pi/extensions", "portable", ".portable/agent", "home"]) mkdirSync(join(checkout, dir), { recursive: true });
  writeFileSync(join(checkout, ".pi/extensions/example.ts"), "export default function() {}\n");
  writeFileSync(join(checkout, ".pi/system-prompt.md"), "Instructions\n");
  writeFileSync(join(checkout, "portable/tuios.toml"), "[startup]\ndaemon = false\n");
  const env = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
  t.after(() => { if (env !== undefined) process.env.XDG_CONFIG_HOME = env; });
  configure(checkout, home);
  const settingsPath = join(checkout, ".portable/agent/settings.json");
  writeFileSync(settingsPath, '{"custom":"keep"}');
  const auth = join(checkout, ".portable/agent/auth.json");
  writeFileSync(auth, "synthetic-credential-marker");
  configure(checkout, home);
  assert.equal(readFileSync(settingsPath, "utf8"), '{"custom":"keep"}');
  assert.equal(readFileSync(auth, "utf8"), "synthetic-credential-marker");
  assert.equal(existsSync(join(home, "Projects")), false);
  const wrapper = readFileSync(join(checkout, ".portable/bin/pi"), "utf8");
  assert.match(wrapper, /exec bash/);
  const quoted = spawnSync("bash", ["-c", "printf '%s' " + shellQuote(checkout)], { encoding: "utf8" });
  assert.equal(quoted.status, 0);
  assert.equal(quoted.stdout, checkout);
});

test("createOnce refuses symlinks and does not overwrite their target", t => {
  const dir = mkdtempSync(join(tmpdir(), "portable-safe-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "target"), "keep");
  symlinkSync(join(dir, "target"), join(dir, "link"));
  assert.throws(() => createOnce(join(dir, "link"), "replace"), /unsafe/);
  assert.equal(readFileSync(join(dir, "target"), "utf8"), "keep");
});

test("launchers have valid shell syntax, preserve cwd and require installation", () => {
  for (const name of ["setup.sh", "pi", "tuios", "tools", "activate.sh", "portable/env.sh", "portable/versions.sh"]) {
    assert.equal(spawnSync("bash", ["-n", join(root, name)]).status, 0, name);
  }
  assert.equal(spawnSync("bash", [join(root, "setup.sh"), "--help"]).status, 0);
  const source = readFileSync(join(root, "portable/env.sh"), "utf8");
  assert.match(source, /PI_CODING_AGENT_DIR="\$STATE\/agent"/);
  assert.doesNotMatch(source, /^cd /m);
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /\/\.portable\//);
});

test("launcher starts ZAP for mcp list, not for help, package list or --no-mcp", t => {
  const dir = mkdtempSync(join(tmpdir(), "portable-launch-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ["portable", ".portable/node/bin", ".portable/agent"]) mkdirSync(join(dir, name), { recursive: true });
  for (const file of ["pi", "portable/env.sh"]) writeFileSync(join(dir, file), readFileSync(join(root, file)));
  writeFileSync(join(dir, ".portable/agent/settings.json"), "{}");
  writeFileSync(join(dir, ".portable/node/bin/node"), '#!/bin/sh\nprintf "%s\\n" "$*"\n', { mode: 0o700 });
  for (const [args, starts] of [[["mcp", "list"], true], [[], true], [["list"], false], [["--help"], false], [["--no-mcp"], false]]) {
    const result = spawnSync("bash", [join(dir, "pi"), ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("/portable/zap.mjs start"), starts, JSON.stringify(args));
    assert.ok(result.stdout.includes("/dist/cli.js"));
  }
});

test("runtime pin and patch include both frame implementation and regressions", () => {
  const patch = readFileSync(join(root, "portable/pi-1.5.2-chat-frame.patch"), "utf8");
  for (const file of ["components/frame.ts", "test/frame.test.ts", "test/chat-viewport.test.ts"]) assert.ok(patch.includes(file));
  assert.match(readFileSync(join(root, "portable/versions.sh"), "utf8"), /PI_COMMIT=b4afdddf44e059c67ccf5097e5317d913521b470/);
  const install = readFileSync(join(root, "setup.sh"), "utf8");
  assert.match(install, /sha256sum --check/);
  assert.match(install, /npm ci --ignore-scripts/);
  assert.doesNotMatch(install, /git (reset|clean)|scan\.py/);
});
