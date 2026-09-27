// Everything a spectator sees over the scene: the top bar and the player
// list. It takes the spectator's UI store and the actions as props, so it
// depends on nothing in the game UI that is still changing; the wiring
// (docs/spectate.md) mounts it in GameScreen when the seat is a spectator's.

import type { Readable } from "../../store.ts";
import type { CameraMode, SpectateUiModel } from "../model.ts";
import { PlayerList } from "./PlayerList.tsx";
import { SpectatorBar } from "./SpectatorBar.tsx";

export interface SpectatorOverlayActions {
  follow(id: string): void;
  setMode(mode: CameraMode): void;
  join(): void;
  leave(): void;
}

export function SpectatorOverlay({ store, actions }: { store: Readable<SpectateUiModel>; actions: SpectatorOverlayActions }) {
  return (
    <>
      <SpectatorBar store={store} actions={actions} />
      <PlayerList store={store} onFollow={actions.follow} />
    </>
  );
}
