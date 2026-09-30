import * as THREE from "three";
import { weaponOfKey } from "./items.ts";

/** A text field (even one in a shadow root). */
function isEditable(e: Event) {
  const t = e.composedPath()[0] ?? e.target;
  return t instanceof HTMLElement && (t.isContentEditable || t.matches("input, textarea, select"));
}

/**
 * Keyboard + mouse state. Uses `KeyboardEvent.code` (physical key position),
 * so WASD works on AZERTY keyboards too (the same physical keys, ZQSD).
 *
 * Off (`enabled = false`) while the menu or any overlay is up: keys, clicks
 * and presses are ignored and nothing is held, so the player stands still and
 * doesn't fire. Keys typed in a text field are always ignored, so typing a
 * username never moves, fires, mutes (M) or picks a weapon (the number keys).
 *
 * Battle royale (`slotMode`, set by the match): the number keys 1-3 pick a
 * gun slot instead of a loadout gun (they never call `onPick` then), the
 * mouse wheel cycles through the guns carried (`onCycle`, which the match
 * turns into a slot from its predicted kit), and F asks for a swap with the
 * gun on the floor. A slot choice is an input like a shot: `slot` plus the
 * `switch` press counter, checked by the shared step on both sides. 4 and 5
 * use a healing item (the bandage, the medkit: `heal` plus the `use`
 * counter), checked the same way. None of them is ever a loadout pick there.
 */
export class Input {
  private keys = new Set<string>();
  private on = false;
  /** Cursor in normalised device coordinates (-1..1). */
  readonly ndc = new THREE.Vector2(0, 0);
  firing = false;
  hasPointer = false;
  /**
   * Running press totals, sent in every input (see InputMessage). Bumped on
   * key-down only, so auto-repeat while holding the key doesn't count.
   */
  readonly presses = { dash: 0, grenade: 0, shield: 0, reload: 0, switch: 0, swap: 0, use: 0 };
  /** The gun slot asked for by the latest switch (InputMessage.slot, 0-2). */
  slot = 0;
  /** The healing item asked for by the latest 4 or 5 (InputMessage.heal, a HEAL_ITEMS index). */
  heal = 0;
  /** Battle royale: 1-3 are gun slots, the wheel cycles them, F swaps. */
  slotMode = false;
  /** Called with 1 (down) or -1 (up) when the wheel turns in slot mode. */
  onCycle: (dir: 1 | -1) => void = () => {};
  /** Called with the weapon id when its number key is pressed (weaponOfKey: 1 = weapon 0). */
  onPick: (weapon: number) => void = () => {};
  /** Called when G (next grenade type) is pressed. */
  onGrenadeCycle: () => void = () => {};
  /** Called when M (mute toggle) is pressed. */
  onMute: () => void = () => {};

  get enabled() {
    return this.on;
  }

  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.keys.clear();
    this.firing = false;
  }

  constructor(canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.on || isEditable(e)) return;
      this.keys.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      if (e.repeat) return;
      const weapon = weaponOfKey(e.code);
      if (e.code === "Space") this.presses.dash++;
      else if (e.code === "KeyQ") this.presses.grenade++;
      else if (e.code === "KeyE") this.presses.shield++;
      else if (e.code === "KeyR") this.presses.reload++;
      else if (e.code === "KeyM") this.onMute();
      else if (this.slotMode && /^Digit[1-3]$/.test(e.code)) this.selectSlot(Number(e.code.slice(5)) - 1);
      else if (this.slotMode && e.code === "KeyF") this.presses.swap++;
      // 4 and 5 use a healing item, right after the gun slots.
      else if (this.slotMode && (e.code === "Digit4" || e.code === "Digit5")) this.useHeal(e.code === "Digit4" ? 0 : 1);
      // The other number keys do nothing in slot mode.
      else if (weapon !== null && !this.slotMode) this.onPick(weapon);
      else if (e.code === "KeyG") this.onGrenadeCycle();
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
      if (this.on && e.button === 0) this.firing = true;
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button === 0) this.firing = false;
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.on || !this.slotMode || e.deltaY === 0) return;
        e.preventDefault();
        this.onCycle(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  /** Asks for the gun in `slot` (0-2): sent with the next input, applied by the step if there is a gun there. */
  selectSlot(slot: number) {
    this.slot = slot;
    this.presses.switch++;
  }

  /** Asks for a heal with `item` (a HEAL_ITEMS index): sent with the next input, started by the step if it can. */
  useHeal(item: number) {
    this.heal = item;
    this.presses.use++;
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
