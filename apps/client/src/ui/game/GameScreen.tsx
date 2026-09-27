// The `/game/$code` route's page: the HUD, once the room is joined. The
// cards over it (waiting, Esc menu, result) are the root's (Cards.tsx), since
// the joining card also shows on `/` during a quick match.

import { useEngine, useSelector } from "../hooks.ts";
import { Hud } from "./Hud.tsx";

export function GameScreen() {
  const { app } = useEngine();
  const inGame = useSelector(app, (s) => s.screen === "game");
  return inGame ? <Hud /> : null;
}
