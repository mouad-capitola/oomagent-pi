#!/usr/bin/env node
import { createHash } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export function parseArguments(args) {
  let detached = false, project, literal = false;
  for (const arg of args) {
    if (!literal && arg === "--") { literal = true; continue; }
    if (!literal && arg === "--help") return { help: true };
    if (!literal && arg === "--detach") { detached = true; continue; }
    if (!literal && arg.startsWith("-")) throw Error("Onbekende optie: " + arg);
    if (project !== undefined) throw Error("Geef maximaal één projectmap op.");
    project = arg;
  }
  return { detached, project: project ?? process.cwd() };
}

export function sessionName(project) {
  const label = project.split("/").at(-1).replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 24) || "project";
  return "oom-" + label + "-" + createHash("sha256").update(project).digest("hex").slice(0, 12);
}

export function childEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !["TMUX", "TMUX_PANE", "PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"].includes(key)));
}

function executable(name, env) {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(directory, name);
    try { accessSync(candidate, constants.X_OK); if (statSync(candidate).isFile()) return candidate; } catch { /* Try next PATH entry. */ }
  }
  throw Error(name + " ontbreekt. Installeer tmux en Neovim; zorg dat pi op PATH staat.");
}

export function openWorkbench(options, env = process.env) {
  if (!options.detached && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw Error("Open dit commando in Terminal, of gebruik --detach.");
  const project = realpathSync(options.project);
  if (!statSync(project).isDirectory()) throw Error("Het projectpad is geen map.");
  if (/[\x00-\x1f\x7f]/.test(project)) throw Error("Projectpad bevat ongeldige controletekens.");
  // tmux expands formats in -c; a literal # must not become a format or job.
  const cwd = project.replaceAll("#", "##");
  const name = sessionName(project) + (env.OOMAGENT_WORKBENCH_VARIANT === "upgrade" ? "-upgrade" : "");
  const tmux = executable("tmux", env);
  const prefix = ["-L", options.socket ?? "oomagent-workbench", "-f", fileURLToPath(new URL("../tmux/workbench.conf", import.meta.url))];
  const cleanEnv = childEnvironment(env);
  const run = (args, extra = {}) => spawnSync(tmux, [...prefix, ...args], { env: cleanEnv, encoding: "utf8", ...extra });
  const checked = args => {
    const result = run(args);
    if (result.error || result.status !== 0) throw Error("tmux " + args[0] + ": " + (result.stderr?.trim() || result.error?.code || "opdracht mislukt"));
    return result.stdout.replace(/\r?\n$/, "");
  };
  const sessions = run(["list-sessions", "-F", "#{session_name}|#{session_id}"]);
  let target = (sessions.stdout ?? "").split("\n").map(line => line.split("|")).find(([session]) => session === name)?.[1];
  const exists = target !== undefined;
  if (exists) {
    if (checked(["show-options", "-qv", "-t", target, "@oomagent-project"]) !== project)
      throw Error("Bestaande sessie hoort niet bij deze werkplek; niets gewijzigd.");
    if (checked(["show-options", "-qv", "-t", target, "@oomagent-ready"]) !== "1")
      throw Error("Deze sessie is onvolledig; bekijk haar handmatig met tmux. Sessienaam: " + name);
  } else {
    const editor = executable("nvim", env), pi = executable("pi", env);
    const shell = env.SHELL || "/bin/sh";
    if (!statSync(shell).isFile()) throw Error("SHELL moet naar een uitvoerbaar bestand verwijzen.");
    accessSync(shell, constants.X_OK);
    // Separate argv entries: project paths and executable paths are never shell code.
    target = checked(["new-session", "-d", "-P", "-F", "#{session_id}", "-s", name, "-n", "editor", "-c", cwd, "-x", "180", "-y", "44", editor, "."]);
    try {
      checked(["set-option", "-t", target, "@oomagent-project", project]);
      const pane = checked(["split-window", "-h", "-l", "50%", "-P", "-F", "#{pane_id}", "-t", target + ":editor", "-c", cwd, "/usr/bin/env", "OOMAGENT_TMUX=1", pi]);
      checked(["select-pane", "-t", target + ":editor.0", "-T", "Neovim"]);
      checked(["select-pane", "-t", pane, "-T", "Pi"]);
      for (const window of ["shell", "logs"]) checked(["new-window", "-d", "-t", target, "-n", window, "-c", cwd, shell, "-l"]);
      checked(["select-window", "-t", target + ":editor"]);
      checked(["select-pane", "-t", pane]);
      checked(["set-option", "-t", target, "@oomagent-ready", "1"]);
    } catch (error) {
      // Preserve the new session and any editor buffer rather than killing processes.
      throw Error(error.message + " De deels aangemaakte sessie is behouden: " + name);
    }
  }
  if (options.detached) return { name, project, reused: exists };
  // With TMUX removed, a nested invocation attaches to this separate server instead
  // of changing or terminating the caller's tmux session.
  const result = run(["attach-session", "-t", target], { stdio: "inherit" });
  if (result.error || result.status !== 0) throw Error("Aansluiten op tmux mislukt; de sessie blijft bewaard.");
  return { name, project, reused: exists };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log("Gebruik: oomagent-workbench [--detach] [--] [projectmap]\nLinks Neovim, rechts Pi; extra vensters shell en logs. Zonder map: huidige werkmap.\nCtrl+b daarna pijl: paneel. Ctrl+b daarna 1/2/3: venster. Ctrl+b daarna d: loskoppelen.");
    else console.log(JSON.stringify(openWorkbench(options)));
  } catch (error) { console.error("OomAgent-werkplek: " + error.message); process.exitCode = 1; }
}
