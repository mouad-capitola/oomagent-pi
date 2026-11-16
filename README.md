# Oomagent Pi configuration

Shared project-specific configuration for Pi. No application logic is included.

Start Pi from this repository and approve project trust after reviewing the configuration. Use `/reload` if Pi is already running.

- `AGENTS.md`: repository instructions.
- `.pi/settings.json`: starts new sessions with only `tool_search`; `.pi/extensions/lazy-tools.ts` retains Pi's seven native tools with deferred discovery, alongside the fifteen deferred custom tools. The built-in codemode extension remains disabled with `extensions: ["-builtin:codemode"]`; MCP's existing `autoEnableCodemode: false` is retained. Reload and start a new session to evaluate the initial declaration set. See `LAZY-TOOLS.md`.
- `.pi/APPEND_SYSTEM.md`: regular UTF-8 copy of `.pi/system-prompt.md`, containing the always-available persona and safety guidance without requiring Windows symlink privileges. Keep both files in sync; tests compare their full contents (allowing LF/CRLF).
- `.pi/extensions/oomagent-context.ts`: omits local `AGENTS.md`/`AGENTS.override.md`/`CLAUDE.md` content from the model prompt for exact greetings and thanks before a task in the active branch. Real tasks, ambiguous messages and image attachments keep all rules; after a task, follow-ups keep them too. Ancestor/user instructions are never removed. Pi still discovers these files locally; this changes model context, not filesystem loading or access permissions.
- `.pi/extensions/oomagent-tools.ts`: read-only `project_info` tool returning the working directory, Git branch, and repository root. Unavailable Git values are `null`; detached HEAD has no branch.
- `.pi/skills/`: shared intake, debugging, review and agent-delivery workflows.
- `.pi/prompts/`: shared prompt templates.

Pi loads the TypeScript extensions directly and supplies their peer dependencies; no build step is needed.

`AGENTS.md` contains the ten-step development workflow: understand → Serena exploration → impact analysis → small plan → targeted changes → automated checks → functional validation → investigate failures → diff review → concise report. It is omitted from a greeting-only model request and included when work starts.

After `/reload`, start a **new session** to evaluate greeting context: existing conversations retain earlier instructions and tool output. Codemode is disabled; `tool_search` loads native, custom and MCP tools on demand without scripts. The inert `codemode.mode: "on"` setting also avoids hiding standard tools if codemode is explicitly re-enabled later. The always-loaded prompt is kept compact; verify recorded provider usage after a fresh `hi` with the same model and configuration. No fixed token total is guaranteed: base instructions, skill descriptions, tools and MCP configuration also contribute. The custom footer sums recorded provider usage since its last reset, including full input and cache tokens. The automated context tests check prompt sections and transitions, not provider token counts or generated answers.

## MCP on Windows and macOS

`.pi/mcp.json` uses two small platform adapters, without new npm dependencies:

- `scripts/lightpanda-mcp.mjs`: keeps `~/.local/bin/lightpanda` on macOS/Linux; Windows uses the official Lightpanda 1.0.4 Docker image pinned by digest. Docker Desktop must be running. The container uses stdio, publishes no ports, mounts no host files and disables telemetry. The existing private-network restrictions and robots policy remain enabled. **On Windows, `127.0.0.1` inside Lightpanda is the container, not the Windows host**; local Windows application flows need separate, explicitly scoped networking setup.
- `scripts/zap-mcp-key.mjs`: reads the local ZAP MCP key using PowerShell's XML reader on Windows or Python's ElementTree on macOS/Linux. Config locations are `~/ZAP/config.xml`, `~/Library/Application Support/ZAP/config.xml` and `~/.ZAP/config.xml`, respectively. The key is passed only to Pi's Authorization-header resolver, never stored in this repository. Do not run the helper directly in a shared terminal: its stdout is the key.

