# Project memory instructions

- Treat every file under `sources/` as read-only reference material; do not edit, rename, move, or delete it.
- Read `PROJECT_MEMORY.md` before planning, delegating, or implementing project work.
- Treat it as the shared cross-session memory for Codex, sub-agents, and Claude Code.
- Update it after a durable product or architecture decision, a completed milestone, or a change to the next action.
- Keep it concise and factual. Never store secrets, credentials, PDF contents, question answers, or transient logs.
- When delegating to Claude Code through OmniRoute, explicitly include `PROJECT_MEMORY.md` in the task prompt because the configured launcher uses Claude Code `--bare` mode.
