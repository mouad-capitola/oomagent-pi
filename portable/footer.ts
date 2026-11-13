import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import registerUI from "../.pi/extensions/oomagent-ui.ts";

// Same personal HUD as the Mac, without a machine-specific import or Git path.
export default function (pi: ExtensionAPI) {
  registerUI(pi, { footerOnly: true, gitCwd: fileURLToPath(new URL("../", import.meta.url)) });
}
