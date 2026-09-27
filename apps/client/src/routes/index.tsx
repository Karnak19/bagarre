import { createFileRoute } from "@tanstack/react-router";
import { MenuScreen } from "../ui/menu/Menu.tsx";

// `/`, the menu. Entering it (boot, Back, Main menu, Leave) leaves any game.
export const Route = createFileRoute("/")({
  onEnter: ({ context }) => context.engine.app.routeMenu(),
  component: MenuScreen,
});
