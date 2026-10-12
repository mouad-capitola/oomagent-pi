# Oomagent Pi configuration

- This repository contains the shared Oomagent Pi configuration, not application logic.
- Prefer safe and reversible changes.
- Inspect files before modifying them.
- Never expose secrets or `.env` values.
- Do not push or commit unless explicitly requested.

## Parallel Pi sessions

- The user assigns each Pi session its own task. Only make the changes explicitly assigned to this session; ask before making unrelated changes.
- Before editing, inspect the current file and local changes. Preserve all pre-existing work, including uncommitted and untracked work from the user or another session.
- Never delete files or directories, remove functionality, or overwrite or revert another session's changes without explicit user permission for that action.
- If tasks overlap, file ownership is unclear, or a file changes after inspection, stop and ask the user to coordinate before editing. Do not resolve overlapping edits automatically.
- Keep edits small and targeted. Do not run broad formatting, cleanup, generation, or Git operations that could modify another session's work without explicit permission.
- These instructions are a coordination agreement, not a file lock. Never assume another running session has already loaded them.

## Development workflow

Apply this workflow to concrete development tasks; keep greetings and casual conversation brief.

1. Understand the task, acceptance criteria and boundaries. Ask focused questions if ambiguity affects scope, safety or correctness.
2. Explore with Serena: relevant directories, symbols/functions, references and existing tests. Activate the correct project and read its instructions. If semantic tools are unavailable, explain the limitation and use targeted file/search tools.
3. Assess impact on frontend, backend, API, database and configuration. Discuss only affected areas; do not invent components.
4. Make a small plan: files to change and what deliberately stays unchanged. Scale the plan to the task.
5. Edit precisely: minimal changes, existing conventions, no unrelated refactors. Reuse dependencies; ask before installing or upgrading packages.
6. Inspect and run relevant tests, lint and typechecks when available. Do not invent commands or weaken tests to hide failures.
7. Validate behavior: use Lightpanda for relevant browser flows and API tests for backend behavior. Neither substitutes for visual checks; terminal UI needs terminal-specific validation. Avoid unnecessary servers or external services.
8. If a check fails, use Serena to investigate the cause, apply a focused fix and rerun relevant checks. Use a targeted fallback when needed.
9. Review the diff: remove introduced clutter, check for secrets and unintended changes, and preserve unrelated local work.
10. Report briefly: what changed, why, exact checks/results, remaining risks and untested behavior. Never claim success from unexecuted checks.

Keep safety and authorization requirements in force throughout. Do not commit, push, deploy or perform external commitments without explicit authorization.

## Default Serena and browser verification

For concrete development tasks, use Serena by default for relevant code analysis and failure investigation. For changes affecting an OomAgent browser workflow, use Lightpanda by default to verify the actual user flow, errors and resulting UI state before reporting completion; an HTTP 200 or successful MCP call alone is insufficient.

Check whether the browser session is authenticated before testing protected flows. Never assume it shares the user's browser login. Do not extract credentials, copy authentication tokens or bypass MFA to obtain a session. If authentication, browser capabilities or tools block verification, report the precise blocker and what remains untested. Do not ask users to paste passwords or MFA secrets into chat.

Use terminal-specific checks for Pi's TUI; Lightpanda is not a visual or terminal test. For tasks without a browser flow, do not launch unrelated browser checks. These defaults apply to technical tasks, not casual conversation, and do not authorize costly or destructive live actions.
