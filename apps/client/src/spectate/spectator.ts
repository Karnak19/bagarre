// One spectating session: the view-model state (model.ts), the camera
// (camera.ts) and the store the React overlay reads (ui/). The match code
// calls `onSnapshot` when a snapshot arrives and `frame` every frame; the
// overlay and the controls call the actions. Nothing here touches the
// network: joining a free seat and leaving are the caller's (`onJoin`,
// `onLeave` props of the overlay).

import { jsonEqual } from "../ui/hooks.ts";
import { Store } from "../store.ts";
import { SpectatorCamera, type CameraBounds, type SpectatorCameraOptions, type SpectatorCameraRig } from "./camera.ts";
import type { SpectatorControlActions } from "./controls.ts";
import {
  cycleTarget,
  fallbackColor,
  follow,
  initialSpectateState,
  rememberPlayers,
  spectateUiModel,
  stepSpectate,
  type CameraMode,
  type SpectateSnapshot,
  type SpectateState,
  type SpectateUiModel,
} from "./model.ts";

const EMPTY_UI: SpectateUiModel = {
  mode: "follow",
  watching: null,
  rows: [],
  spectators: 0,
  players: 0,
  maxPlayers: 0,
  canJoin: false,
};

export interface SpectatorOptions extends SpectatorCameraOptions {
  rig: SpectatorCameraRig;
  /** CSS colour of a player slot (the FFA palette once there is one). */
  colorOf?: (slot: number) => string;
}

export class Spectator implements SpectatorControlActions {
  readonly camera: SpectatorCamera;
  /** What the overlay shows. Republished only when it changes. */
  readonly ui = new Store<SpectateUiModel>(EMPTY_UI);
  private state: SpectateState = initialSpectateState;
  private prev = new Map<string, { alive: boolean; kills: number }>();
  private hasPrev = false;
  private last: SpectateSnapshot | null = null;
  private readonly colorOf: (slot: number) => string;

  constructor(options: SpectatorOptions) {
    this.camera = new SpectatorCamera(options.rig, options);
    this.colorOf = options.colorOf ?? fallbackColor;
  }

  /** The id of the player the camera follows (the sound listener sits on the camera target either way). */
  get followId(): string | null {
    return this.state.followId;
  }

  /** A new map (match start, map rotation): re-fit the overview, cut to the target. */
  setMap(bounds: CameraBounds) {
    this.camera.setBounds(bounds);
    this.camera.snap();
  }

  /**
   * A snapshot arrived (or the connection epoch changed: pass `reset` so a
   * reconnect's full resync isn't read as everyone dying at once).
   */
  onSnapshot(snap: SpectateSnapshot, now: number, reset = false) {
    if (reset) this.hasPrev = false;
    const before = this.state.followId;
    this.state = stepSpectate(this.state, this.hasPrev ? this.prev : null, snap, now);
    rememberPlayers(snap.players, this.prev);
    this.hasPrev = true;
    this.last = snap;
    if (this.state.followId !== before) this.camera.retarget();
    this.publish();
  }

  /**
   * One frame. `position(id, out)` writes the followed player's drawn
   * (interpolated) position into `out` and returns false when there is none.
   * The pending death switch is checked here too, so it fires on time even
   * between snapshots.
   */
  frame(now: number, dtSeconds: number, position: (id: string, out: { x: number; z: number }) => boolean) {
    if (this.state.pending && now >= this.state.pending.at && this.last) {
      const before = this.state.followId;
      this.state = stepSpectate(this.state, this.prev, this.last, now);
      if (this.state.followId !== before) {
        this.camera.retarget();
        this.publish();
      }
    }
    const id = this.state.followId;
    const has = id !== null && position(id, this.at);
    this.camera.update(dtSeconds, has, this.at.x, this.at.z);
  }

  private readonly at = { x: 0, z: 0 };

  /** Where the camera looks (the sound listener goes here: `setListener(s.listenerX, s.listenerZ)`). */
  get listenerX(): number {
    return this.camera.x.now;
  }

  get listenerZ(): number {
    return this.camera.z.now;
  }

  // --- Actions (overlay clicks and controls.ts) -----------------------------------

  /** Follow this player (a click on their name). */
  follow(id: string) {
    this.state = follow(this.state, id);
    this.setMode("follow");
    this.camera.retarget();
    this.publish();
  }

  cycle(dir: 1 | -1) {
    const players = this.last?.players;
    if (!players) return;
    // From Overview or Free, Q / E first goes back to whoever was followed.
    const next = this.camera.mode === "follow" ? cycleTarget(players, this.state.followId, dir) : this.state.followId;
    if (next) this.follow(next);
    else this.setMode("follow");
  }

  setMode(mode: CameraMode) {
    this.camera.setMode(mode);
    this.publish();
  }

  mode(): CameraMode {
    return this.camera.mode;
  }

  pan(x: number, y: number) {
    this.camera.setPan(x, y);
  }

  drag(dxPx: number, dyPx: number) {
    this.camera.dragBy(dxPx, dyPx);
  }

  zoom(deltaY: number) {
    this.camera.zoomBy(deltaY);
  }

  private publish() {
    if (!this.last) return;
    const next = spectateUiModel(this.last, this.state, this.camera.mode, this.colorOf);
    if (!jsonEqual(next, this.ui.getState())) this.ui.set(next);
  }
}
