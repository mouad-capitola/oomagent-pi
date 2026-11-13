import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename, resolve } from "node:path";
import { scanTree, StartDiagram, renderProjectName } from "../lib/start-diagram.ts";
import { isWorkspaceProject, presentationRoot as repository } from "../lib/project-presentation.mjs";

export default function (pi: ExtensionAPI) {
  let screen: StartDiagram | undefined;
  let generation = 0;
  const show = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const current = ++generation;
    // Let synchronous branding setup finish, regardless of extension load order.
    await Promise.resolve();
    if (current !== generation) return;
    if (!isWorkspaceProject(ctx.cwd)) {
      screen?.dispose(); screen = undefined;
      const name = basename(resolve(ctx.cwd)) || ctx.cwd;
      ctx.ui.setHeader((tui, theme) => ({
        render: (width: number) => renderProjectName(name, width, theme, tui.terminal.rows < 18),
        invalidate() {},
      }));
      return;
    }
    try {
      const tree = await scanTree(repository, true);
      if (current !== generation) return;
      ctx.ui.setHeader((tui, theme) => {
        screen?.dispose();
        screen = new StartDiagram(tree, tui, theme);
        return screen;
      });
    } catch {
      if (current === generation) ctx.ui.notify("Startdiagram niet beschikbaar; gebruik /oom-start toon om opnieuw te proberen.", "warning");
    }
  };
  // Scan asynchronously: install after synchronous theme/header setup has finished.
  pi.on("session_start", (_event, ctx) => { void show(ctx); });
  pi.on("session_shutdown", () => { generation++; screen?.dispose(); screen = undefined; });
  pi.registerCommand("oom-start", {
    description: "Startscherm: toon/verberg; alleen in OomAgent ook volgende/vorige/omlaag/omhoog",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) return;
      const action = args.trim();
      if (action === "verberg") {
        generation++; screen?.dispose(); screen = undefined;
        ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
      } else if (action === "toon") await show(ctx);
      else if (["volgende", "vorige", "omlaag", "omhoog"].includes(action)) {
        if (!isWorkspaceProject(ctx.cwd)) return;
        if (!screen) await show(ctx);
        screen?.navigate(action);
      } else ctx.ui.notify("/oom-start toon | verberg | volgende | vorige | omlaag | omhoog", "info");
    },
  });
}