Playwright uses the already-installed Google Chrome through `browser.launchOptions.channel: "chrome"` in `.pi/playwright-mcp.json`; it does not require a separate Playwright Chromium download. Chrome must be installed on each host using this shared configuration. It opens a separate visible browser with an isolated in-memory profile, without importing personal cookies, logins or browser tabs. The pinned MCP package and disabled `oomagent-pi` bridge are unchanged. Mac installations still require their existing native Lightpanda, Python 3 and running ZAP with MCP enabled; no Mac runtime was available for verification.

### Windows setup and restart

The verified installation uses [official Lightpanda Docker images](https://github.com/lightpanda-io/browser), [Temurin JRE 17.0.21+9](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.21%2B9) and [ZAP 2.17.0 Crossplatform](https://github.com/zaproxy/zaproxy/releases/tag/v2.17.0). The portable Java and ZAP ZIPs were SHA-256 verified and extracted below `%LOCALAPPDATA%/OomAgent`, without changing system PATH or requiring administrator rights. ZAP's `-cmd -addoninstall mcp` installed MCP 0.4.0 and its required add-ons.

Install the pinned Lightpanda image once (the launcher deliberately never pulls implicitly):

```sh
docker pull lightpanda/browser@sha256:a9d899882899802bc3a6b82622a7ca394f8e1b828452869a0965d2e5097e6116
```

After a restart, start Docker Desktop and ZAP. If local PowerShell scripts are allowed, `powershell -NoProfile -File scripts/start-zap-windows.ps1` starts the portable ZAP in the background, with logs under `%LOCALAPPDATA%/OomAgent/logs`. It refuses to start if either listener port is already occupied. Stop that instance using its reported PID when no longer needed; no Windows startup task or service is installed.

If PowerShell blocks script files, leave the execution policy unchanged. ZAP also supports a direct Java command in a separate PowerShell terminal (keep it open; Ctrl+C stops ZAP):

```powershell
$base = Join-Path $env:LOCALAPPDATA 'OomAgent'
& "$base\java-17.0.21\jdk-17.0.21+9-jre\bin\java.exe" -jar "$base\zap-2.17.0\ZAP_2.17.0\zap-2.17.0.jar" -daemon -silent -host 127.0.0.1 -port 18080 -config mcp.enabled=true -config mcp.port=8282 -config mcp.securityKeyEnabled=true -config mcp.secureOnly=false -config mcp.recordInHistory=false
```

ZAP listens only on loopback: MCP on `127.0.0.1:8282`, proxy on `127.0.0.1:18080`. The MCP endpoint retains the existing local HTTP transport with authentication required; never forward or expose these ports. No targets, scans, system proxy changes or certificate installation are part of startup. The portable install does not include Firefox; Firefox-dependent ZAP browser flows need separate setup and are not verified here.

Run `pi mcp list`, then `/reload` inside an existing Pi session. Use `/mcp` to inspect or reconnect servers. Regression checks: `node --test tests/mcp-config.test.mjs tests/mcp-platform.test.mjs tests/playwright-mcp.test.mjs`. These tests do not install software, start Docker/ZAP or scan any target.

## Shared prompt templates

Run `/reload` to load the templates in `.pi/prompts/` as slash commands:

- `/intake [subject]`: clarify goals, scope and acceptance criteria; does not start implementation.
- `/debugging [problem]`: investigate a bug; changes require an explicit request to fix it.
- `/code-review [scope or focus]`: read-only review of a diff, files or local changes.
- `/oplevering [agent or release]`: evidence-based delivery advice, not deployment authorization.

Arguments are optional; templates use the current conversation or ask for missing context. For example: `/code-review "API compatibility"`. Each template delegates to its existing skill, preserves safety boundaries and does not authorize commits or pushes. Prompt templates are reusable instructions, not executable checks or a security boundary.

## Libraries before custom code

The [`libraries-first` skill](.pi/skills/libraries-first/SKILL.md) applies to tests, debugging, code changes, tooling and integrations. Check existing dependencies and platform APIs first, then research suitable libraries before building custom infrastructure. Report unsuitable options or blocked research explicitly and discuss a custom alternative before implementing it. Installing or upgrading still requires approval.

Run `/reload` to discover it; `/skill:libraries-first [task]` loads it explicitly. Automatic skill selection is model-driven, not guaranteed. `node --test tests/skills.test.mjs` checks discovery and required instruction text, not model compliance.

## Shared agent-delivery skills

Run `/reload` after changes. Pi loads these skills when the task matches their descriptions; invoke them explicitly when needed:

- `/skill:agent-evaluatie`: design or assess repeatable agent tests, including tool correctness, sources, failures and human escalation.
- `/skill:prompt-injection-review`: review untrusted input, trust boundaries, tool misuse and tenant isolation. Active attack tests require explicit, bounded authorization.
- `/skill:opleverchecklist`: evidence-based go/no-go advice for customer delivery, including privacy, monitoring, budgets, support and rollback.

Each skill includes a report template under its `assets/` directory. These are instructions, not installed test frameworks or automated deployment gates. They do not authorize production actions, external data transfer, new dependencies or code changes. Unknown or unexecuted checks remain explicit. Existing questionnaire, debugging, code-review and security-review skills are retained.

## OomAgent interface

`.pi/extensions/oomagent-start.ts` installs a persistent, read-only diagram above the editor showing this repository's actual names (not the session's unrelated cwd). No overlay, dismissal or keyboard interception: typing, arrows and Enter keep their normal editor behavior. `📁 oomagent-pi` is centered above an organigram with folder columns and multiple files stacked underneath each branch. The diagram uses the middle 60% of terminal width (approximately 20% margin per side) and at most 40% of terminal rows, leaving room for chat/editor/footer. Root files and collapsed items share an explicitly labelled presentation column, not a fabricated directory.

