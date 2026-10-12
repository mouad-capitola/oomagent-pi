#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { ProcessTerminal, TuiAltScreen, getTerminalColorMode } from "@earendil-works/pi-tui";
import { createPreviewFooter } from "./footer.mjs";
import { createLayout } from "./layout.mjs";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Start dit offline prototype in een apart terminalvenster: node prototypes/oomagent-layout/preview.mjs");
  process.exitCode = 1;
} else {
  // Read-only theme loading; no installed library is modified.
  const { loadThemeFromPath } = await import(new URL("./modes/interactive/theme/theme.js", import.meta.resolve("@earendil-works/pi-coding-agent")));
  const theme = loadThemeFromPath(fileURLToPath(new URL("../../.pi/themes/oomagent-swiss.json", import.meta.url)), getTerminalColorMode());
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, true, undefined, { mouse: true, copyOnSelect: false });
  let footer;
  let layout;
  let stopped = false;
  let removeInput;
  const resize = () => { layout?.resize(terminal.columns, terminal.rows); tui.requestRender(); };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    removeInput?.();
    process.stdout.off("resize", resize);
    layout?.dispose();
    footer?.dispose();
    tui.stop();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  };
  try {
    footer = createPreviewFooter(theme, tui, fileURLToPath(new URL("../../", import.meta.url)));
    layout = createLayout({ width: terminal.columns, height: terminal.rows, theme, footer: footer.component, redraw: () => tui.requestRender(), quit: stop,
      onBegin: footer.begin, onFinish: footer.finish,
      onPaneChange: pane => tui.setFocus(pane === "chat" ? layout.input : null) });
    tui.setLayoutRoot(layout.root);
    tui.setFocus(layout.input);
    removeInput = tui.addInputListener(data => {
      const handled = layout.handleShortcut(data);
      if (!stopped && handled) tui.setFocus(layout.pane === "chat" ? layout.input : null);
      return handled ? { consume: true } : undefined;
    });
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.stdout.on("resize", resize);
    tui.start();
  } catch {
    stop();
    console.error("Het offline prototype kon niet starten. Je gewone Pi-configuratie is niet gewijzigd.");
    process.exitCode = 1;
  }
}
