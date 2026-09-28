import { findMap } from "@bagarre/shared";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { WalkScreen } from "../ui/maps/WalkScreen.tsx";

// `/maps/<id>`, walking around one map: the real arena with the free camera,
// no server and no room (walk.ts). An unknown id goes back to the list.
//
// The walk is asked for before `routeMenu()`, so the menu's attract scene
// (and its two soldiers) never starts under it. The router runs a route's
// onLeave before the next route's onEnter, but either order ends right:
// `walk(null)` brings the attract scene back only on the menu screen, and
// `/maps` or `/` entering first finds the walk on and leaves it alone.
export const Route = createFileRoute("/maps/$id")({
  beforeLoad: ({ params }) => {
    if (!findMap(params.id)) throw redirect({ to: "/maps", replace: true });
  },
  onEnter: ({ context, params }) => {
    context.engine.walk(params.id);
    context.engine.app.routeMenu();
  },
  onStay: ({ context, params }) => {
    context.engine.walk(params.id);
    context.engine.app.routeMenu();
  },
  onLeave: ({ context }) => context.engine.walk(null),
  component: WalkScreen,
});
