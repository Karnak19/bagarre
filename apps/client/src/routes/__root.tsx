import { createRootRouteWithContext, retainSearchParams, stripSearchParams } from "@tanstack/react-router";
import { validateDevSearch } from "../config.ts";
import type { RouterContext } from "../router.tsx";
import { Shell } from "../ui/Shell.tsx";

// The dev switches are typed here (validateSearch) and ride along on every
// navigation (retainSearchParams), except the one-shot `?play`.
export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: validateDevSearch,
  search: { middlewares: [retainSearchParams(["map", "lag", "server"]), stripSearchParams(["play"])] },
  component: Shell,
});
