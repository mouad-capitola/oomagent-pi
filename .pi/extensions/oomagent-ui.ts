import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import { readdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CustomEditor, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { createQuotaMonitor, formatContext, formatQuota, isCodex } from "../lib/footer-limits.ts";
import { frameCodemode } from "../lib/codemode-frame.ts";
import { sessionTokenUsage } from "../lib/footer-metrics.ts";
import { rgbColor, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);
const OWN_EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const BRAND = "OomAgent";
const FOOTER_BANNER = "◈ OOMAGENT-MOUAD";
const SPINNER = ["◐", "◓", "◑", "◒"];

// Footer-only accents: do not recolor messages, tools or the user's theme.
const FOOTER_PALETTES = {
  dark: { purple: rgbColor(179, 136, 255), cyan: rgbColor(73, 211, 222),
    green: rgbColor(100, 220, 145), blue: rgbColor(112, 180, 255),
    amber: rgbColor(245, 191, 92), red: rgbColor(255, 117, 127), muted: rgbColor(155, 166, 183) },
  light: { purple: rgbColor(109, 40, 217), cyan: rgbColor(0, 105, 120),
    green: rgbColor(22, 115, 65), blue: rgbColor(30, 90, 180),
    amber: rgbColor(145, 87, 0), red: rgbColor(185, 35, 55), muted: rgbColor(85, 96, 115) },
};

export function footerPalette(theme: Pick<Theme, "appearance">) {
  return FOOTER_PALETTES[theme.appearance === "light" ? "light" : "dark"];
}

export function footerUsageColor(value: number | undefined, theme: Pick<Theme, "appearance">) {
  const colors = footerPalette(theme);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return colors.muted;
  return value >= 90 ? colors.red : value >= 75 ? colors.amber : colors.cyan;
}

export function formatResponseDuration(elapsed: number | undefined): string {
  if (elapsed === undefined || !Number.isFinite(elapsed) || elapsed < 0) return "—";
  const seconds = Math.floor(elapsed / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function renderFooterTicker(width: number, frame: number, theme: Theme): string {
  const columns = Math.max(0, width);
  const badge = truncateToWidth(theme.style(FOOTER_BANNER, { fg: footerPalette(theme).purple, bold: true }), columns, "");
  const distance = Math.max(0, columns - visibleWidth(badge));
  const phase = distance ? frame % (2 * distance) : 0;
  const position = phase <= distance ? phase : 2 * distance - phase;
  return " ".repeat(position) + badge + " ".repeat(distance - position);
}

// Wrap whole telemetry groups first, then long values using Pi's ANSI-aware layout.
export function layoutFooterGroups(groups: string[], width: number, theme: Theme): string[] {
  if (width <= 0) return [""];
  const separator = theme.style("  │  ", { fg: footerPalette(theme).muted });
  const lines: string[] = [];
  let line = "";
  for (const group of groups) {
    if (line && visibleWidth(line + separator + group) <= width) {
      line += separator + group;
    } else {
      if (line) lines.push(line);
      const wrapped = wrapTextWithAnsi(group, width);
      lines.push(...wrapped.slice(0, -1));
      line = wrapped.at(-1) ?? "";
    }
  }
  if (line) lines.push(line);
  return lines;
}
type Ink = "text" | "muted" | "accent" | "success" | "error";

function fit(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), "");
}

type FooterGitStatus = {
  branch: string;
  changed: number;
  staged: number;
  untracked: number;
  conflicts: number;
  ahead: number | null;
  behind: number | null;
};

export function parseFooterGitStatus(output: string): FooterGitStatus {
  const records = output.split("\0");
  const status: FooterGitStatus = { branch: "", changed: 0, staged: 0, untracked: 0, conflicts: 0, ahead: null, behind: null };
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    if (record.startsWith("# branch.head ")) {
      status.branch = record.slice(14);
    } else if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (!match) throw new Error("Invalid Git branch counts");
      status.ahead = Number(match[1]);
      status.behind = Number(match[2]);
    } else if (record.startsWith("? ")) {
      status.changed++;
      status.untracked++;
    } else if (/^[12u] /.test(record)) {
      const xy = record.slice(2, 4);
      status.changed++;
      if (record.startsWith("u ")) status.conflicts++;
      else if (xy[0] !== ".") status.staged++;
      // Rename/copy records include a second NUL-delimited original filename.
      if (record.startsWith("2 ") && !records[++i]) throw new Error("Incomplete Git rename record");
    } else if (!record.startsWith("# ") && !record.startsWith("! ")) {
      throw new Error("Invalid Git status record");
    }
  }
  if (!status.branch) throw new Error("Missing Git branch header");
  return status;
}

