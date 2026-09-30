// The game pages' content (`/game/$code` and `/game/$code/watch`): the HUD
// once the room is joined, or the spectator overlay while watching. The
// cards over it (waiting, Esc menu, result) are the root's (Cards.tsx), since
// the joining card also shows on `/` during a quick match.

import { SpectatorOverlay } from "../../spectate/ui/SpectatorOverlay.tsx";
import { SpectatorStatus } from "../../spectate/ui/SpectatorStatus.tsx";
import { useEngine, useSelector } from "../hooks.ts";
import { Hud } from "./Hud.tsx";

export function GameScreen() {
  const { app, view } = useEngine();
  const inGame = useSelector(app, (s) => s.screen === "game");
  const spectating = useSelector(app, (s) => s.spectating);
  // Battle royale: out of the match, we watch the rest of it from our seat.
  const knockedOut = useSelector(view, (v) => !!v?.knockedOut);
  if (!inGame) return null;
  return spectating || knockedOut ? <Watching /> : <Hud />;
}

/** The spectator overlay, from the match's first snapshot (the Spectator is made then). */
function Watching() {
  const { app, view } = useEngine();
  // Re-render once the first snapshot is in; the match (and its spectator) don't change after.
  useSelector(view, (v) => !!v?.snapshot);
  const match = app.match;
  const spectator = match?.spectator;
  if (!match || !spectator) return null;
  const a = match.spectateActions;
  return (
    <>
      <SpectatorOverlay
        store={spectator.ui}
        actions={{ follow: a.follow, setMode: a.setMode, join: () => app.joinSeat(), leave: () => app.leave() }}
      />
      <SpectatorStatus />
    </>
  );
}
