# bagarre

Isometric 3D twin-stick PvP shooter in the browser. Turborepo + Bun:
`apps/client` (Vite, Three.js game loop, React UI), `apps/server` (Colyseus 0.18),
`packages/shared` (rules, physics, maps), `packages/backend` (Convex). See
README.md for commands and architecture.

Every new feature adds or extends a Playwright spec in `apps/e2e/tests/` (see the README's "End-to-end tests").

## Child agents in their own workspaces

When subagents should work in their own workspaces (separate worktrees, work in
parallel, a task DAG, waiting on workers or escalations), use the
`/orchestration` skill to spawn and supervise them through Orca, rather than
juggling ad hoc `git worktree` checkouts by hand. Use `orca-cli` for a full
handoff of a task to another agent.