`/oom-start volgende` and `vorige` change column groups; `omlaag` and `omhoog` scroll longer branches. Row/group counts indicate remaining content. `/oom-start verberg` hides it; `/oom-start toon` rescans and shows it. `/oom-start` lists these commands. Startup, reload and session switches reinstall the widget.

The root is depth 0; show three levels below it, including hidden names. `.git` and `node_modules` are marked collapsed, depth-limited folders are marked, and symlinks are labelled but never traversed. No file contents or credentials are read. Unreadable/disappeared paths and the defensive 10,000-item scan limit are explicitly marked. Pi's native widget, ScrollView and Unicode width helpers are reused, without new dependencies. Very narrow terminals clip labels/help; very short terminals prioritize the editor and may only show the diagram heading. Enlarge the terminal to see more files at once.

The workspace extension (`.pi/extensions/oomagent-workspace.ts`) starts directly in chat, without the date/`ready` welcome screen. Open its project/file panels explicitly with `/workspace` or `F2`; existing workspace commands and draft recovery remain available.

The `oomagent-swiss` theme and `.pi/extensions/oomagent-ui.ts` provide an EVE Planetary Interaction-inspired orbital workspace: charcoal panels, amber/turquoise node rings, dotted links, a restrained engineering header, a project folder panel and node-style message dividers. This is a terminal adaptation, not a graphical replica. The existing theme name is kept for compatibility. The startup diagram leaves this header, workspace and footer functionality intact.

The footer shows `Tokens totaal` for usage recorded **since the last startup, session change or `/reload`**. The counter resets immediately to zero; only new entries then count, including assistant/tool usage, summaries and cache warming across branches. Tree navigation and toggling `/oom-footer` do not reset it. Tokens include input, output, cache-read and cache-write; repeated model context counts again. `*` marks missing/invalid usage. The footer does not calculate or display costs.

Only the displayed counter resets: conversation history and Pi's actual session totals remain unchanged. Reload does not clear model context or reduce the next request's input. No session files are deleted or rewritten.

