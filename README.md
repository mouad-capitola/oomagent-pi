# Oomagent Pi configuration

Shared project-specific configuration for Pi. No application logic is included.

Start Pi from this repository and approve project trust after reviewing the configuration. Use `/reload` if Pi is already running.

- `AGENTS.md`: repository instructions.
- `.pi/settings.json`: enables `grep`, `find`, `ls`, `codemode`, and `tool_search` alongside the inherited default tools.
- `.pi/APPEND_SYSTEM.md`: additional project system instructions.
- `.pi/extensions/oomagent-tools.ts`: read-only `project_info` tool returning the working directory, Git branch, and repository root. Unavailable Git values are `null`; detached HEAD has no branch.
- `.pi/skills/` and `.pi/prompts/`: reserved for future resources (currently empty; Git does not track empty directories).

Pi loads the TypeScript extensions directly and supplies their peer dependencies; no build step is needed.

## OomAgent-Mouad interface

The `oomagent-swiss` theme and `.pi/extensions/oomagent-ui.ts` add a Swiss Alps welcome scene with an animated waterfall and multiverse ring. After the first message the large scene collapses; a compact animated brand remains beside the editor.

- `/oom-screen`: show/hide the large welcome scene (also useful after `/reload`).
- `/oom-motion`: pause/resume animation.
- `/oom-footer`: toggle the compact black footer (`π OomAgent | <branch> | <eigen> eigen | <totaal> totaal | Ready ✓`) or restore Pi’s default footer. The Git segment shows the branch, `✓` for a clean working tree or `●N` for the number of files still to commit (including staged, unstaged and untracked files, counting each file once). It also shows the staged subset, new files and conflicts where applicable. `↑N ↓N` are commits ahead of/behind the configured upstream based on local refs; no network fetch is performed. Without an upstream it says `geen upstream`; detached HEAD omits sync counts. Git reads run asynchronously with a three-second timeout, outside rendering; unavailable status shows `Git ?`, not a misleading clean state. The tool count includes active tools plus callable codemode/deferred tools, excluding hidden and inactive direct/model-only tools. The own-tool count is the available subset whose source file is in this package’s `.pi/extensions/` directory; both counts use runtime metadata, not fixed tool names or numbers. Values are read on each render, with a one-second refresh even when animation is paused. While the agent works, status is `Working…`; without a branch it shows `geen branch`.
- Your editor and message dividers are red; assistant message dividers are green. Markdown remains intact. These are top/bottom dividers, not full native message boxes.
- UI panels are black. Set your terminal profile's background to black as well for an entirely black viewport; the extension does not change global terminal preferences.
- UI customization runs only in interactive terminal mode, not RPC/print mode. Timers are cleaned up on disposal and session shutdown.

## Local commit and push checks

This repository uses `.githooks/pre-commit` and `.githooks/pre-push`, backed by `scripts/git-preflight.mjs`.

- Before committing: checks whitespace errors and runs the top-level Node.js tests against an isolated snapshot of the Git index, not unstaged edits.
- Before pushing: checks every outgoing commit against its first parent and runs its snapshot's tests. Deleting a remote ref needs no test run. A new remote ref or unavailable remote base causes the entire reachable history to be checked, so older commits without tests may block a push.
- Failed checks, missing tests, errors and timeouts block the operation. Tests have a two-minute limit per snapshot.
- The hooks do not fix, stage, commit or push files. Discuss any failure with OomAgent; approve changes explicitly, then review/stage them and retry the operation yourself.
- These are deterministic test/whitespace checks, not an automatic AI code or security review. No code is sent to a model provider by the hooks.

Activate only in this repository:

```bash
chmod +x .githooks/pre-commit .githooks/pre-push
git config --local core.hooksPath .githooks
```

Run the current staged checks without committing:

```bash
node scripts/git-preflight.mjs pre-commit
```

Requirements: Git, `tar`, a recent Node.js with `stripTypeScriptTypes` support for the existing tests, and the project's already-installed dependencies. No dependencies are installed by the gate. Dependencies are reused from the working tree; lockfile/version consistency is not independently verified. Tests execute trusted repository code with your OS permissions: the temporary snapshot is not a sandbox, and dependency files are shared. Git archive export attributes apply to the snapshot. Only top-level `tests/*.test.{js,mjs,cjs}` and `tests/*.spec.{js,mjs,cjs}` are selected.

Local hooks can be bypassed (for example with `--no-verify`) and do not provide server-side enforcement. Use CI and branch protection for a hard guarantee. Existing local hooks must be integrated rather than overwritten if installing this setup elsewhere.

To undo this repository's hook activation (no previous custom hooks path was configured):

```bash
git config --local --unset core.hooksPath
```
