// Bullet tracers: one geometry per gun (its TracerLook, items.ts), built once
// and shared by every bullet of that gun, and one material for all of them.
//
// A tracer is a small near-white head with a warm streak behind it that
// fades out, like a real tracer round seen on camera, not an even glowing
// bar. The head sits at the origin and the streak runs back along -Z, so a
// mesh turned with lookAt (+Z towards the target) has its head at the
// bullet's position and its tail behind it. Colours and fade are vertex
// colours with alpha: no texture, no shader of our own.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { TracerLook } from "./items.ts";

/** The head: warm near-white. */
const HEAD = new THREE.Color(0xfff6dc);
/** The streak, just behind the head: pale yellow-orange... */
const STREAK = new THREE.Color(0xffd27a);
/** ...turning a deeper orange towards the tail tip, where it is transparent. */
const TAIL = new THREE.Color(0xff8a2a);
/** The head is this much thicker than the streak, so it reads as the round itself. */
const HEAD_SCALE = 1.35;

/** Paints a box's vertices: `fn(t)` gives colour and alpha, t = 0 at the head end (z = 0) to 1 at the tail tip (z = -length). */
function paint(g: THREE.BufferGeometry, length: number, fn: (t: number, out: THREE.Color) => number) {
  const pos = g.getAttribute("position");
  const rgba = new Float32Array(pos.count * 4);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, -pos.getZ(i) / length));
    const a = fn(t, c);
    rgba.set([c.r, c.g, c.b, a], i * 4);
  }
  g.setAttribute("color", new THREE.BufferAttribute(rgba, 4));
  // Only position and colour: the material is unlit.
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
}

/** A tracer's geometry, head at the origin, tail along -Z. */
export function tracerGeometry(look: TracerLook): THREE.BufferGeometry {
  const hw = look.width * HEAD_SCALE;
  const head = new THREE.BoxGeometry(hw, hw, look.head);
  head.translate(0, 0, -look.head / 2);
  paint(head, look.length, (_, c) => (c.copy(HEAD), 1));
  const tailLen = Math.max(0.01, look.length - look.head);
  // Segments along the length, so the fade is a curve rather than one straight ramp.
  const tail = new THREE.BoxGeometry(look.width, look.width, tailLen, 1, 1, 6);
  tail.translate(0, 0, -look.head - tailLen / 2);
  paint(tail, look.length, (t, c) => {
    // t runs head.length/length .. 1 on the streak; s: 0 just behind the head, 1 at the tip.
    const s = Math.min(1, Math.max(0, (t * look.length - look.head) / tailLen));
    c.copy(STREAK).lerp(TAIL, s);
    return look.glow * Math.pow(1 - s, 1.3);
  });
  const g = mergeGeometries([head, tail]);
  head.dispose();
  tail.dispose();
  if (!g) throw new Error("tracerGeometry: merge failed");
  return g;
}

/** The one tracer material: unlit, vertex colours and alpha, no depth write (the streaks overlap without cutting each other). */
export function tracerMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
}