Available tools and this package’s own tools remain visible. An `Oomagent-Mouad` neon ticker bounces continuously left to right and back in spare columns; narrow terminals prioritize the counters. Animation is local rendering and makes no model requests.

The second footer line shows `Reactietijd` as minutes and seconds (`0m 59s` → `1m 00s`), counting thinking, tool calls and automatic continuations until `agent_settled`. It updates live and keeps the last duration until the next request; startup/reload resets it. `Git` shows the local branch, changed-file count and ahead/behind counts when an upstream exists. Git refreshes asynchronously every five seconds and after a response, without fetching; unavailable Git is explicit. Narrow terminals truncate each line safely.

The third footer line shows the current `Thinking` level and selected `provider/model`. Both are read from Pi at render time and refresh when the model or thinking level changes, including while animation is paused. No extra model requests are made.

Next to the model, the HUD shows `ChatGPT week 17%` (subscription quota **used**)
and `CTX 23.0% / 272k` (current context usage and model capacity). These are different
limits. Capacity comes from Pi, not a fixed 272k value. Unknown quota/context is `?%`,
never an invented zero. The existing cumulative TOKENS counter is unchanged.

Quota refreshes for Codex models in TUI mode on startup/model change and at most once
per minute during a session. It uses Pi's credential resolver and only the fixed
`https://chatgpt.com/backend-api/wham/usage` endpoint, without redirects or retries.
No credentials or provider error bodies are logged or persisted. This is a usage
lookup, not a model request. Non-Codex models show context only; requests/timers are
cancelled on switch/shutdown and old snapshots expire. `/chatgpt-limit` shows the
same values without installing another footer.

Project `.pi/settings.json` filters out the installed `pi-chatgpt-limit` package's
standalone extension (`extensions: []`), preventing two competing footers/commands.
The npm package remains installed and unchanged outside this project's override.
The integrated implementation is `.pi/lib/footer-limits.ts`. Use `/reload` to apply.

The larger orbital node network remains optional; both the scene and link animation are off by default.

- `/oom-screen`: show/hide the large welcome scene (also useful after `/reload`).
- `/oom-tree`: show/hide the project folder panel (on by default). At 110 columns or wider it sits beside the header; narrower terminals stack a short preview below it. Folder/file icons are `📁`/`📄`. It asynchronously refreshes filenames every five seconds, shows a bounded two-level preview, skips symlinks, `.env` files, `.git`, `.serena` and `node_modules`, and sanitizes terminal control characters. It does not read file contents or contact Serena/MCP. Loading, empty and unreadable states are explicit; filesystem errors do not interrupt the interface. This is a header panel, not a full-height file explorer.
- `/oom-motion`: pause/resume the neon footer ticker and optional node-link animation. The ticker starts enabled; tool counts still refresh while paused.
- `/oom-footer`: toggle the three-line footer (`Tokens totaal: … | Tools: … | Eigen tools: …`) or restore Pi’s default footer. Tools counts active tools plus callable codemode/deferred tools, excluding hidden and inactive direct/model-only tools. Eigen tools is the available subset whose source file is in this package’s `.pi/extensions/` directory. Counts use runtime metadata and refresh every second, even when animation is paused. The neon ticker advances every 150 ms when enabled.
- User/assistant message dividers span the same available width as Markdown, including terminals wider than 110 columns; content is not truncated or rewritten to fit a shorter divider.
- Codemode's code and textual results share a closed purple square-corner frame (`┏━┓`, `┃`, `┗━┛`). Pi's original renderers still handle highlighting, nested-call status, errors, streaming and expansion. Inline images remain rendered by Pi separately. This uses Pi 1.0.4's renderer-composition API and never changes tool execution. Tests can target that runtime with `PI_TEST_RUNTIME_DIST=/path/to/pi-coding-agent/dist node --test tests/terminal-frames.test.ts`.
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

