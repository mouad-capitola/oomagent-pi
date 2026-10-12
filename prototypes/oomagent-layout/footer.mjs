import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import registerUi, { footerPalette } from "../../.pi/extensions/oomagent-ui.ts";

// Reuse the real HUD, but supply an explicitly offline, empty session.
// Never load credentials, MCPs, other extensions, or a model in the preview.
export function createPreviewFooter(theme, tui, cwd) {
  const handlers = new Map();
  let footer;
  const api = {
    on(name, fn) {
      const callbacks = handlers.get(name) ?? [];
      callbacks.push(fn);
      handlers.set(name, callbacks);
    },
    registerCommand() {},
    registerMarkdownTransformer() {},
    registerToolRenderer() {},
    getActiveTools: () => [],
    getAllTools: () => [],
    getThinkingLevel: () => "off",
  };
  registerUi(api);
  const ctx = {
    cwd, mode: "tui", hasUI: true,
    sessionManager: { getEntries: () => [] },
    getContextUsage: () => undefined,
    ui: {
      theme,
      setFooter(factory) { footer = factory?.(tui, theme, {}); },
      setTheme: () => ({ success: true }),
      setHeader() {}, setEditorComponent() {}, setWidget() {}, setTitle() {},
      notify() {},
    },
  };
  const emit = name => { for (const fn of handlers.get(name) ?? []) fn({}, ctx); };
  try {
    emit("session_start");
  } catch (error) {
    emit("session_shutdown");
    throw error;
  }
  let disposed = false;
  return {
    component: {
      invalidate() { footer.invalidate(); },
      render(width) {
        const quota = theme.style("ChatGPT week ?%", { fg: footerPalette(theme).muted, bold: true });
        // Presentation-only: retain the original HUD's data and colours.
        // This offline host has no quota credentials; never invent usage.
        const rows = footer.render(width).map(line => line.replace(/ {2,}/g, " "));
        const first = rows.shift() ?? "";
        const separator = first.indexOf("│");
        const lead = separator >= 0
          ? first.slice(0, separator) + "│ " + quota + " │" + first.slice(separator + 1)
          : quota + " │ " + first;
        const line = truncateToWidth([lead, ...rows].join(" │ "), Math.max(0, width));
        return [theme.bg("userMessageBg", line + " ".repeat(Math.max(0, width - visibleWidth(line))))];
      },
    },
    begin: () => { if (!disposed) emit("before_agent_start"); },
    finish: () => { if (!disposed) emit("agent_settled"); },
    dispose() {
      if (disposed) return;
      disposed = true;
      emit("session_shutdown");
    },
  };
}
