import { createFileRoute } from "@tanstack/react-router";
import { MapsScreen } from "../ui/maps/MapsScreen.tsx";

// `/maps`, every map with its plan. It is a menu page: entering it leaves
// any game, and the attract scene stays behind it.
export const Route = createFileRoute("/maps/")({
  onEnter: ({ context }) => context.engine.app.routeMenu(),
  component: MapsScreen,
});
