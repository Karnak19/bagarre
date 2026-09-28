# bagarre

Isometric 3D twin-stick PvP shooter in the browser. Turborepo + Bun:
`apps/client` (Vite, Three.js game loop, React UI), `apps/server` (Colyseus 0.18),
`packages/shared` (rules, physics, maps). Accounts and match stats live in the
game server (`@colyseus/auth` + `@colyseus/database`: Postgres in production, PGlite in dev). See
README.md for commands and architecture.

Every new feature adds or extends a Playwright spec in `apps/e2e/tests/` (see the README's "End-to-end tests").

## Child agents in their own workspaces

Orca is optional: not everyone working on this repo uses it. Check with
`command -v orca` before relying on it.

- **Orca available:** when subagents should work in their own workspaces
  (separate worktrees, work in parallel, a task DAG, waiting on workers or
  escalations), use the `/orchestration` skill to spawn and supervise them
  through Orca rather than juggling ad hoc `git worktree` checkouts by hand.
  Use `orca-cli` for a full handoff of a task to another agent.
- **No Orca:** use your agent's own isolation instead (for example Claude
  Code's subagents with worktree isolation), or plain `git worktree add` with
  one branch per task. Never block on Orca being missing.
