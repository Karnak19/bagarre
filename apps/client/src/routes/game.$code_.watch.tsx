import { createFileRoute } from "@tanstack/react-router";
import { GameScreen } from "../ui/game/GameScreen.tsx";

// `/game/<code>/watch`, watching a game (no seat). The `_` after `$code`
// keeps it from nesting under `/game/$code`, whose onEnter would join the
// room as a player first. Taking a seat from here replaces the page with
// `/game/<code>` on the same room (app.ts' `followRole`).
export const Route = createFileRoute("/game/$code_/watch")({
  onEnter: ({ context, params }) => context.engine.app.routeWatch(params.code),
  onStay: ({ context, params }) => context.engine.app.routeWatch(params.code),
  component: GameScreen,
});
