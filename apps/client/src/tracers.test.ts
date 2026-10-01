// Run with `bun run test` (or `bun test src/tracers.test.ts` in apps/client).

import { describe, expect, test } from "bun:test";
import { BULLET_RADIUS, WEAPONS } from "@bagarre/shared";
import { GUN_VIEW } from "./items.ts";
import { tracerGeometry } from "./tracers.ts";

/** The old shared tracer's thickness, before each gun had its own. */
const OLD_WIDTH = BULLET_RADIUS * 0.8;

describe("tracers", () => {
  test("every gun has its own tracer look, at most about half the old thickness", () => {
    for (const w of WEAPONS) {
      const t = GUN_VIEW[w.key]?.tracer;
      expect(t, w.key).toBeDefined();
      expect(t.width, w.key).toBeGreaterThan(0);
      expect(t.width, w.key).toBeLessThanOrEqual(OLD_WIDTH * 0.55);
      expect(t.head, w.key).toBeGreaterThan(0);
      expect(t.length, w.key).toBeGreaterThan(t.head);
      expect(t.glow, w.key).toBeGreaterThan(0);
      expect(t.glow, w.key).toBeLessThanOrEqual(1);
    }
  });

  test("the looks tell the guns apart", () => {
    const keys = WEAPONS.map((w) => JSON.stringify(GUN_VIEW[w.key].tracer));
    expect(new Set(keys).size).toBe(WEAPONS.length);
    const len = (k: keyof typeof GUN_VIEW) => GUN_VIEW[k].tracer.length;
    // A long streak for the long guns, short dashes for the shotgun's pellets.
    expect(len("sniper")).toBeGreaterThan(len("rifle"));
    expect(len("dmr")).toBeGreaterThan(len("rifle"));
    for (const w of WEAPONS) if (w.key !== "shotgun") expect(len("shotgun")).toBeLessThan(len(w.key));
  });

  test("a tracer's geometry: head at the origin, opaque; tail back along -Z, fading out", () => {
    for (const w of WEAPONS) {
      const look = GUN_VIEW[w.key].tracer;
      const g = tracerGeometry(look);
      const pos = g.getAttribute("position");
      const col = g.getAttribute("color");
      expect(col.itemSize).toBe(4);
      let maxZ = -Infinity;
      let minZ = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        maxZ = Math.max(maxZ, z);
        minZ = Math.min(minZ, z);
        if (z > -1e-6) expect(col.getW(i)).toBe(1);
        if (z < -look.length + 1e-6) expect(col.getW(i)).toBeCloseTo(0);
      }
      expect(maxZ).toBeCloseTo(0);
      expect(minZ).toBeCloseTo(-look.length);
      g.dispose();
    }
  });
});
