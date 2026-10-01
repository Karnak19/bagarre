// Bullet tracers point where the bullet flies from the very first frame they
// are drawn, and stay level. Before, a new tracer kept its default rotation
// (along +Z, 90 degrees off an aim along +X) on its first frame, then pointed
// down and inward for a few more while it slid from the muzzle onto its path.
//
// The scene logs each tracer's first few frames in dev builds
// (`__bagarre.scene.tracerLog`: where the mesh is and the way its head
// points). The expected heading is the bullet's own velocity, computed here
// with the shared `shotPellets` from the bullet id (`slot:seq:pellet`): the
// rifle's round within its spread of the aim, each shotgun pellet along its
// own spread. Checked on the shooter's page (its predicted bullets) and on the
// opponent's (the server's bullets, interpolated).

import { WEAPONS, shotPellets } from "@bagarre/shared";
import { expect, place, test, type Player } from "./fixtures.ts";

// oxlint-disable typescript/no-explicit-any

interface Frame {
  id: string;
  frame: number;
  weapon: number;
  fx: number;
  fy: number;
  fz: number;
}

/** Angle between two directions on the ground, degrees. */
const degBetween = (ax: number, az: number, bx: number, bz: number) =>
  (Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz))))) * 180) / Math.PI;

/** The tracer frames a page has logged for one shooter's bullets (by slot). */
function frames(p: Player, slot: number): Promise<Frame[]> {
  return p.page.evaluate(
    (slot) => ((window as any).__bagarre.scene.tracerLog as Frame[]).filter((f) => f.id.startsWith(`${slot}:`)),
    slot,
  );
}

/** Yard's z = -12 row is clear from wall to wall: A fires along it (+X), B stands off to the side. */
const SHOOTER = { x: -6, z: -12 };
const BYSTANDER = { x: -6, z: -8.5 };
const AIM = 0;
/** Allowed off the bullet's own velocity, and off level, degrees. */
const TOLERANCE = 2;

for (const key of ["rifle", "shotgun"] as const) {
  test(`a ${key} tracer faces its bullet's velocity and is level from its first frame`, async ({ players }) => {
    const weapon = WEAPONS.findIndex((w) => w.key === key);
    const def = WEAPONS[weapon];
    const { host: a, invite, code } = await players.host("duel", "A");
    await a.page.keyboard.press(`Digit${weapon + 1}`);
    await expect.poll(async () => a.me(await a.state())?.pick).toBe(weapon);
    const b = await players.join(invite, "B");
    await Promise.all([a.expectState("phase", "playing"), b.expectState("phase", "playing")]);
    await Promise.all([a.expectState("card", "none"), b.expectState("card", "none")]);
    const sa = await a.state();
    const me = a.me(sa)!;
    expect(me.weapon).toBe(weapon);
    const idb = (await b.state()).you;
    await place(code, me.id, SHOOTER.x, SHOOTER.z);
    await place(code, idb, BYSTANDER.x, BYSTANDER.z);
    await expect.poll(async () => Math.hypot(a.me(await a.state())!.x - SHOOTER.x, a.me(await a.state())!.z - SHOOTER.z)).toBeLessThan(0.1);

    for (const p of [a, b]) await p.page.evaluate(() => void ((window as any).__bagarre.scene.tracerLog.length = 0));
    await a.bot({ on: true, mx: 0, mz: 0, aim: AIM, fire: true });
    // Both pages saw a shot's first four frames (the opponent's a little later: interpolation).
    for (const p of [a, b])
      await expect
        .poll(async () => (await frames(p, me.slot)).filter((f) => f.frame === 3).length, { message: `${p.name} logged a tracer's first frames` })
        .toBeGreaterThanOrEqual(def.pellets);
    await a.bot({ fire: false });

    for (const p of [a, b]) {
      const log = await frames(p, me.slot);
      const first = log.filter((f) => f.frame === 0);
      expect(first.length, `${p.name}: first frames`).toBeGreaterThanOrEqual(def.pellets);
      for (const f of log) {
        const [, seq, pellet] = f.id.split(":").map(Number);
        const v = shotPellets(weapon, 0, 0, AIM, seq)[pellet];
        const what = `${p.name}: ${f.id} frame ${f.frame}`;
        expect(f.weapon, what).toBe(weapon);
        // Along its own velocity...
        expect(degBetween(f.fx, f.fz, v.vx, v.vz), `${what}: off its velocity`).toBeLessThan(TOLERANCE);
        // ...which for the rifle is the aim, within its spread.
        if (def.pellets === 1) expect(degBetween(f.fx, f.fz, Math.cos(AIM), Math.sin(AIM)), `${what}: off the aim`).toBeLessThan((def.spread * 90) / Math.PI + TOLERANCE);
        // Level.
        expect((Math.asin(Math.min(1, Math.abs(f.fy))) * 180) / Math.PI, `${what}: tilted`).toBeLessThan(TOLERANCE);
      }
    }
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
}
