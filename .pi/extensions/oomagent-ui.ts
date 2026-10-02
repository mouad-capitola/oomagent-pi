import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CustomEditor, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);
const OWN_EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const BRAND = "OomAgent-Mouad";
const FRAMES = ["◌", "◎", "◉", "◎"];
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

export function sceneLines(frame: number): { text: string; ink: Ink }[][] {
  const width = 64;
  const height = 17;
  const cells = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ text: " ", ink: "muted" as Ink })));
  function draw(x: number, y: number, text: string, ink: Ink) {
    if (y < 0 || y >= height) return;
    [...text].forEach((char, index) => {
      if (x + index >= 0 && x + index < width) cells[y][x + index] = { text: char, ink };
    });
  }
  const logo = [
    "  ___   ___  __  __ ",
    " / _ \\ / _ \\|  \\/  |",
    "| (_) | (_) | |\\/| |",
    " \\___/ \\___/|_|  |_|",
  ];
  logo.forEach((line, y) => draw(3, y + 1, line, "text"));
  draw(5, 6, BRAND, "success");
  for (let point = 0; point < 64; point++) {
    const angle = (point / 64) * Math.PI * 2;
    const x = Math.round(44 + Math.cos(angle) * 11);
    const y = Math.round(4 + Math.sin(angle) * 3);
    const bright = (point + frame * 3) % 16 < 4;
    draw(x, y, bright ? "*" : ".", bright ? "success" : "accent");
  }
  const orbit = frame * 0.18;
  draw(Math.round(44 + Math.cos(orbit) * 7), Math.round(4 + Math.sin(orbit) * 2), "o", "error");
  const mountains = [
    "                /\\                       /\\",
    "       /\\      /  \\       /\\            /  \\",
    "      /  \\    /^^^^\\     /  \\    /\\   /^^^^\\",
    "  /\\ /^^^^\\  /      \\   /^^^^\\  /  \\ /      \\",
    " /  /      \\/        \\/      \\/^^^^\\        \\",
    "/^^/        \\         \\       /      \\        \\",
    "__/__________\\_________\\_____/________\\________\\__",
  ];
  mountains.forEach((line, index) => draw(2, index + 9, line, "text"));
  for (let y = 11; y <= 15; y++) draw(29, y, (y + frame) % 3 === 0 ? ":|:" : "|:|", "accent");
  draw(20, 16, frame % 2 ? "~~~~~ ~~~ ~~~~~ ~~~ ~~~~~" : "~~~ ~~~~~ ~~~ ~~~~~ ~~~~~", "accent");
  return cells;
}

export function messageBorder(label: string, width: number, bottom = false): string {
  if (width < 4) return "";
  if (bottom) return `╰${"─".repeat(width - 2)}╯`;
  const title = fit(` ${label} `, width - 2);
  return `╭${title}${"─".repeat(Math.max(0, width - visibleWidth(title) - 2))}╮`;
}

class RedEditor extends CustomEditor {
  redBorder?: (text: string) => string;
  override render(width: number): string[] {
    if (this.redBorder) this.borderColor = this.redBorder;
    return super.render(width);
  }
}

