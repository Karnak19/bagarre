// The spectator's keys, wheel and drag. Plain DOM listeners like input.ts and
// keys.ts, installed only while spectating and removed on leave (the
// returned function). They never touch input.ts: a spectator's game Input
// stays disabled, so no key can reach an InputMessage (see docs/spectate.md,
// "Input isolation").
//
//   Q / E, ← / →   previous / next player (switches to Follow)
//   1 / 2 / 3      Follow / Overview / Free
//   WASD           pan (Free; from Follow or Overview it switches to Free)
//   wheel          zoom (Free only: in Follow it would fight the fixed follow zoom)
//   drag           pan (Free; a drag in another mode switches to Free)

import type { CameraMode } from "./model.ts";

export interface SpectatorControlActions {
  /** Q / E and the arrows. */
  cycle(dir: 1 | -1): void;
  setMode(mode: CameraMode): void;
  mode(): CameraMode;
  /** Held WASD, as screen axes (x right, y up), each -1..1. */
  pan(x: number, y: number): void;
  drag(dxPx: number, dyPx: number): void;
  zoom(deltaY: number): void;
}

export interface SpectatorControlsOptions {
  /** The canvas drags and the wheel apply to. */
  canvas: HTMLElement;
  actions: SpectatorControlActions;
  /** False while a panel or the Esc menu is up. */
  enabled: () => boolean;
  /** Where listeners go; `window` by default (tests pass an EventTarget). */
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
}

const MODE_KEYS: Record<string, CameraMode> = { Digit1: "follow", Digit2: "overview", Digit3: "free" };
const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
/** A press that moves less than this is a click (a name, the canvas), not a drag. */
const DRAG_THRESHOLD_PX = 4;

const isEditable = (e: Event) => {
  const t = e.composedPath()[0] ?? e.target;
  return t instanceof HTMLElement && (t.isContentEditable || t.matches("input, textarea, select"));
};

/** Installs the listeners; returns the function that removes them all. */
export function installSpectatorControls({ canvas, actions, enabled, target = window }: SpectatorControlsOptions): () => void {
  const held = new Set<string>();
  const sendPan = () => {
    const x = (held.has("KeyD") ? 1 : 0) - (held.has("KeyA") ? 1 : 0);
    const y = (held.has("KeyW") ? 1 : 0) - (held.has("KeyS") ? 1 : 0);
    actions.pan(x, y);
  };
  const release = () => {
    if (held.size === 0) return;
    held.clear();
    sendPan();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!enabled() || isEditable(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const code = e.code;
    if (PAN_KEYS.has(code)) {
      if (!held.has(code)) {
        held.add(code);
        if (actions.mode() !== "free") actions.setMode("free");
        sendPan();
      }
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    if (code === "KeyQ" || code === "ArrowLeft") actions.cycle(-1);
    else if (code === "KeyE" || code === "ArrowRight") actions.cycle(1);
    else if (MODE_KEYS[code]) actions.setMode(MODE_KEYS[code]);
    else return;
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (held.delete(e.code)) sendPan();
  };
  const onVisibility = () => {
    if (document.visibilityState !== "visible") release();
  };

  // Drag: pointer capture on the canvas, so a drag that leaves it keeps going.
  let pointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let travelled = 0;
  const onPointerDown = (e: PointerEvent) => {
    if (!enabled() || e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    travelled = 0;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    travelled += Math.abs(dx) + Math.abs(dy);
    if (travelled < DRAG_THRESHOLD_PX) return;
    if (actions.mode() !== "free") actions.setMode("free");
    actions.drag(dx, dy);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    canvas.releasePointerCapture?.(e.pointerId);
  };
  const onWheel = (e: WheelEvent) => {
    if (!enabled() || actions.mode() !== "free") return;
    e.preventDefault();
    // Line and page deltas (Firefox, some mice) to pixels, roughly.
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    actions.zoom(e.deltaY * scale);
  };

  target.addEventListener("keydown", onKeyDown as EventListener, { capture: true });
  target.addEventListener("keyup", onKeyUp as EventListener);
  target.addEventListener("blur", release);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    release();
    target.removeEventListener("keydown", onKeyDown as EventListener, { capture: true });
    target.removeEventListener("keyup", onKeyUp as EventListener);
    target.removeEventListener("blur", release);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
  };
}
