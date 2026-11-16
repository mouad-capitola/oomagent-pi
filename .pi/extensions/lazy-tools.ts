import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

// Reuse Pi's complete definitions: execution, validation, prompt rules and
// renderers stay intact. Only discovery changes; tool_search loads each schema.
// Pair with defaultTools: ["tool_search"] so settings do not activate them early.
export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const settings = pi.getSettings();
    const cwd = ctx.cwd;
    pi.registerTool({
      ...createReadToolDefinition(cwd, { autoResizeImages: settings.images?.autoResize }),
      exposure: "deferred",
    });
    pi.registerTool({
      ...createBashToolDefinition(cwd, {
        commandPrefix: settings.shellCommandPrefix, shellPath: settings.shellPath,
      }),
      exposure: "deferred",
    });
    pi.registerTool({ ...createEditToolDefinition(cwd), exposure: "deferred" });
    pi.registerTool({ ...createWriteToolDefinition(cwd), exposure: "deferred" });
    pi.registerTool({ ...createGrepToolDefinition(cwd), exposure: "deferred" });
    pi.registerTool({ ...createFindToolDefinition(cwd), exposure: "deferred" });
    pi.registerTool({ ...createLsToolDefinition(cwd), exposure: "deferred" });
  });
}
