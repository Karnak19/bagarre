// The melee strike (V): a hit on whoever is right in front, judged by the
// server against the rewound poses. Players are put where each check needs
// them with the e2e server's /place, the dev bot holds the aim, and V is
// pressed on the keyboard, through the game's own input. A strike is read off
// the server's state: its V counter consumed (`meleeSeen`), its cooldown
// started (`meleeCd`), and the target's HP.

import { MAX_HP, MELEE, TICK_RATE } from "@bagarre/shared";
import { FFA_MAP, expect, place, setWarmup, test, type Player } from "./fixtures.ts";

const RED = 0;
const BLUE = 1;

/**
 * Yard's crate stack (centre (-2.75, -3.25), 3 x 3): its north-east corner
 * is at (-1.25, -4.75). One player north of the crate and one east of it,
 * 2 m apart (in reach), with the corner of the crate between them.
 */
const CORNER = { a: { x: -2.25, z: -5.35 }, b: { x: -0.65, z: -4.15 } };

/** The server's view of player `id`, as `p` sees it. */
async function server(p: Player, id: string) {
  return (await p.state()).players.find((q) => q.id === id)!;
}

/**
 * Puts the players where `spots` says (session id -> spot) and waits until
 * `p` sees them there for a while: the server judges a strike against poses
 * a few ticks old, which must already be the new ones.
 */
async function stand(p: Player, code: string, spots: Record<string, { x: number; z: number }>) {
  for (const [id, at] of Object.entries(spots)) await place(code, id, at.x, at.z);
  await expect
    .poll(async () => {
      const s = await p.state();
      return Object.entries(spots).every(([id, at]) => {
        const q = s.players.find((x) => x.id === id);
        return !!q && Math.hypot(q.x - at.x, q.z - at.z) < 0.01;
      });
    })
    .toBe(true);
  const tick = (await p.state()).tick;
  await expect.poll(async () => (await p.state()).tick).toBeGreaterThan(tick + 6);
}

/**
 * `p` aims at `aim` (the bot holds it, standing still), then presses V once
 * the server has that aim. Resolves once the server consumed the press.
 */
async function strike(p: Player, aim: number) {
  await p.bot({ on: true, mx: 0, mz: 0, fire: false, aim });
  await expect.poll(async () => Math.abs(p.me(await p.state())!.aim - aim)).toBeLessThan(0.01);
  const seen = p.me(await p.state())!.meleeSeen;
  await p.focusGame();
  await p.page.keyboard.press("KeyV");
  await expect.poll(async () => p.me(await p.state())!.meleeSeen, { message: `${p.name}: the server took the V press` }).toBe(seen + 1);
}

/** Waits until `p`'s melee is off cooldown again, as the server has it. */
async function cooledDown(p: Player) {
  await expect.poll(async () => p.me(await p.state())!.meleeCd, { timeout: 5_000 }).toBe(0);
}

test("a strike hits the enemy right in front (half their health, no shot counted), and misses from behind and beside", async ({ players }) => {
  const { a, b, code } = await players.duel();
  const [ida, idb] = [(await a.state()).you, (await b.state()).you];

  // B 1.5 m in front of A, A aiming at B: a hit, and the HUD's cooldown runs.
  await stand(a, code, { [ida]: { x: 0, z: -12 }, [idb]: { x: 1.5, z: -12 } });
  const sounds = await a.sfxCount();
  await expect(a.testId("hud-melee")).toHaveAttribute("data-ready");
  // Watched from before the press: the cooldown is short, a slow page shows it a few frames.
  const sweep = expect(a.testId("hud-melee")).not.toHaveAttribute("data-ready");
  await strike(a, 0);
  await sweep;
  await expect.poll(async () => (await server(a, idb)).hp).toBe(MAX_HP - MELEE.damage);
  // Heard as a hit (the HP drop), not as a whiff.
  await expect.poll(() => a.sfxSince(sounds)).toContain("hit");
  expect(await a.sfxSince(sounds)).not.toContain("melee_swing");
  // A strike is not a shot: accuracy stays untouched, the damage counts.
  const me = a.me(await a.state())!;
  expect([me.shots, me.hits, me.damage]).toEqual([0, 0, MELEE.damage]);
  await expect(a.testId("hud-melee")).toHaveAttribute("data-ready");

  // B behind A: a swing at the air, the whoosh, and nothing on B.
  await stand(a, code, { [ida]: { x: 0, z: -12 }, [idb]: { x: -1.5, z: -12 } });
  const before = await a.sfxCount();
  await strike(a, 0);
  await expect.poll(() => a.sfxSince(before)).toContain("melee_swing");
  await cooledDown(a);
  expect((await server(a, idb)).hp).toBe(MAX_HP - MELEE.damage);

  // B beside A, outside the 90° cone: nothing either.
  await stand(a, code, { [ida]: { x: 0, z: -12 }, [idb]: { x: 0, z: -10.6 } });
  await strike(a, 0);
  await cooledDown(a);
  expect((await server(a, idb)).hp).toBe(MAX_HP - MELEE.damage);
  expect(a.me(await a.state())!.damage).toBe(MELEE.damage);
});

