# Oomagent Pi configuration

- This repository contains the shared Oomagent Pi configuration, not application logic.
- Prefer safe and reversible changes.
- Inspect files before modifying them.
- Never expose secrets or `.env` values.
- Do not push or commit unless explicitly requested.

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
