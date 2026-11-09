import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { inventory } from "../lib/pi-inventory.mjs";

export default function (pi: ExtensionAPI) {
  pi.registerTool(defineTool({
    name: "pi_inventory",
    label: "Pi inventory",
    description: "Read-only comparison of project-local skills, statically declared own tools, MCP server names/enabled flags and recent added Git files. Defaults to oomagent-pi and oomagent-pi-upgrade under ~/Projects; detects upgrade workspace/.pi. No credentials, network or tool execution. Current-session registered/active names are separate from on-disk presence; operational testing is not performed. Output capped at 40 KB/1500 lines.",
    parameters: Type.Object({
      projects: Type.Optional(Type.Array(Type.String({ description: "Directory name under ~/Projects, not a path" }), { minItems: 1, maxItems: 2, uniqueItems: true })),
      days: Type.Optional(Type.Integer({ minimum: 1, maximum: 365, description: "Git added-file lookback, default 14 days" })),
    }, { additionalProperties: false }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute(_id, params, signal, _update, ctx) {
      const deadline = AbortSignal.timeout(30000);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      const report = await inventory({ root: join(homedir(), "Projects"), ...params, signal: combined });
      const valid = (name: string) => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(name);
      const registered = pi.getAllTools().map(tool => tool.name).filter(valid).sort();
      const active = pi.getActiveTools().filter(valid).sort();
      const data = {
        ...report,
        currentSession: {
          cwd: ctx.cwd,
          registeredTools: registered.slice(0, 200),
          activeTools: active.slice(0, 200),
          truncated: registered.length > 200 || active.length > 200,
          scope: "Only this running session; not proof of either project's standalone loadout or tool health.",
          operationalTests: "not performed",
        },
      };
      const output = truncateHead(JSON.stringify(data, null, 2), { maxBytes: 40000, maxLines: 1500 });
      return {
        content: [{ type: "text", text: output.content + (output.truncated ? "\n[Inventory truncated; request one project. No full-output file was written.]" : "") }],
        details: { projectCount: report.projects.length, truncated: output.truncated },
      };
    },
  }));
}
