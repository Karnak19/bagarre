import * as THREE from "three";

/**
 * Keyboard + mouse state. Uses `KeyboardEvent.code` (physical key position),
 * so WASD works on AZERTY keyboards too (the same physical keys, ZQSD).
 */
export class Input {
  private keys = new Set<string>();
  /** Cursor in normalised device coordinates (-1..1). */
  readonly ndc = new THREE.Vector2(0, 0);
  firing = false;
  hasPointer = false;
  /**
   * Running press totals, sent in every input (see InputMessage). Bumped on
   * key-down only, so auto-repeat while holding the key doesn't count.
   */
  readonly presses = { dash: 0, grenade: 0, shield: 0, reload: 0 };
  /** Called with 0-3 when a weapon key (1-4) is pressed. */
  onPick: (weapon: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (e.repeat) return;
      if (e.code === "Space") this.presses.dash++;
      else if (e.code === "KeyQ") this.presses.grenade++;
      else if (e.code === "KeyE") this.presses.shield++;
      else if (e.code === "KeyR") this.presses.reload++;
      else if (/^Digit[1-4]$/.test(e.code)) this.onPick(Number(e.code.slice(5)) - 1);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.firing = false;
    });
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.hasPointer = true;
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.firing = true;
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button === 0) this.firing = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Screen-space axes: x = right, y = up (W). Each in -1..1. */
  screenAxes(): { x: number; y: number } {
    const x = (this.down("KeyD", "ArrowRight") ? 1 : 0) - (this.down("KeyA", "ArrowLeft") ? 1 : 0);
    const y = (this.down("KeyW", "ArrowUp") ? 1 : 0) - (this.down("KeyS", "ArrowDown") ? 1 : 0);
    return { x, y };
  }
}

const _fwd = new THREE.Vector3();

/**
 * Turns screen-relative input into a world-space move vector on the ground.
 * "Up on screen" is the camera's view direction flattened onto the ground;
 * with the iso camera that is the world diagonal (-1, 0, -1), i.e. the input
 * rotated by 45 degrees. Deriving it from the camera keeps it correct if the
 * camera angle ever changes.
 */
export function screenToWorldMove(camera: THREE.Camera, axes: { x: number; y: number }) {
  camera.getWorldDirection(_fwd);
  _fwd.y = 0;
  _fwd.normalize();
  // Right = forward rotated 90 degrees clockwise when seen from above.
  const rx = -_fwd.z;
  const rz = _fwd.x;
  let mx = _fwd.x * axes.y + rx * axes.x;
  let mz = _fwd.z * axes.y + rz * axes.x;
  const len = Math.hypot(mx, mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  return { mx, mz };
}
