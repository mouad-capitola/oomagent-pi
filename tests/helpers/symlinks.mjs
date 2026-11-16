import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const directoryLinkType = process.platform === "win32" ? "junction" : "dir";

// Probe the actual filesystem capability. Never enable Developer Mode or elevate.
// Only file-symlink-specific subtests may use this skip; junction checks still run.
function fileSymlinkCapability() {
  const root = mkdtempSync(join(tmpdir(), "oomagent-symlink-probe-"));
  try {
    const target = join(root, "target.txt");
    writeFileSync(target, "fixture");
    symlinkSync(target, join(root, "link.txt"), "file");
    return false;
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      return "Windows file symlinks unavailable without additional OS privileges; directory junction checks still run";
    }
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
export const fileSymlinkSkip = fileSymlinkCapability();
