import { createFileRoute, redirect } from "@tanstack/react-router";

// Anything else. `/game/...` that isn't one code (`/game/`, `/game/a/b`)
// is a broken game link: the "doesn't exist" notice. Other paths go to the menu.
const isGamePath = (pathname: string) => pathname.startsWith("/game/");

export const Route = createFileRoute("/$")({
  beforeLoad: ({ location }) => {
    if (!isGamePath(location.pathname)) throw redirect({ to: "/", replace: true });
  },
  onEnter: ({ context }) => context.engine.app.routeGame(""),
  onStay: ({ context }) => context.engine.app.routeGame(""),
  component: () => null,
});
