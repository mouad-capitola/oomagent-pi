import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const presentationRoot = fileURLToPath(new URL("../../", import.meta.url));

// Exact directory identity: aliases work, children and similarly named projects do not.
export function isWorkspaceProject(cwd) {
  try { return realpathSync(cwd) === realpathSync(presentationRoot); }
  catch { return false; }
}
