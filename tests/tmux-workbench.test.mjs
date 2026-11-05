import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { parseArguments, sessionName, childEnvironment, openWorkbench } from "../scripts/oomagent-workbench.mjs";

const tmux = spawnSync("which", ["tmux"], { encoding: "utf8" }).stdout?.trim();
const nvim = spawnSync("which", ["nvim"], { encoding: "utf8" }).stdout?.trim();
const pi = spawnSync("which", ["pi-classic"], { encoding: "utf8" }).stdout?.trim() || spawnSync("which", ["pi"], { encoding: "utf8" }).stdout?.trim();

test("arguments support spaces, literal dash paths and reject ambiguity", () => {
  assert.deepEqual(parseArguments(["--detach", "/a b"]), { detached: true, project: "/a b" });
  assert.equal(parseArguments(["--", "-project"]).project, "-project");
  assert.equal(parseArguments(["--help"]).help, true);
  assert.throws(() => parseArguments(["--wrong"]), /Onbekende/);
  assert.throws(() => parseArguments(["one", "two"]), /maximaal/);
});
test("session names cannot be tmux targets or shell expressions and distinguish paths", () => {
  assert.match(sessionName("/tmp/a:b.$(touch bad)"), /^oom-[a-zA-Z0-9-]+$/);
  assert.notEqual(sessionName("/one/project"), sessionName("/two/project"));
});
test("child environment retains configuration but removes inherited session identity", () => {
  assert.deepEqual(childEnvironment({ PATH: "/bin", PI_CODING_AGENT_DIR: "/config", TMUX: "old", TMUX_PANE: "%1", PI_SESSION_ID: "old", PI_SESSION_FILE: "/old", PI_MODEL: "old" }), { PATH: "/bin", PI_CODING_AGENT_DIR: "/config" });
});
test("invalid project and missing executables fail without starting a session", () => {
  assert.throws(() => openWorkbench({ detached: true, project: "/not/a/real/oomagent/project" }), /ENOENT/);
  assert.throws(() => openWorkbench({ detached: true, project: tmpdir() }, { PATH: "" }), /tmux ontbreekt/);
});
test("real tmux creates isolated panels, preserves cwd, resumes without duplicates and guards ownership", { skip: !tmux }, t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oom-tmux-test-")));
  const socket = "oom-test-" + process.pid;
  const call = args => {
    const result = spawnSync(tmux, ["-L", socket, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  t.after(() => {
    spawnSync(tmux, ["-L", socket, "kill-server"]);
    rmSync(root, { recursive: true, force: true });
  });
  const bin = join(root, "bin"), project = join(root, "project with space; literal $value #{pid}");
  mkdirSync(bin); mkdirSync(project);
  symlinkSync(tmux, join(bin, "tmux"));
  for (const name of ["nvim", "pi"]) writeFileSync(join(bin, name), "#!/bin/sh\nexec /bin/sleep 120\n", { mode: 0o700 });
  const env = { PATH: bin + ":/usr/bin:/bin", HOME: root, SHELL: "/bin/sh", TERM: "xterm-256color" };
  const options = { detached: true, project, socket };
  const first = openWorkbench(options, env);
  const target = call(["list-sessions", "-F", "#{session_id}"]);
  assert.equal(first.reused, false);
  assert.deepEqual(call(["list-windows", "-t", target, "-F", "#{window_index}:#{window_name}:#{window_panes}"]).split("\n"), ["1:editor:2", "2:shell:1", "3:logs:1"]);
  const panes = call(["list-panes", "-t", target + ":editor", "-F", "#{pane_index}|#{pane_left}|#{pane_current_path}|#{pane_title}|#{pane_active}"]).split("\n");
  assert.equal(panes[0], "0|0|" + project + "|Neovim|0");
  assert.match(panes[1], /^1\|[1-9][0-9]*\|/);
  assert.ok(panes[1].endsWith(project + "|Pi|1"));
  assert.equal(call(["show-options", "-gv", "mouse"]), "on");
  assert.equal(call(["list-sessions", "-F", "#{session_name}|#{session_id}"]), first.name + "|" + target);
  assert.equal(openWorkbench(options, env).reused, true);
  assert.equal(call(["list-panes", "-a", "-F", "#{pane_id}"]).split("\n").length, 4);
  call(["select-window", "-t", target + ":shell"]);
  assert.equal(call(["display-message", "-p", "-t", target, "#{window_name}"]), "shell");
  call(["resize-window", "-t", target + ":editor", "-x", "90", "-y", "24"]);
  assert.equal(call(["display-message", "-p", "-t", target + ":editor", "#{window_width}"]), "90");
  const upgrade = openWorkbench(options, { ...env, OOMAGENT_WORKBENCH_VARIANT: "upgrade" });
  assert.equal(upgrade.name, first.name + "-upgrade");
  assert.equal(upgrade.reused, false);
  assert.equal(openWorkbench(options, { ...env, OOMAGENT_WORKBENCH_VARIANT: "upgrade" }).reused, true);
  call(["set-option", "-t", target, "@oomagent-ready", "0"]);
  assert.throws(() => openWorkbench(options, env), /onvolledig/);
  call(["set-option", "-t", target, "@oomagent-project", "/someone-else"]);
  assert.throws(() => openWorkbench(options, env), /niet bij deze werkplek/);
});

test("real Neovim saves a buffer and real Pi starts offline in the right pane", { skip: !tmux || !nvim || !pi, timeout: 30000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oom-live-test-")));
  const socket = "oom-live-" + process.pid;
  const call = args => {
    const result = spawnSync(tmux, ["-L", socket, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  t.after(() => {
    spawnSync(tmux, ["-L", socket, "kill-server"]);
    // Pi may still flush local state after tmux closes its terminal.
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const bin = join(root, "bin");
  mkdirSync(bin);
  // Wrapper changes only this temporary Pi process: no credentials or user config.
  writeFileSync(join(bin, "pi"), "#!/bin/sh\nexec " + JSON.stringify(pi) + " --offline --no-mcp --no-session --no-extensions\n", { mode: 0o700 });
  const env = {
    PATH: bin + ":" + process.env.PATH, HOME: root, SHELL: "/bin/sh", TERM: "xterm-256color", LANG: "en_US.UTF-8",
    PI_CODING_AGENT_DIR: join(root, "agent"), PI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
    PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0",
  };
  openWorkbench({ detached: true, project: root, socket }, env);
  const target = call(["list-sessions", "-F", "#{session_id}"]) + ":editor";
  for (let attempt = 0; attempt < 100; attempt++) {
    if (call(["capture-pane", "-p", "-t", target + ".0"]).includes("Netrw")) break;
    await setTimeout(100);
  }
  call(["send-keys", "-t", target + ".0", "Escape"]);
  call(["send-keys", "-l", "-t", target + ".0", ":edit scratch.txt"]);
  call(["send-keys", "-t", target + ".0", "Enter"]);
  await setTimeout(100);
  call(["send-keys", "-l", "-t", target + ".0", "iworkbench save check"]);
  call(["send-keys", "-t", target + ".0", "Escape"]);
  call(["send-keys", "-l", "-t", target + ".0", ":w"]);
  call(["send-keys", "-t", target + ".0", "Enter"]);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(join(root, "scratch.txt")) && readFileSync(join(root, "scratch.txt"), "utf8") === "workbench save check\n") break;
    await setTimeout(100);
  }
  assert.equal(readFileSync(join(root, "scratch.txt"), "utf8"), "workbench save check\n");
  let frame = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    frame = call(["capture-pane", "-p", "-t", target + ".1"]);
    if (frame.length > 20) break;
    await setTimeout(100);
  }
  assert.ok(frame.length > 20, "Pi must render its initial screen");
  assert.match(call(["display-message", "-p", "-t", target + ".1", "#{pane_current_command}"]), /pi|node/);
});