Requirements: Git, `tar`, a recent Node.js with `stripTypeScriptTypes` support for the existing tests, and the project's already-installed dependencies. On Windows the gate selects the system `tar.exe` (Git Bash's GNU tar misinterprets drive letters) and uses a directory junction to reuse snapshot dependencies. No dependencies are installed by the gate. Dependencies are reused from the working tree; lockfile/version consistency is not independently verified. Tests execute trusted repository code with your OS permissions: the temporary snapshot is not a sandbox, and dependency files are shared. Git archive export attributes apply to the snapshot. Only top-level `tests/*.test.{ts,js,mjs,cjs}` and `tests/*.spec.{ts,js,mjs,cjs}` are selected.

Local hooks can be bypassed (for example with `--no-verify`) and do not provide server-side enforcement. Use CI and branch protection for a hard guarantee. Existing local hooks must be integrated rather than overwritten if installing this setup elsewhere.

To undo this repository's hook activation (no previous custom hooks path was configured):

```bash
git config --local --unset core.hooksPath
```

## Cross-platform test setup

Run the complete top-level suite with `node --test tests/*.test.mjs tests/*.test.ts`. The Pi peers must resolve from this project; a global installation alone does not satisfy Node's bare imports. This Windows checkout reuses its already-installed `pi-coding-agent`, `pi-ai` and `pi-tui` through local directory junctions under ignored `node_modules/@earendil-works/`. No packages or global settings were changed. On another machine, use existing project dependencies or explicitly approve their installation first. `PI_TEST_HOST` can select an existing host for SDK tests, but does not replace dependency resolution for all tests.

Tests use Node's runner and Pi's existing Jiti loader, including on Node 26. Directory-link security checks use real Windows junctions. File-symlink tests probe OS support and report explicit skips if privileges are unavailable; no elevation or Developer Mode change is attempted. POSIX permission-bit tests are also explicitly skipped on Windows; injected directory-read errors are still tested on every platform. These skips are limitations, not successful checks of those OS features. Unix-only filenames also retain parser/sanitization coverage without creating invalid Windows filenames.

The append prompt is a regular file in Git, not a symlink placeholder. Its full safety/persona contents must match `.pi/system-prompt.md` on every platform. The Git gate still scans secrets, validates whitespace and tests the exact staged/outgoing snapshot; no checks are bypassed.

## Offline split-pane UI prototype

An opt-in layout preview is available in [`prototypes/oomagent-layout/`](prototypes/oomagent-layout/README.md).
Start `node prototypes/oomagent-layout/preview.mjs` from this repository in a separate terminal.
It puts WhatsApp-style chat and input on the left, simulated CodeMode output on the right,
and reuses the existing footer across the full width. It does **not** connect to an agent,
execute tools, load credentials or change the running Pi interface. Ctrl+C closes it.

### Secretcontrole vóór Git-acties

`scripts/git-preflight.mjs` controleert nu ook de exacte index-snapshot (pre-commit) en elke uitgaande commit (pre-push) op bekende credentialpatronen en private bestanden, vóór tests draaien. Alleen paden, regels en regelnummers worden gemeld, nooit gematchte waarden. De bestaande hooks gebruiken deze controle; andere repositories krijgen niet automatisch dezelfde hooks.

Los scannen, zonder wijzigingen aan index of geschiedenis:

```sh
node scripts/secret-scan.mjs --worktree /pad/naar/repository
node scripts/secret-scan.mjs --tree /pad/naar/repository HEAD
node scripts/secret-scan.mjs --history /pad/naar/repository
```

Dit is detectie, geen veiligheidsgarantie: binaire inhoud wordt niet inhoudelijk beoordeeld; blobs boven 2 MiB blokkeren goedkeuring. Lokale env-bestanden worden niet geopend. Historische Git-blobs worden lokaal gescand zonder waarden te tonen. Een eerder gecommitte sleutel vraagt om intrekken/rotatie én afgesproken geschiedenisopschoning; verwijderen uit de huidige code is niet genoeg. Lokale hooks zijn omzeilbaar en vervangen geen beschermde branches of server-side secret protection.
