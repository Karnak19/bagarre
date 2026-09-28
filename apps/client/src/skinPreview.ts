// The account panel's skin preview: one character on its own small canvas,
// standing (Idle legs, the rifle held out like in a match), turning slowly.
//
// It has its own small WebGL renderer: the game's renderer draws to the
// full-screen canvas behind the menu, and sharing it would mean copying
// pixels across every frame. This one only exists while the picker is
// mounted, draws only while its canvas is on screen, and frees everything on
// `dispose()`. The skin loads through the same cache as the game's
// (assets.ts' skinModel), so a skin previewed here is ready in the next match.

import * as THREE from "three";
import { skinOf } from "@bagarre/shared";
import { assetsLoaded, skinModel } from "./assets.ts";
import { Character, HEAD_Y } from "./character.ts";

/** Turntable speed, radians per second (a turn every ~16 s). */
const TURN_SPEED = 0.4;
/** The weapon held: the rifle. */
const WEAPON = 0;

export interface SkinPreview {
  /** Shows another skin (a SKINS id; anything else leaves the stage empty). */
  setSkin(id: string): void;
  /** Stops drawing and frees the renderer and the character. */
  dispose(): void;
}

/** Draws `skin` on `canvas` until `dispose()`. `setSkin` swaps the character. */
export function mountSkinPreview(canvas: HTMLCanvasElement, skin: string): SkinPreview {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    console.warn("[skinPreview] no WebGL, no preview", err);
    return { setSkin() {}, dispose() {} };
  }
  // The canvas' own width and height attributes already carry the pixel ratio.
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3228, 1.25));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
  sun.position.set(2, 5, 4);
  scene.add(sun);

  // A soft shadow under the feet.
  const shadowGeo = new THREE.CircleGeometry(0.55, 32);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  scene.add(shadow);

  // Framed on the body, head and hat included, a little from above; the
  // rifle reaches past the edges as it swings round.
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  const look = new THREE.Vector3(0, HEAD_Y * 0.82, 0);
  camera.position.set(0, look.y + 1.2, 5.8);
  camera.lookAt(look);

  const turntable = new THREE.Group();
  scene.add(turntable);

  let character: Character | null = null;
  let shown = "";
  /** Bumped by every setSkin, so a load that resolves late for an older pick is dropped. */
  let pick = 0;
  let disposed = false;
  let raf = 0;
  let last = -1;
  let angle = 0.6;

  const clear = () => {
    if (!character) return;
    turntable.remove(character.root);
    character.dispose();
    character = null;
  };

  const setSkin = (id: string) => {
    if (disposed || id === shown) return;
    shown = id;
    const mine = ++pick;
    clear();
    if (!skinOf(id)) return;
    void Promise.all([assetsLoaded, skinModel(id)]).then(([assets, model]) => {
      if (disposed || mine !== pick || !model || !assets.anims) return;
      try {
        character = new Character(model, { clips: assets.anims, guns: assets.guns });
        turntable.add(character.root);
      } catch (err) {
        console.warn("[skinPreview] character setup failed", err);
        character = null;
      }
    });
  };

  const frame = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = last < 0 ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    // Hidden (the panel closed but still mounted, or scrolled away in a hidden tab): skip the work.
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    angle += TURN_SPEED * dt;
    turntable.rotation.y = angle;
    // Standing still at the centre, aiming along its own +X: the turntable turns it.
    character?.update(now, dt, { x: 0, z: 0, aim: 0, alive: true, weapon: WEAPON });
    const w = canvas.width;
    const h = canvas.height;
    if (renderer.domElement.width !== w || renderer.domElement.height !== h || camera.aspect !== w / h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  };

  setSkin(skin);
  raf = requestAnimationFrame(frame);

  return {
    setSkin,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      clear();
      shadowGeo.dispose();
      shadowMat.dispose();
      // No forceContextLoss: React may mount a new preview on the same canvas
      // (StrictMode does, in dev), and a lost context can't be used again.
      renderer.dispose();
    },
  };
}
