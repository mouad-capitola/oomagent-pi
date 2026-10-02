import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2];
const git = (...args) => execFileSync("git", args, { encoding: "utf8", timeout: 30_000 }).trim();

function checkSnapshot(root, revision, base) {
  const temp = mkdtempSync(join(tmpdir(), "oomagent-preflight-"));
  try {
    // Test an isolated snapshot, never the unstaged working tree.
    const archive = join(temp, "snapshot.tar");
    execFileSync("git", ["archive", "--format=tar", "--output", archive, revision], { cwd: root, timeout: 30_000 });
    execFileSync("tar", ["-xf", archive, "-C", temp], { timeout: 30_000 });
    rmSync(archive);
    const tests = join(temp, "tests");
    if (!existsSync(tests)) throw new Error("Geen tests in de gecontroleerde snapshot.");
    const testFiles = readdirSync(tests).filter(name => /\.(test|spec)\.(mjs|cjs|js)$/.test(name));
    if (!testFiles.length) throw new Error("Geen ondersteunde tests in de snapshot.");
    // Reuse installed dependencies without installing or changing packages.
    // Dependency versions are NOT independently verified by this gate.
    if (existsSync(join(temp, "node_modules"))) throw new Error("Snapshot bevat node_modules; controle gestopt.");
    if (existsSync(join(root, "node_modules"))) symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
    console.log("\nOomAgent controle: " + revision);
    execFileSync("git", ["diff", "--check", base, revision], { cwd: root, stdio: "inherit", timeout: 30_000 });
    execFileSync(process.execPath, ["--test", ...testFiles.map(name => join("tests", name))], {
      cwd: temp, stdio: "inherit", timeout: 120_000,
      // Nested Node tests and Git fixtures must not inherit the parent runner
      // or the Git hook's repository/index environment.
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT" && !key.startsWith("GIT_"))),
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try {
  if (!["pre-commit", "pre-push"].includes(mode)) throw new Error("Gebruik: git-preflight.mjs pre-commit|pre-push");
  const root = git("rev-parse", "--show-toplevel");
  const emptyTree = git("hash-object", "-t", "tree", "--stdin");
  if (mode === "pre-commit") {
    let base = emptyTree;
    try { base = git("rev-parse", "--verify", "HEAD"); } catch { /* Initial commit. */ }
    checkSnapshot(root, git("write-tree"), base);
  } else {
    const updates = readFileSync(0, "utf8").trim();
    const commits = new Set();
    for (const line of updates ? updates.split("\n") : []) {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4) throw new Error("Ongeldige pre-push invoer.");
      const [, localOid, , remoteOid] = fields;
      if (!/^[a-f0-9]{40,64}$/.test(localOid) || !/^[a-f0-9]{40,64}$/.test(remoteOid)) throw new Error("Ongeldige Git object-id.");
      if (/^0+$/.test(localOid)) continue; // Ref deletion sends no commits.
      const tip = git("rev-parse", localOid + "^{commit}");
      let range = [tip];
      if (!/^0+$/.test(remoteOid)) {
        try {
          const remote = git("rev-parse", "--verify", remoteOid + "^{commit}");
          range = [remote + ".." + tip];
        } catch {
          console.log("Remote basis ontbreekt lokaal: controleer de volledige uitgaande geschiedenis.");
        }
      }
      // New refs (or unknown remote bases): check all reachable commits.
      const list = git("rev-list", "--reverse", ...range);
      for (const commit of list ? list.split("\n") : []) commits.add(commit);
    }
    for (const commit of commits) {
      const parents = git("rev-list", "--parents", "-n", "1", commit).split(" ");
      checkSnapshot(root, commit, parents[1] ?? emptyTree);
    }
  }
  console.log("\nOomAgent: controles geslaagd.");
} catch (error) {
  console.error("\nOomAgent: commit/push GEBLOKKEERD. " + error.message);
  console.error("Bespreek de fout met OomAgent. Bestanden worden pas na jouw akkoord aangepast.");
  console.error("Controleer daarna opnieuw en start commit/push zelf opnieuw.");
  process.exitCode = 1;
}
