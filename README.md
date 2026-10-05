# Oomagent Pi configuration

Shared project-specific configuration for Pi. No application logic is included.

Start Pi from this repository and approve project trust after reviewing the configuration. Use `/reload` if Pi is already running.

- `AGENTS.md`: repository instructions.
- `.pi/settings.json`: enables `grep`, `find`, `ls`, `codemode`, and `tool_search` alongside the inherited default tools.
- `.pi/APPEND_SYSTEM.md`: symlink to `.pi/system-prompt.md`, containing the always-available persona and safety guidance.
- `.pi/extensions/oomagent-context.ts`: omits local `AGENTS.md`/`AGENTS.override.md`/`CLAUDE.md` content from the model prompt for exact greetings and thanks before a task in the active branch. Real tasks, ambiguous messages and image attachments keep all rules; after a task, follow-ups keep them too. Ancestor/user instructions are never removed. Pi still discovers these files locally; this changes model context, not filesystem loading or access permissions.
- `.pi/extensions/oomagent-tools.ts`: read-only `project_info` tool returning the working directory, Git branch, and repository root. Unavailable Git values are `null`; detached HEAD has no branch.
- `.pi/skills/`: shared intake, debugging, review and agent-delivery workflows.
- `.pi/prompts/`: shared prompt templates.

Pi loads the TypeScript extensions directly and supplies their peer dependencies; no build step is needed.

`AGENTS.md` contains the ten-step development workflow: understand → Serena exploration → impact analysis → small plan → targeted changes → automated checks → functional validation → investigate failures → diff review → concise report. It is omitted from a greeting-only model request and included when work starts.

After `/reload`, start a **new session** to evaluate greeting context: existing conversations retain earlier instructions and tool output. Lazy tool descriptions are already enabled (`codemode.mode: "only"`, `inlineBudget: 0`). The always-loaded prompt is kept compact; verify recorded provider usage after a fresh `hi` with the same model and configuration. No fixed token total is guaranteed: base instructions, skill descriptions, tools and MCP configuration also contribute. The custom footer sums recorded provider usage since its last reset, including full input and cache tokens. The automated context tests check prompt sections and transitions, not provider token counts or generated answers.

## Shared prompt templates

Run `/reload` to load the templates in `.pi/prompts/` as slash commands:

- `/intake [subject]`: clarify goals, scope and acceptance criteria; does not start implementation.
- `/debugging [problem]`: investigate a bug; changes require an explicit request to fix it.
- `/code-review [scope or focus]`: read-only review of a diff, files or local changes.
- `/oplevering [agent or release]`: evidence-based delivery advice, not deployment authorization.

Arguments are optional; templates use the current conversation or ask for missing context. For example: `/code-review "API compatibility"`. Each template delegates to its existing skill, preserves safety boundaries and does not authorize commits or pushes. Prompt templates are reusable instructions, not executable checks or a security boundary.

## Shared agent-delivery skills

Run `/reload` after changes. Pi loads these skills when the task matches their descriptions; invoke them explicitly when needed:

- `/skill:agent-evaluatie`: design or assess repeatable agent tests, including tool correctness, sources, failures and human escalation.
- `/skill:prompt-injection-review`: review untrusted input, trust boundaries, tool misuse and tenant isolation. Active attack tests require explicit, bounded authorization.
- `/skill:opleverchecklist`: evidence-based go/no-go advice for customer delivery, including privacy, monitoring, budgets, support and rollback.

Each skill includes a report template under its `assets/` directory. These are instructions, not installed test frameworks or automated deployment gates. They do not authorize production actions, external data transfer, new dependencies or code changes. Unknown or unexecuted checks remain explicit. Existing questionnaire, debugging, code-review and security-review skills are retained.

## OomAgent interface

The `oomagent-swiss` theme and `.pi/extensions/oomagent-ui.ts` provide an EVE Planetary Interaction-inspired orbital workspace: charcoal panels, amber/turquoise node rings, dotted links, a restrained engineering header, a project folder panel and node-style message dividers. This is a terminal adaptation, not a graphical replica. The existing theme name is kept for compatibility. Tools and MCP configuration are unchanged.

The footer shows `Tokens totaal` for usage recorded **since the last startup, session change or `/reload`**. The counter resets immediately to zero; only new entries then count, including assistant/tool usage, summaries and cache warming across branches. Tree navigation and toggling `/oom-footer` do not reset it. Tokens include input, output, cache-read and cache-write; repeated model context counts again. `*` marks missing/invalid usage. The footer does not calculate or display costs.

Only the displayed counter resets: conversation history and Pi's actual session totals remain unchanged. Reload does not clear model context or reduce the next request's input. No session files are deleted or rewritten.

Available tools and this package’s own tools remain visible. An `Oomagent-Mouad` neon ticker bounces continuously left to right and back in spare columns; narrow terminals prioritize the counters. Animation is local rendering and makes no model requests.

The larger orbital node network remains optional; both the scene and link animation are off by default.

- `/oom-screen`: show/hide the large welcome scene (also useful after `/reload`).
- `/oom-tree`: show/hide the project folder panel (on by default). At 110 columns or wider it sits beside the header; narrower terminals stack a short preview below it. Folder/file icons are `📁`/`📄`. It asynchronously refreshes filenames every five seconds, shows a bounded two-level preview, skips symlinks, `.env` files, `.git`, `.serena` and `node_modules`, and sanitizes terminal control characters. It does not read file contents or contact Serena/MCP. Loading, empty and unreadable states are explicit; filesystem errors do not interrupt the interface. This is a header panel, not a full-height file explorer.
- `/oom-motion`: pause/resume the neon footer ticker and optional node-link animation. The ticker starts enabled; tool counts still refresh while paused.
- `/oom-footer`: toggle the single-line footer (`Tokens totaal: … | Tools: … | Eigen tools: …`) or restore Pi’s default footer. Tools counts active tools plus callable codemode/deferred tools, excluding hidden and inactive direct/model-only tools. Eigen tools is the available subset whose source file is in this package’s `.pi/extensions/` directory. Counts use runtime metadata and refresh every second, even when animation is paused. The neon ticker advances every 150 ms when enabled.
- The editor uses turquoise borders; user dividers are amber and assistant dividers turquoise. Markdown remains intact; dotted node borders are top/bottom dividers, not full native message boxes.
- For a matching full viewport, set your terminal profile's background to `#101214`. The theme colors panels but does not change global terminal preferences.
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

Requirements: Git, `tar`, a recent Node.js with `stripTypeScriptTypes` support for the existing tests, and the project's already-installed dependencies. No dependencies are installed by the gate. Dependencies are reused from the working tree; lockfile/version consistency is not independently verified. Tests execute trusted repository code with your OS permissions: the temporary snapshot is not a sandbox, and dependency files are shared. Git archive export attributes apply to the snapshot. Only top-level `tests/*.test.{ts,js,mjs,cjs}` and `tests/*.spec.{ts,js,mjs,cjs}` are selected.

Local hooks can be bypassed (for example with `--no-verify`) and do not provide server-side enforcement. Use CI and branch protection for a hard guarantee. Existing local hooks must be integrated rather than overwritten if installing this setup elsewhere.

To undo this repository's hook activation (no previous custom hooks path was configured):

```bash
git config --local --unset core.hooksPath
```
