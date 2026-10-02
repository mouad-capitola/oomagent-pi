# Oomagent Pi configuration

Shared project-specific configuration for Pi. No application logic is included.

Start Pi from this repository and approve project trust after reviewing the configuration. Use `/reload` if Pi is already running.

- `AGENTS.md`: repository instructions.
- `.pi/settings.json`: enables `grep`, `find`, `ls`, `codemode`, and `tool_search` alongside the inherited default tools.
- `.pi/APPEND_SYSTEM.md`: additional project system instructions.
- `.pi/extensions/oomagent-tools.ts`: read-only `project_info` tool returning the working directory, Git branch, and repository root. Unavailable Git values are `null`; detached HEAD has no branch.
- `.pi/skills/` and `.pi/prompts/`: reserved for future resources (currently empty; Git does not track empty directories).

Pi loads the TypeScript extension directly and supplies its peer dependencies; no build step is needed.