test("a strike never goes through cover, even well within reach", async ({ players }) => {
  const { a, b, code } = await players.duel();
  const [ida, idb] = [(await a.state()).you, (await b.state()).you];
  await stand(a, code, { [ida]: CORNER.a, [idb]: CORNER.b });
  const aim = Math.atan2(CORNER.b.z - CORNER.a.z, CORNER.b.x - CORNER.a.x);
  // In reach and dead ahead: only the crate's corner is in the way.
  expect(Math.hypot(CORNER.b.x - CORNER.a.x, CORNER.b.z - CORNER.a.z)).toBeLessThan(MELEE.range + 0.5);
  await strike(a, aim);
  await cooledDown(a);
  expect((await server(a, idb)).hp).toBe(MAX_HP);

  // The same two spots on open ground: the strike lands.
  const open = { x: 0, z: -12 };
  await stand(a, code, { [ida]: open, [idb]: { x: open.x + CORNER.b.x - CORNER.a.x, z: open.z + CORNER.b.z - CORNER.a.z } });
  await strike(a, aim);
  await expect.poll(async () => (await server(a, idb)).hp).toBe(MAX_HP - MELEE.damage);
});

test("nothing in warmup: the press is used up, and doesn't strike when the match starts", async ({ players }) => {
  const { host: a, invite, code } = await players.host("duel", "A");
  // Held open for the checks, ended when they are done.
  await setWarmup(code, 120);
  const b = await players.join(invite, "B");
  await Promise.all([a, b].map((p) => p.expectState("phase", "warmup")));
  await Promise.all([a, b].map((p) => p.expectState("card", "none")));
  const [ida, idb] = [(await a.state()).you, (await b.state()).you];
  await stand(a, code, { [ida]: { x: 0, z: -12 }, [idb]: { x: 1.5, z: -12 } });
  await strike(a, 0);
  // No cooldown started, no damage, a whole second later.
  const tick = (await a.state()).tick;
  await expect.poll(async () => (await a.state()).tick).toBeGreaterThan(tick + TICK_RATE);
  expect(a.me(await a.state())!.meleeCd).toBe(0);
  expect((await server(a, idb)).hp).toBe(MAX_HP);
  expect((await a.state()).phase).toBe("warmup");

  await setWarmup(code, 0);
  await Promise.all([a, b].map((p) => p.expectState("phase", "playing")));
  const started = (await a.state()).tick;
  await expect.poll(async () => (await a.state()).tick).toBeGreaterThan(started + TICK_RATE / 2);
  expect(a.me(await a.state())!.meleeCd).toBe(0);
  expect((await server(a, idb)).hp).toBe(MAX_HP);
  // A new press once it plays does strike.
  await stand(a, code, { [ida]: { x: 0, z: -12 }, [idb]: { x: 1.5, z: -12 } });
  await strike(a, 0);
  await expect.poll(async () => (await server(a, idb)).hp).toBe(MAX_HP - MELEE.damage);
});

test("team deathmatch: a teammate in the cone takes nothing, the enemy beside them is hit, and a melee kill reads Melee", async ({ players }) => {
  // Four players: each step waits on every page.
  test.slow();
  const { players: all, code } = await players.teams(4);
  await Promise.all(all.map((p) => p.expectState("phase", "playing")));
  await Promise.all(all.map((p) => p.expectState("card", "none")));
  const s = await all[0].state();
  const red = s.players.filter((p) => p.team === RED);
  const blue = s.players.filter((p) => p.team === BLUE);
  const pages = await Promise.all(all.map(async (p) => ({ p, you: (await p.state()).you })));
  const a = pages.find((x) => x.you === red[0].id)!.p;
  const [mate, enemy] = [red[1].id, blue[0].id];

  // Crossroads' square, by the open south-west corner: both 1.5 m ahead, either side of the aim.
  await stand(a, code, { [red[0].id]: { x: -5, z: 2.8 }, [mate]: { x: -3.6, z: 2.3 }, [enemy]: { x: -3.6, z: 3.3 } });
  await strike(a, 0);
  await expect.poll(async () => (await server(a, enemy)).hp).toBe(MAX_HP - MELEE.damage);
  expect((await server(a, mate)).hp).toBe(MAX_HP);

  // The second strike kills: the kill feed says Melee.
  await cooledDown(a);
  await strike(a, 0);
  await expect.poll(async () => (await server(a, enemy)).alive).toBe(false);
  expect((await server(a, mate)).hp).toBe(MAX_HP);
  await expect(a.testId("hud-killfeed-row")).toHaveCount(1);
  await expect(a.testId("hud-killfeed-row")).toContainText("Melee");
  expect((await a.state()).redScore).toBe(1);
  expect((await a.state()).mapId).toBe(FFA_MAP);
});