export default function (pi: ExtensionAPI) {
  let footerEnabled = true;
  let disposeFooter: (() => void) | undefined;
  const installFooter = (ctx: ExtensionContext) => {
    disposeFooter?.();
    ctx.ui.setFooter(footerEnabled ? (tui, _theme, data) => {
      let disposed = false;
      let pending = false;
      let gitStatus: FooterGitStatus | null | undefined;
      const controller = new AbortController();
      const refreshGit = async () => {
        if (disposed || pending) return;
        pending = true;
        try {
          const status = await readFooterGitStatus(ctx.cwd, controller.signal);
          if (!disposed) gitStatus = status;
        } catch {
          if (!disposed) gitStatus = null;
        } finally {
          pending = false;
          if (!disposed) tui.requestRender();
        }
      };
      const unsubscribe = data.onBranchChange(() => {
        gitStatus = undefined;
        void refreshGit();
        tui.requestRender();
      });
      // Git I/O happens asynchronously outside render; overlapping reads are skipped.
      const timer = setInterval(() => {
        void refreshGit();
        tui.requestRender();
      }, 1000);
      timer.unref();
      void refreshGit();
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        clearInterval(timer);
        controller.abort();
        unsubscribe();
      };
      disposeFooter = dispose;
      return {
        dispose,
        invalidate() {},
        render(width: number): string[] {
          const theme = ctx.ui.theme;
          const paint = (line: string) => {
            const fitted = fit(line, width);
            return theme.bg("userMessageBg", fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted))));
          };
          const branch = gitStatus
            ? (gitStatus.branch === "(detached)" ? "detached HEAD" : gitStatus.branch)
            : (data.getGitBranch() ?? "geen branch");
          const changes = gitStatus
            ? (gitStatus.changed === 0
              ? theme.fg("success", " ✓")
              : theme.fg("accent", ` ●${gitStatus.changed} (${gitStatus.staged} staged${gitStatus.untracked ? `, ${gitStatus.untracked} nieuw` : ""}${gitStatus.conflicts ? `, ${gitStatus.conflicts} conflict` : ""})`))
            : theme.fg("muted", gitStatus === undefined ? " …" : " Git ?");
          const sync = gitStatus && gitStatus.branch !== "(detached)"
            ? (gitStatus.ahead === null
              ? theme.fg("muted", " · geen upstream")
              : theme.fg("accent", ` ↑${gitStatus.ahead} ↓${gitStatus.behind}`))
            : "";
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
          const idle = ctx.isIdle();
          const separator = theme.fg("muted", " | ");
          const line = [
            theme.fg("success", "π OomAgent"),
            theme.fg("muted", branch) + changes + sync,
            theme.fg("accent", `${ownToolCount} eigen`),
            theme.fg("accent", `${availableTools.length} totaal`),
            theme.fg(idle ? "success" : "accent", idle ? "Ready ✓" : "Working…"),
          ].join(separator);
          return [paint(line)];
        },
      };
    } : undefined);
  };

  let active = false;
  let splash = true;
  let motion = true;
  let frame = 0;
  let disposeHeader: (() => void) | undefined;
  let redraw: (() => void) | undefined;
  let currentTheme: (() => Theme) | undefined;

  pi.registerMarkdownTransformer((markdown, context) => {
    if (!active || !currentTheme || context.messageType === "assistant-thinking" || !markdown.trim()) return markdown;
    const width = Math.max(0, Math.min(context.availableWidth, 110));
    const user = context.messageType === "user";
    const theme = currentTheme();
    const color = user ? "error" : "success";
    const top = theme.fg(color, messageBorder(user ? "Mouad" : "OomAgent", width));
    // Leave streaming content untouched below the heading until it completes.
    const bottom = context.isStreaming ? "" : `\n\n${theme.fg(color, messageBorder("", width, true))}`;
    return `${top}\n\n${markdown}${bottom}`;
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    active = true;
    installFooter(ctx);
    currentTheme = () => ctx.ui.theme;
    splash = true;
    const selected = ctx.ui.setTheme("oomagent-swiss");
    if (!selected.success) ctx.ui.notify(selected.error || "Oomagent theme could not be loaded.", "warning");
    ctx.ui.setTitle(BRAND);
    ctx.ui.setEditorComponent((tui, theme, keys) => {
      const editor = new RedEditor(tui, theme, keys);
      editor.redBorder = text => ctx.ui.theme.fg("error", text);
      return editor;
    });
    ctx.ui.setHeader(tui => {
      disposeHeader?.();
      let disposed = false;
      redraw = () => tui.requestRender();
      const timer = setInterval(() => {
        if (motion && !disposed) { frame++; tui.requestRender(); }
      }, 200);
      timer.unref();
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        clearInterval(timer);
      };
      disposeHeader = dispose;
      return {
        dispose,
        invalidate() {},
        render(width: number): string[] {
          const theme = ctx.ui.theme;
          const paint = (text: string) => theme.bg("userMessageBg", fit(text, width));
          if (!splash || width < 48) {
            return [paint(theme.fg("success", `${FRAMES[frame % FRAMES.length]} ${BRAND}`))];
          }
          const scene = sceneLines(frame);
          const sceneWidth = Math.min(width, 64);
          const pad = " ".repeat(Math.max(0, Math.floor((width - sceneWidth) / 2)));
          return [
            paint(theme.fg("accent", "WELCOME TO OOM AGENT")),
            ...scene.map(line => paint(pad + line.slice(0, sceneWidth).map(cell => theme.fg(cell.ink, cell.text)).join(""))),
            paint(theme.fg("muted", "Typ je bericht om te starten · /oom-screen · /oom-motion")),
          ];
        },
      };
    });
    // This widget stays next to the editor even after the startup header scrolls away.
    ctx.ui.setWidget("oomagent-multiverse", () => ({
      invalidate() {},
      render(width: number): string[] {
        const theme = ctx.ui.theme;
        const line = theme.fg("accent", `${FRAMES[frame % FRAMES.length]} `)
          + theme.fg("text", BRAND)
          + theme.fg("error", "  Mouad")
          + theme.fg("muted", " → ")
          + theme.fg("success", "OomAgent");
        return [theme.bg("userMessageBg", fit(line, width))];
      },
    }));
  });

  pi.on("before_agent_start", () => {
    splash = false;
    redraw?.();
  });
  pi.on("session_shutdown", () => {
    disposeFooter?.();
    disposeFooter = undefined;
    disposeHeader?.();
    disposeHeader = undefined;
    redraw = undefined;
    currentTheme = undefined;
    active = false;
  });
  pi.registerCommand("oom-footer", {
    description: "Toggle the OomAgent footer and the default Pi footer",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      footerEnabled = !footerEnabled;
      installFooter(ctx);
    },
  });
  pi.registerCommand("oom-screen", {
    description: "Show or hide the Swiss Alps / multiverse welcome scene",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      splash = !splash;
      redraw?.();
    },
  });
  pi.registerCommand("oom-motion", {
    description: "Pause or resume the multiverse and waterfall animation",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      motion = !motion;
      redraw?.();
      ctx.ui.notify(`OomAgent animation ${motion ? "on" : "off"}.`, "info");
    },
  });
}