export async function readFooterGitStatus(cwd: string, signal?: AbortSignal): Promise<FooterGitStatus> {
  const { stdout } = await execFileAsync("git", ["--no-pager", "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], {
    cwd, signal, timeout: 3000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
  });
  return parseFooterGitStatus(stdout);
}

type ProjectTreeEntry = { text: string; directory: boolean };

// Names only: no file contents, no symlink traversal, bounded two-level preview.
export async function readProjectTree(cwd: string): Promise<ProjectTreeEntry[]> {
  const root = await realpath(cwd);
  const ignored = new Set([".git", ".serena", "node_modules", ".DS_Store"]);
  const visible = (name: string) => !ignored.has(name) && !/^\.env(?:$|\.)/.test(name);
  const safe = (name: string) => name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "?");
  const list = async (path: string) => (await readdir(path, { withFileTypes: true }))
    .filter(entry => visible(entry.name) && !entry.isSymbolicLink())
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const children = await list(root);
  const result: ProjectTreeEntry[] = [];
  for (const [index, child] of children.slice(0, 16).entries()) {
    const last = index === children.length - 1;
    result.push({ text: `${last ? "└" : "├"}─ ${child.isDirectory() ? "📁" : "📄"} ${safe(child.name)}`, directory: child.isDirectory() });
    if (!child.isDirectory()) continue;
    try {
      const path = resolve(root, child.name);
      // Recheck after discovery so a replaced/symlinked directory is not traversed.
      if (await realpath(path) !== path) continue;
      const nested = await list(path);
      for (const [i, entry] of nested.slice(0, 2).entries()) {
        result.push({
          text: `${last ? " " : "│"}  ${i === nested.length - 1 ? "└" : "├"}─ ${entry.isDirectory() ? "📁" : "📄"} ${safe(entry.name)}`,
          directory: entry.isDirectory(),
        });
      }
      if (nested.length > 2) result.push({ text: `${last ? " " : "│"}  └─ … ${nested.length - 2} meer`, directory: false });
    } catch {
      result.push({ text: `${last ? " " : "│"}  └─ niet leesbaar`, directory: false });
    }
  }
  if (children.length > 16) result.push({ text: `└─ … ${children.length - 16} meer`, directory: false });
  return result;
}

export function renderProjectPanel(
  brand: string[], entries: readonly ProjectTreeEntry[] | undefined, cwd: string,
  width: number, theme: Theme, error = false,
): string[] {
  const cleanName = basename(cwd).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "?");
  const wide = width >= 110;
  const limit = wide ? 10 : 3;
  const tree = [
    theme.fg("accent", `📁 ${cleanName || "Project"}`),
    ...(entries === undefined
      ? [theme.fg("muted", error ? "Niet leesbaar" : "Structuur laden…")]
      : entries.length === 0
        ? [theme.fg("muted", "Lege map")]
        : entries.slice(0, limit).map(entry => theme.fg(entry.directory ? "warning" : "muted", entry.text))),
  ];
  if (entries && entries.length > limit) tree.push(theme.fg("dim", `… ${entries.length - limit} regels meer`));
  const pad = (line: string, columns: number) => {
    const clipped = fit(line, columns);
    return clipped + " ".repeat(Math.max(0, columns - visibleWidth(clipped)));
  };
  if (!wide) return [...brand, ...tree].map(line => theme.bg("userMessageBg", pad(line, width)));
  const rightWidth = 36;
  const leftWidth = width - rightWidth - 3;
  return Array.from({ length: Math.max(brand.length, tree.length) }, (_, i) =>
    theme.bg("userMessageBg", pad(brand[i] ?? "", leftWidth) +
      theme.fg("border", " │ ") + pad(tree[i] ?? "", rightWidth))
  );
}

