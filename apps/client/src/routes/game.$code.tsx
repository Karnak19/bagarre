import { createFileRoute } from "@tanstack/react-router";
import { GameScreen } from "../ui/game/GameScreen.tsx";

// `/game/<code>`, one game's page (the code is the Colyseus room id).
// Entering it (a link, a listed game, Forward) joins that room; a new code on
// the same route (onStay) joins the new room. Leaving it is `/`'s onEnter.
// Full, gone or malformed codes end on the flow's notices (app.ts).
export const Route = createFileRoute("/game/$code")({
  onEnter: ({ context, params }) => context.engine.app.routeGame(params.code),
  onStay: ({ context, params }) => context.engine.app.routeGame(params.code),
  component: GameScreen,
});
