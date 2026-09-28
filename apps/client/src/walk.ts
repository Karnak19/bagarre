// Walking around a map (`/maps/<id>`): the real arena a match builds (the
// same GameScene.setMap: floor, cover, props, the theme's lights), with no
// server, no room and no players, looked at through the spectator's free
// camera (spectate/camera.ts) and its controls (spectate/controls.ts). Like
// attract.ts it is a small class over the one GameScene, started and
// stopped by the engine (engine.ts' `walk()`); `stop()` gives the game its
// own camera back.
//
// The controls are the spectator's, minus everything about players: WASD
// or a drag pans (switching to Free), the wheel zooms (Free only), 2 is
// Overview and 3 is Free. 1 (Follow) and Q / E have nobody to follow.

import type { MapDef } from "@bagarre/shared";
import { setListener } from "./audio.ts";
import type { GameScene } from "./scene.ts";
import { SpectatorCamera, sceneRig } from "./spectate/camera.ts";
import { installSpectatorControls } from "./spectate/controls.ts";
import type { CameraMode } from "./spectate/model.ts";
import type { Store } from "./store.ts";
import { ui } from "./uiState.ts";

/** The camera modes a walk has: no Follow, there is nobody to follow. */
export type WalkMode = Exclude<CameraMode, "follow">;

/** What the walk's top bar shows. */
export interface WalkUi {
  /** The map walked on, null while no walk is on. */
  mapId: string | null;
  mode: WalkMode;
}

export class Walk {
  private camera: SpectatorCamera | null = null;
  private removeControls: (() => void) | null = null;

  constructor(
    private scene: GameScene,
    private canvas: HTMLCanvasElement,
    /** What the top bar reads (the engine's, so it exists before the scene does). */
    readonly ui: Store<WalkUi>,
  ) {}

  get running(): boolean {
    return !!this.camera;
  }

  /** Shows `map` and hands the camera to the free camera, at game scale over the map's centre. */
  start(map: MapDef, now: number) {
    if (this.camera && this.ui.getState().mapId === map.id) return;
    const scene = this.scene;
    scene.resetView();
    scene.setMap(map);
    scene.clearProjectiles();
    if (!this.camera) {
      const camera = new SpectatorCamera(sceneRig(scene));
      this.camera = camera;
      this.removeControls = installSpectatorControls({
        canvas: this.canvas,
        actions: {
          // Nobody to cycle through, and nobody to follow.
          cycle: () => {},
          setMode: (m) => this.setMode(m),
          mode: () => camera.mode,
          pan: (x, y) => camera.setPan(x, y),
          drag: (dx, dy) => camera.dragBy(dx, dy),
          zoom: (dy) => camera.zoomBy(dy),
        },
        enabled: () => !ui.getState().panel,
      });
    }
    const camera = this.camera;
    // Overview re-fits to the new map by itself; Free starts over the centre.
    camera.setBounds({ halfX: map.halfX, halfZ: map.halfZ });
    if (camera.mode !== "overview") {
      camera.x.now = camera.x.to = 0;
      camera.z.now = camera.z.to = 0;
      // A new camera is in Follow at game scale: Free keeps that zoom.
      if (camera.mode === "follow") camera.setMode("free");
    }
    camera.snap();
    this.ui.set({ mapId: map.id, mode: camera.mode === "overview" ? "overview" : "free" });
    this.frame(now, 0);
  }

  /** The bar's switcher and the 2 / 3 keys. Follow is ignored. */
  setMode(mode: CameraMode) {
    if (!this.camera || mode === "follow") return;
    this.camera.setMode(mode);
    this.ui.patch({ mode });
  }

  /** Removes the controls and gives the scene the game's own camera back. */
  stop() {
    if (!this.camera) return;
    this.removeControls?.();
    this.removeControls = null;
    this.camera = null;
    this.ui.set({ mapId: null, mode: "free" });
    // The rig wrote the frustum behind GameScene's back: resize rebuilds it
    // from the scene's own view height (like match.ts after spectating).
    this.scene.resize();
  }

  frame(_now: number, dtMs: number) {
    const camera = this.camera;
    if (!camera) return;
    camera.update(dtMs / 1000, false, 0, 0);
    setListener(camera.x.now, camera.z.now);
  }
}