export function sceneLines(frame: number): { text: string; ink: Ink }[][] {
  const link = frame % 2 ? "┆" : "│";
  const layout: { text: string; ink: Ink }[] = [
    { text: "           ◎ INPUT           ◎ CONTEXT", ink: "success" },
    { text: `           ${link}                 ${link}`, ink: "accent" },
    { text: "           ◎ PLAN            ◎ TOOLS", ink: "success" },
    { text: `           ${link}                 ${link}`, ink: "accent" },
    { text: "           ╰ · · · ◎ · · · · ╯", ink: "accent" },
    { text: "                 OomAgent", ink: "text" },
    { text: `                    ${link}`, ink: "accent" },
    { text: "           ╭ · · · ·┴· · · · ╮", ink: "accent" },
    { text: "           ◎ CODE            ◎ REVIEW", ink: "success" },
    { text: `           ${link}                 ${link}`, ink: "accent" },
    { text: "           ◎ TEST            ◎ OUTPUT", ink: "accent" },
  ];
  return layout.map(({ text, ink }) => [...text.padEnd(64)].map(text => ({ text, ink })));
}

export function messageBorder(label: string, width: number, bottom = false): string {
  if (width < 4) return "";
  if (bottom) return `┗${"━".repeat(width - 2)}┛`;
  const title = fit(` ${label} `, width - 2);
  return `┏${title}${"━".repeat(Math.max(0, width - visibleWidth(title) - 2))}┓`;
}

class BrandEditor extends CustomEditor {
  brandBorder?: (text: string) => string;
  override render(width: number): string[] {
    if (this.brandBorder) this.borderColor = this.brandBorder;
    return super.render(width);
  }
}

