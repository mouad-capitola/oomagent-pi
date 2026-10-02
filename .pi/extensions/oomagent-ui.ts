import { CustomEditor, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const BRAND = "OomAgent-Mouad";
const FRAMES = ["◌", "◎", "◉", "◎"];
type Ink = "text" | "muted" | "accent" | "success" | "error";

function fit(text: string, width: number): string {
  return truncateToWidth(text, Math.max(0, width), "");
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
  const installFooter = (ctx: ExtensionContext) => {
    ctx.ui.setFooter(footerEnabled ? (tui, _theme, data) => {
      const unsubscribe = data.onBranchChange(() => tui.requestRender());
      // Tool registrations and idle state can change even with animation paused.
      const timer = setInterval(() => tui.requestRender(), 1000);
      timer.unref();
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          clearInterval(timer);
          unsubscribe();
        },
        invalidate() {},
        render(width: number): string[] {
          const theme = ctx.ui.theme;
          const paint = (line: string) => {
            const fitted = fit(line, width);
            return theme.bg("userMessageBg", fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted))));
          };
          const branch = data.getGitBranch() ?? "geen branch";
          const activeTools = new Set(pi.getActiveTools());
          // Deferred/codemode tools remain callable without being active.
          const toolCount = pi.getAllTools().filter(tool =>
            tool.exposure !== "hidden" && (
              activeTools.has(tool.name) || tool.exposure === "codemode" || tool.exposure === "deferred"
            )
          ).length;
          const idle = ctx.isIdle();
          const separator = theme.fg("muted", " | ");
          const line = [
            theme.fg("success", "π OomAgent"),
            theme.fg("muted", branch),
            theme.fg("accent", `${toolCount} tools`),
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