export default function (pi: ExtensionAPI) {
  let footerEnabled = true;
  let footerMotion = true;
  let disposeFooter: (() => void) | undefined;
  let redrawFooter: (() => void) | undefined;
  const quota = createQuotaMonitor(() => redrawFooter?.());
  let refreshFooterGit: (() => Promise<void>) | undefined;
  let responseStarted: number | undefined;
  let responseDuration: number | undefined;
  let responseProblem: "error" | "aborted" | undefined;
  let syncFooterAnimation: (() => void) | undefined;
  // Existing entries are excluded, not deleted. Capture once per start/reload,
  // not when toggling or recreating the footer component.
  let usageBaseline = new Set<unknown>();
  const installFooter = (ctx: ExtensionContext) => {
    disposeFooter?.();
    ctx.ui.setFooter(footerEnabled ? (tui) => {
      let disposed = false;
      let tickerFrame = 0;
      let gitStatus: FooterGitStatus | undefined;
      let gitLoading = true;
      let readingGit = false;
      redrawFooter = () => tui.requestRender();
      const refreshGit = async () => {
        if (disposed || readingGit) return;
        readingGit = true;
        try {
          const next = await readFooterGitStatus(ctx.cwd);
          if (!disposed) gitStatus = next;
        } catch {
          if (!disposed) gitStatus = undefined;
        } finally {
          readingGit = false;
          gitLoading = false;
          if (!disposed) tui.requestRender();
        }
      };
      refreshFooterGit = refreshGit;
      const gitTimer = setInterval(() => { void refreshGit(); }, 5000);
      gitTimer.unref();
      void refreshGit();
      let animation: ReturnType<typeof setInterval> | undefined;
      const syncAnimation = () => {
        if (animation) { clearInterval(animation); animation = undefined; }
        if (!disposed && footerMotion) {
          animation = setInterval(() => { tickerFrame++; tui.requestRender(); }, 150);
          animation.unref();
        }
      };
      syncFooterAnimation = syncAnimation;
      syncAnimation();
      // Keep tool availability fresh even while animation is paused.
      const timer = setInterval(() => tui.requestRender(), 1000);
      timer.unref();
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        clearInterval(timer);
        if (animation) clearInterval(animation);
        syncFooterAnimation = undefined;
        clearInterval(gitTimer);
        redrawFooter = undefined;
        refreshFooterGit = undefined;
      };
      disposeFooter = dispose;
      return {
        dispose,
        invalidate() {},
        render(width: number): string[] {
          const theme = ctx.ui.theme;
          const activeTools = new Set(pi.getActiveTools());
          // Deferred/codemode tools remain callable without being active.
          const availableTools = pi.getAllTools().filter(tool =>
            tool.exposure !== "hidden" && (
              activeTools.has(tool.name) || tool.exposure === "codemode" || tool.exposure === "deferred"
            )
          );
          const ownToolCount = availableTools.filter(tool =>
            dirname(resolve(ctx.cwd, tool.sourceInfo.path)) === OWN_EXTENSION_DIR
          ).length;
          const entries = ctx.sessionManager.getEntries().filter(entry =>
            !usageBaseline.has(entry.id ?? entry)
          );
          const tokens = sessionTokenUsage(entries);
          const clean = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "?");
          const colors = footerPalette(theme);
          const metric = (label: string, value: string, color = colors.cyan) =>
            theme.style(label + " ", { fg: color, bold: true }) + theme.fg("text", value);
          const system = [
            metric("◉ TOKENS", tokens.total.toLocaleString("nl-NL") + (tokens.incomplete ? "*" : "")),
            metric("🔧 TOOLS", String(availableTools.length), colors.blue),
            metric("⚡ OWN", String(ownToolCount), colors.amber),
          ];
          const running = responseStarted !== undefined;
          const elapsed = running ? performance.now() - responseStarted! : responseDuration;
          const duration = formatResponseDuration(elapsed);
          const indicator = running ? SPINNER[footerMotion ? tickerFrame % SPINNER.length : 0]
            : responseProblem === "error" ? "!" : responseProblem === "aborted" ? "◇" : elapsed === undefined ? "◇" : "✓";
          const state = running ? "ACTIVE" : responseProblem === "error" ? "ERROR" : responseProblem === "aborted" ? "ABORTED" : elapsed === undefined ? "IDLE" : "READY";
          const statusColor = running ? colors.cyan : responseProblem === "error" ? colors.red
            : responseProblem === "aborted" ? colors.amber : elapsed === undefined ? colors.muted : colors.green;
          const runtime = theme.style(`${indicator} ${duration}`, { fg: statusColor, bold: true })
            + theme.style(` · ${state}`, { fg: statusColor });
          const git = gitStatus
            ? theme.style(`⎇ ${clean(gitStatus.branch)}`, { fg: colors.green, bold: true }) +
              theme.style(` · ${gitStatus.changed} gewijzigd`, {
                fg: gitStatus.conflicts ? colors.red : gitStatus.changed ? colors.amber : colors.muted,
              }) +
              (gitStatus.ahead === null ? "" : " · " +
                theme.style(`↑${gitStatus.ahead}`, { fg: colors.green, bold: true }) + " " +
                theme.style(`↓${gitStatus.behind}`, { fg: colors.blue, bold: true }))
            : theme.style(gitLoading ? "⎇ laden…" : "⎇ niet beschikbaar", { fg: colors.muted });
          const model = ctx.model;
          const modelName = model ? clean(`${model.provider}/${model.id}`) : "niet beschikbaar";
          const telemetry = layoutFooterGroups([...system, runtime, git,
            metric("◈ THINKING", clean(pi.getThinkingLevel()), colors.purple),
          ], width, theme);
          const ai = layoutFooterGroups([
            theme.style(`◆ ${modelName}`, { fg: colors.purple, bold: true }),
            ...(isCodex(model?.provider) ? [theme.style(formatQuota(quota.snapshot()), { fg: footerUsageColor(quota.snapshot()?.weekly, theme), bold: true })] : []),
            theme.style(formatContext(ctx), { fg: footerUsageColor(ctx.getContextUsage?.()?.percent, theme), bold: true }),
          ], width, theme);
          const last = ai.length - 1;
          const remaining = width - visibleWidth(ai[last]) - 3;
          if (remaining >= visibleWidth(FOOTER_BANNER)) {
            ai[last] += "   " + renderFooterTicker(remaining, tickerFrame, theme);
          } else {
            ai.push(renderFooterTicker(width, tickerFrame, theme));
          }
          return [...telemetry, ...ai].map(text => {
            const clipped = fit(text, width);
            return theme.bg("userMessageBg", clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped))));
          });
        },
      };
    } : undefined);
  };

  let treeEnabled = true;
  let active = false;
  let splash = false;
  let motion = false;
  let frame = 0;
  let disposeHeader: (() => void) | undefined;
  let redraw: (() => void) | undefined;
  let currentTheme: (() => Theme) | undefined;

  // Pi 1.0.4 renderer composition: presentation only, never override execution.
  pi.registerToolRenderer?.((toolName, next) => {
    const base = next();
    return toolName === "codemode" && base?.renderCall && base?.renderResult
      ? frameCodemode(base) : base;
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (!active || !currentTheme || context.messageType === "assistant-thinking" || !markdown.trim()) return markdown;
    const width = Math.max(0, context.availableWidth);
    const user = context.messageType === "user";
    const theme = currentTheme();
    const color = user ? "borderMuted" : "borderAccent";
    const top = theme.bold(theme.fg(color, messageBorder(user ? "Mouad" : "pi-Oomagent", width)));
    // Leave streaming content untouched below the heading until it completes.
    const bottom = context.isStreaming ? "" : `\n\n${theme.bold(theme.fg(color, messageBorder("", width, true)))}`;
    return `${top}\n\n${markdown}${bottom}`;
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    active = true;
    responseStarted = undefined;
    responseDuration = undefined;
    responseProblem = undefined;
    usageBaseline = new Set((ctx.sessionManager?.getEntries?.() ?? []).map(entry => entry.id ?? entry));
    installFooter(ctx);
    quota.start(ctx);
    currentTheme = () => ctx.ui.theme;
    splash = false;
    const selected = ctx.ui.setTheme("oomagent-swiss");
    if (!selected.success) ctx.ui.notify(selected.error || "Oomagent theme could not be loaded.", "warning");
    ctx.ui.setTitle(BRAND);
    ctx.ui.setEditorComponent((tui, theme, keys) => {
      const editor = new BrandEditor(tui, theme, keys);
      editor.brandBorder = text => ctx.ui.theme.fg("dim", text);
      return editor;
    });
    ctx.ui.setHeader(tui => {
      disposeHeader?.();
      let disposed = false;
      redraw = () => tui.requestRender();
      let tree: ProjectTreeEntry[] | undefined;
      let treeError = false;
      let readingTree = false;
      const refreshTree = async () => {
        if (disposed || readingTree || !treeEnabled || !ctx.cwd) return;
        readingTree = true;
        try {
          const next = await readProjectTree(ctx.cwd);
          if (!disposed) { tree = next; treeError = false; }
        } catch {
          if (!disposed) { tree = undefined; treeError = true; }
        } finally {
          readingTree = false;
          if (!disposed) tui.requestRender();
        }
      };
      const treeTimer = setInterval(() => { void refreshTree(); }, 5000);
      treeTimer.unref();
      void refreshTree();
      const timer = setInterval(() => {
        if (motion && splash && !disposed) { frame++; tui.requestRender(); }
      }, 200);
      timer.unref();
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        clearInterval(timer);
        clearInterval(treeTimer);
      };
      disposeHeader = dispose;
      return {
        dispose,
        invalidate() {},
        render(width: number): string[] {
          const theme = ctx.ui.theme;
          const paint = (text: string) => theme.bg("userMessageBg", fit(text, width));
          const withTree = (lines: string[]) => treeEnabled && ctx.cwd
            ? renderProjectPanel(lines, tree, ctx.cwd, width, theme, treeError)
            : lines;
          if (!splash || width < 48) {
            const yellow = (text: string) => theme.fg("warning", text);
            const title = theme.bold(theme.fg("text", BRAND));
            const panel = (text: string) => {
              const clipped = fit(text, width);
              return paint(clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped))));
            };
            if (width < 48) {
              return withTree([
                panel(theme.fg("accent", "◎ · · ") + title),
                panel(theme.fg("accent", "┆ ") + theme.fg("muted", "Geef je opdracht · /help")),
              ]);
            }
            return withTree([
              panel(theme.fg("accent", "◎ ") + title + theme.fg("muted", "  /  ENGINEERING WORKSPACE")),
              panel(theme.fg("accent", "┆ ") + theme.fg("muted", "Inspecteren  ·  Bouwen  ·  Verifiëren")),
              panel(yellow("› ") + theme.fg("text", "/help") + theme.fg("muted", "   /model   /settings   /oom-tree")),
              panel(theme.fg("accent", "╰ ") + theme.fg("dim", "┄".repeat(Math.max(0, width - 2)))),
            ]);
          }
          const scene = sceneLines(frame);
          const sceneWidth = Math.min(width, 64);
          const pad = " ".repeat(Math.max(0, Math.floor((width - sceneWidth) / 2)));
          return withTree([
            paint(theme.fg("accent", "◎ OOMAGENT / ORBITAL NETWORK")),
            ...scene.map(line => paint(pad + line.slice(0, sceneWidth).map(cell => theme.fg(cell.ink, cell.text)).join(""))),
            paint(theme.fg("muted", "Typ je bericht om te starten · /oom-screen · /oom-motion")),
          ]);
        },
      };
    });
    // Remove the legacy animated widget; branding now lives in the compact header.
    ctx.ui.setWidget("oomagent-multiverse", undefined);
    pi.events?.emit("oomagent:ui-ready", ctx);
  });

  pi.on("before_agent_start", () => {
    if (responseStarted === undefined) {
      responseStarted = performance.now();
      responseProblem = undefined;
    }
    syncFooterAnimation?.();
    redrawFooter?.();
    splash = false;
    redraw?.();
  });
  pi.on("model_select", (_event, ctx) => {
    if (active) quota.start(ctx);
    redrawFooter?.();
  });
  pi.on("thinking_level_select", () => redrawFooter?.());
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") {
      const reason = event.message.stopReason;
      responseProblem = reason === "error" || reason === "aborted" ? reason : undefined;
    }
  });
  pi.on("agent_settled", () => {
    if (responseStarted !== undefined) {
      responseDuration = performance.now() - responseStarted;
      responseStarted = undefined;
    }
    redrawFooter?.();
    syncFooterAnimation?.();
    void refreshFooterGit?.();
    void quota.refresh();
  });
  pi.on("session_shutdown", () => {
    quota.stop();
    disposeFooter?.();
    disposeFooter = undefined;
    disposeHeader?.();
    disposeHeader = undefined;
    redraw = undefined;
    currentTheme = undefined;
    active = false;
  });
  pi.registerCommand("chatgpt-limit", {
    description: "Show ChatGPT usage and context capacity without replacing the OomAgent HUD",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      await quota.refresh();
      ctx.ui.notify(isCodex(ctx.model?.provider)
        ? `${formatQuota(quota.snapshot())} · ${formatContext(ctx)} (gebruikt; ? = niet beschikbaar)`
        : "ChatGPT-limieten zijn alleen beschikbaar voor Codex-modellen.", "info");
    },
  });
  pi.registerCommand("oom-footer", {
    description: "Toggle the OomAgent footer and the default Pi footer",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      footerEnabled = !footerEnabled;
      installFooter(ctx);
    },
  });
  pi.registerCommand("oom-tree", {
    description: "Show or hide the project folder panel",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      treeEnabled = !treeEnabled;
      redraw?.();
    },
  });
  pi.registerCommand("oom-screen", {
    description: "Show or hide the orbital node network",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      splash = !splash;
      redraw?.();
    },
  });
  pi.registerCommand("oom-motion", {
    description: "Pause or resume HUD and orbital animations",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      footerMotion = !footerMotion;
      motion = footerMotion;
      syncFooterAnimation?.();
      redrawFooter?.();
      redraw?.();
      ctx.ui.notify(`OomAgent animation ${footerMotion ? "on" : "off"}.`, "info");
    },
  });
}
