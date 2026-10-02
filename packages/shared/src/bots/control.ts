// The control layer: every tick, a bot's goal (brain.ts) and view (view.ts)
// become one InputMessage, exactly what a client would send. The server
// queues it like a real client's input, so bots go through the same
// `stepPlayer`, hit tests and royale rules as everyone.
//
// - Moving: A* on the navigation grid (path.ts), replanned at most every
//   BOT_TUNING.replanEvery (sooner when stuck), or the zone's flow field
//   (flow.ts) to escape it. No progress for BOT_TUNING.stuckTime while trying
//   to move: a short random sidestep, then a fresh path.
// - Fighting: a reaction delay before the first shot at a target newly in
//   sight, aim spread, the gun's preferred range, strafing; aim at the pose
//   from HIT_REWIND_TICKS ago (what the hit test judges against).
// - Looting: walk to a chest and press F in reach; walk over items; F when
//   `swapTarget` offers a better gun than the one in hand.
// - Healing: 4/5 (`use` with `heal`) only with nobody in sight. A bot NEVER
//   fires (nor presses F, switches or strikes) while a heal runs or on the
//   tick one starts: each of those would cancel it.
//
// Press counters are running totals (protocol.ts): the state keeps its own,
// +1 per press, never down, and `seq` goes up by one per input.

import { MELEE, NO_HEAL, PLAYER_RADIUS, ROYALE, ticks } from "../constants.ts";
import { weaponDef } from "../combat.ts";
import { lineOfSight, type Vec2 } from "../physics.ts";
import type { InputMessage } from "../protocol.ts";
import type { Goal } from "./brain.ts";
import { flowDirection, flowField } from "./flow.ts";
import { cellAt, cellCentre, nearestFree, type NavGrid } from "./grid.ts";
import { findPath } from "./path.ts";
import { rngNext, rngRange, type BotRng } from "./rng.ts";
import { BOT_TUNING } from "./tuning.ts";
import { gunScore, type BotChest, type BotEnemy, type BotItem, type BotView } from "./view.ts";

/** The press counters a bot sends (InputMessage's), running totals. */
export interface BotPresses {
  dash: number;
  grenade: number;
  shield: number;
  reload: number;
  switch: number;
  swap: number;
  use: number;
  melee: number;
}

export type BotKey = keyof BotPresses;

/** One bot's control memory, carried from tick to tick. */
export interface BotState {
  id: string;
  /** The last input's seq (the next one is seq + 1). */
  seq: number;
  presses: BotPresses;
  /** The earliest tick each key may be pressed again. */
  nextPress: BotPresses;
  /** The path being followed, the waypoint walked to, where it leads and when it was planned. */
  path: Vec2[];
  pathAt: number;
  pathDest: Vec2 | null;
  planTick: number;
  /** Replan at once, past the cap (stuck). */
  forceReplan: boolean;
  /** Stuck check: where the bot last made progress, and when. */
  stuckX: number;
  stuckZ: number;
  stuckTick: number;
  /** A sidestep after being stuck: its direction and the tick it ends on. */
  sideX: number;
  sideZ: number;
  sideUntil: number;
  /** Fighting: the target engaged, since when, when it was last in sight and where. */
  engageId: string;
  engageTick: number;
  seenTick: number;
  lastSeen: Vec2 | null;
  /** Aim error now, until when; strafe direction (+1 / -1), until when. */
  aimOffset: number;
  aimUntil: number;
  strafeSign: number;
  strafeUntil: number;
  /** Roaming: the waypoint, and the tick it is given up on. */
  roam: Vec2 | null;
  roamUntil: number;
  /** The last aim sent (kept when there is nothing to look at). */
  aim: number;
}

const noPresses = (): BotPresses => ({ dash: 0, grenade: 0, shield: 0, reload: 0, switch: 0, swap: 0, use: 0, melee: 0 });

/** A fresh bot: counters at 0 (the server baselines a seat's first input, so they may start anywhere). */
export function createBotState(id: string, aim: number = 0): BotState {
  return {
    id,
    seq: 0,
    presses: noPresses(),
    nextPress: noPresses(),
    path: [],
    pathAt: 0,
    pathDest: null,
    planTick: -Infinity,
    forceReplan: false,
    stuckX: NaN,
    stuckZ: NaN,
    stuckTick: 0,
    sideX: 0,
    sideZ: 0,
    sideUntil: -1,
    engageId: "",
    engageTick: 0,
    seenTick: -Infinity,
    lastSeen: null,
    aimOffset: 0,
    aimUntil: -1,
    strafeSign: 1,
    strafeUntil: -1,
    roam: null,
    roamUntil: -1,
    aim,
  };
}

/** Ticks from tuning seconds. */
const T = {
  replan: ticks(BOT_TUNING.replanEvery),
  stuck: ticks(BOT_TUNING.stuckTime),
  side: ticks(BOT_TUNING.sidestepTime),
  reaction: ticks(BOT_TUNING.reaction),
  forget: ticks(BOT_TUNING.forget),
  aimJitter: ticks(BOT_TUNING.aimJitter),
  press: ticks(BOT_TUNING.pressGap),
  roam: ticks(BOT_TUNING.roamTimeout),
  chase: ticks(5),
};

/** Presses `key` once, if its gap since the last press has run. */
function press(state: BotState, key: BotKey, tick: number): boolean {
  if (tick < state.nextPress[key]) return false;
  state.presses[key]++;
  state.nextPress[key] = tick + T.press;
  return true;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);

function unit(dx: number, dz: number): Vec2 | null {
  const l = Math.hypot(dx, dz);
  return l > 1e-6 ? { x: dx / l, z: dz / l } : null;
}

/**
 * Walks toward `dest` along an A* path: plans one (at most every
 * BOT_TUNING.replanEvery, unless forced), follows its waypoints. Returns the
 * direction to move, or null once there (within `arrive` of `dest`, or at the
 * end of a path that gets no closer).
 */
function followTo(state: BotState, grid: NavGrid, self: Vec2, dest: Vec2, arrive: number, tick: number): Vec2 | null {
  if (dist(self, dest) <= arrive) return null;
  const moved = !state.pathDest || dist(state.pathDest, dest) > BOT_TUNING.replanMoved;
  const need = state.forceReplan || moved || state.path.length === 0;
  if (need && (state.forceReplan || tick - state.planTick >= T.replan)) {
    const p = findPath(grid, self, dest);
    state.path = p ? p.points : [];
    state.pathAt = 0;
    state.pathDest = { x: dest.x, z: dest.z };
    state.planTick = tick;
    state.forceReplan = false;
  }
  if (state.path.length === 0) return unit(dest.x - self.x, dest.z - self.z);
  const reach = BOT_TUNING.waypointReach;
  while (state.pathAt < state.path.length - 1 && dist(self, state.path[state.pathAt]) <= reach) state.pathAt++;
  const wp = state.path[state.pathAt];
  if (state.pathAt === state.path.length - 1 && dist(self, wp) <= reach) return null;
  return unit(wp.x - self.x, wp.z - self.z);
}

/** Out of the zone: down its flow field, or straight at its centre when the field has nothing to say. */
function escapeDir(grid: NavGrid, view: BotView): Vec2 | null {
  const z = view.zone;
  if (!z) return null;
  const self = view.self;
  const dir = flowDirection(grid, flowField(grid, { x: z.tx, z: z.tz, r: z.tr }), self);
  return dir ?? unit(z.x - self.x, z.z - self.z);
}

/** A new roam waypoint: a free spot inside the zone's middle (the map's, with no zone). */
function pickRoam(grid: NavGrid, view: BotView, rng: BotRng): Vec2 | null {
  const a = grid.arena;
  const z = view.zone;
  const cx = z ? z.x : 0;
  const cz = z ? z.z : 0;
  const r = Math.min(z ? z.r * BOT_TUNING.roamSpread : Infinity, Math.min(a.halfX, a.halfZ) * BOT_TUNING.roamSpread);
  for (let k = 0; k < 4; k++) {
    const ang = rngNext(rng) * 2 * Math.PI;
    const d = Math.sqrt(rngNext(rng)) * r;
    const x = Math.max(-a.halfX + 1, Math.min(a.halfX - 1, cx + Math.cos(ang) * d));
    const zz = Math.max(-a.halfZ + 1, Math.min(a.halfZ - 1, cz + Math.sin(ang) * d));
    const c = nearestFree(grid, cellAt(grid, x, zz));
    if (c >= 0) return cellCentre(grid, c);
  }
  return null;
}

function roamDir(state: BotState, grid: NavGrid, view: BotView, rng: BotRng): Vec2 | null {
  const self = view.self;
  const z = view.zone;
  const stale =
    !state.roam ||
    view.tick >= state.roamUntil ||
    dist(self, state.roam) <= BOT_TUNING.roamReach ||
    (z !== null && Math.hypot(state.roam.x - z.x, state.roam.z - z.z) > z.r * 0.9);
  if (stale) {
    state.roam = pickRoam(grid, view, rng);
    state.roamUntil = view.tick + T.roam;
  }
  if (!state.roam) return null;
  const dir = followTo(state, grid, self, state.roam, BOT_TUNING.roamReach, view.tick);
  // There: a new waypoint next tick.
  if (!dir) state.roamUntil = view.tick;
  return dir;
}

/**
 * Aiming and the trigger at an enemy in sight: the reaction delay since it
 * came into sight, the aim error, the gun's range. Returns the aim and
 * whether to fire (before the heal guard).
 */
function engage(state: BotState, view: BotView, e: BotEnemy, rng: BotRng): { aim: number; fire: boolean } {
  const tick = view.tick;
  if (state.engageId !== e.id || tick - state.seenTick > T.forget) {
    state.engageId = e.id;
    state.engageTick = tick;
  }
  state.seenTick = tick;
  state.lastSeen = { x: e.x, z: e.z };
  if (tick >= state.aimUntil) {
    state.aimOffset = rngRange(rng, -BOT_TUNING.aimSpread, BOT_TUNING.aimSpread);
    state.aimUntil = tick + T.aimJitter;
  }
  const self = view.self;
  const aim = Math.atan2(e.aimZ - self.z, e.aimX - self.x) + state.aimOffset;
  const w = weaponDef(self.weapon);
  const fire = view.armed && e.shot && tick - state.engageTick >= T.reaction && self.ammo > 0 && !self.reloading && e.dist <= w.range;
  return { aim, fire };
}

/** Moving in a fight: hold the gun's preferred range, strafe; walk round cover to a target with no clear shot. */
function fightMove(state: BotState, grid: NavGrid, view: BotView, e: BotEnemy, rng: BotRng): Vec2 | null {
  const self = view.self;
  if (!e.shot) return followTo(state, grid, self, e, 1, view.tick);
  const u = unit(e.x - self.x, e.z - self.z);
  if (!u) return null;
  const pref = weaponDef(self.weapon).range * BOT_TUNING.preferredRange;
  const radial = e.dist > pref + BOT_TUNING.rangeBand ? 1 : e.dist < pref - BOT_TUNING.rangeBand ? -1 : 0;
  if (view.tick >= state.strafeUntil) {
    state.strafeSign = rngNext(rng) < 0.5 ? -1 : 1;
    const [lo, hi] = BOT_TUNING.strafeTime;
    state.strafeUntil = view.tick + ticks(rngRange(rng, lo, hi));
  }
  const s = BOT_TUNING.strafe * state.strafeSign;
  return unit(u.x * radial - u.z * s, u.z * radial + u.x * s);
}

/** What a loot goal goes for: its target, or with that gone, the nearest chest or wanted item within BOT_TUNING.lootNear. */
function lootTarget(goal: Extract<Goal, { kind: "loot" }>, view: BotView): { chest: true; at: BotChest } | { chest: false; at: BotItem } | null {
  if (goal.source === "chest") {
    const c = view.chests.find((x) => x.id === goal.target);
    if (c) return { chest: true, at: c };
  } else {
    const it = view.items.find((x) => x.id === goal.target);
    if (it) return { chest: false, at: it };
  }
  const c = view.chests[0];
  const it = view.items[0];
  if (it && it.dist <= BOT_TUNING.lootNear && (!c || it.dist <= c.dist)) return { chest: false, at: it };
  if (c && c.dist <= BOT_TUNING.lootNear) return { chest: true, at: c };
  return null;
}

/** The control step: this tick's input for `goal`. Pure apart from `state` and `rng`, which it advances. */
export function botInput(state: BotState, goal: Goal, view: BotView, grid: NavGrid, rng: BotRng): InputMessage {
  state.seq++;
  const tick = view.tick;
  const self = view.self;
  let move: Vec2 | null = null;
  let aim = state.aim;
  let fire = false;
  let gx = self.x;
  let gz = self.z;
  let healItem = NO_HEAL;
  let startedHeal = false;
  /** The heal guard: a heal runs or starts on this input (nothing may cancel it). */
  const busy = () => self.healing || startedHeal;
  /** Wants to press F, switch or strike: only if `busy` is false at the end. */
  let wantSwap = false;
  let wantSwitch = -1;
  let wantMelee = false;
  let wantShield = false;
  let wantReload = false;

  if (!self.alive) return emit(state, { mx: 0, mz: 0, aim, fire: false, gx, gz, slot: 0, heal: NO_HEAL });

  const fightTarget = goal.kind === "fight" ? view.enemies.find((e) => e.id === goal.target) : undefined;
  // Any enemy with a clear shot is fired at on the way (escape, loot, roam): the goal's target in a fight.
  const shootAt = fightTarget ?? view.enemies.find((e) => e.shot);

  switch (goal.kind) {
    case "escape_zone":
      move = escapeDir(grid, view);
      break;
    case "heal":
      if (!self.healing && view.armed && self.heal !== NO_HEAL && view.enemies.length === 0) {
        healItem = self.heal;
        startedHeal = press(state, "use", tick);
      }
      // Healing slows the walk: stand still unless the zone needs leaving.
      if (view.zone?.outside) move = escapeDir(grid, view);
      break;
    case "fight": {
      if (fightTarget) move = fightMove(state, grid, view, fightTarget, rng);
      else if (state.lastSeen && state.engageId === goal.target && tick - state.seenTick < T.chase) {
        move = followTo(state, grid, self, state.lastSeen, 1, tick);
        if (!move) state.lastSeen = null;
      } else move = roamDir(state, grid, view, rng);
      break;
    }
    case "loot": {
      // The target gone (the chest opened, the item taken): the nearest other thing to loot close by, until the next decision.
      const t = lootTarget(goal, view);
      if (!t) move = roamDir(state, grid, view, rng);
      else if (t.chest) {
        const reach = ROYALE.openRadius - BOT_TUNING.openInset;
        if (t.at.dist <= reach) wantSwap = true;
        else move = followTo(state, grid, self, t.at, reach, tick);
      } else if (t.at.walk) move = followTo(state, grid, self, t.at, ROYALE.pickupRadius * 0.4, tick);
      else {
        move = followTo(state, grid, self, t.at, ROYALE.pickupRadius * 0.6, tick);
        if (view.swap?.id === t.at.id) wantSwap = true;
      }
      break;
    }
    case "roam":
      move = roamDir(state, grid, view, rng);
      break;
  }

  if (shootAt) {
    const r = engage(state, view, shootAt, rng);
    aim = r.aim;
    fire = r.fire;
    gx = shootAt.aimX;
    gz = shootAt.aimZ;
    const sim = self.sim;
    if (view.armed && shootAt.dist <= MELEE.range + PLAYER_RADIUS - 0.2 && sim.meleeCd === 0 && lineOfSight(grid.arena, self, shootAt)) wantMelee = true;
    if (view.armed && self.hp < BOT_TUNING.shieldBelow && self.shields > 0 && sim.shieldCd === 0 && !self.shielded) wantShield = true;
  } else if (move) aim = Math.atan2(move.z, move.x);

  // Kit upkeep, out of a fight: a better gun on the floor (F), the best gun in hand, a full magazine.
  if (view.armed && view.swap && view.enemies.length === 0) wantSwap = true;
  const best = self.guns.reduce<{ slot: number; weapon: number } | null>((b, g) => (!b || gunScore(g.weapon) > gunScore(b.weapon) ? g : b), null);
  if (best && best.slot !== self.sim.kit.hand && !fire) wantSwitch = best.slot;
  if (!self.reloading && self.ammo < self.magazine && (self.ammo === 0 || view.enemies.length === 0)) wantReload = true;

  // The stuck check: trying to move but not getting anywhere.
  if (move) {
    if (!(dist(self, { x: state.stuckX, z: state.stuckZ }) <= BOT_TUNING.stuckDist)) {
      state.stuckX = self.x;
      state.stuckZ = self.z;
      state.stuckTick = tick;
    } else if (tick - state.stuckTick >= T.stuck) {
      const a = rngNext(rng) * 2 * Math.PI;
      state.sideX = Math.cos(a);
      state.sideZ = Math.sin(a);
      state.sideUntil = tick + T.side;
      state.forceReplan = true;
      state.stuckTick = tick;
    }
  } else {
    state.stuckX = self.x;
    state.stuckZ = self.z;
    state.stuckTick = tick;
  }
  if (move && tick < state.sideUntil) move = { x: state.sideX, z: state.sideZ };

  // The heal guard, last: nothing that cancels a heal goes out with one running or starting.
  if (busy()) fire = false;
  else {
    if (wantSwap && view.armed) press(state, "swap", tick);
    if (wantSwitch >= 0) press(state, "switch", tick);
    if (wantMelee) press(state, "melee", tick);
  }
  if (wantShield) press(state, "shield", tick);
  if (wantReload) press(state, "reload", tick);

  state.aim = aim;
  return emit(state, { mx: move?.x ?? 0, mz: move?.z ?? 0, aim, fire, gx, gz, slot: wantSwitch >= 0 ? wantSwitch : self.sim.kit.hand, heal: healItem });
}

/** The input itself: this tick's choices plus the running counters. */
function emit(state: BotState, c: { mx: number; mz: number; aim: number; fire: boolean; gx: number; gz: number; slot: number; heal: number }): InputMessage {
  const p = state.presses;
  return {
    seq: state.seq,
    mx: c.mx,
    mz: c.mz,
    aim: c.aim,
    fire: c.fire,
    gx: c.gx,
    gz: c.gz,
    dash: p.dash,
    grenade: p.grenade,
    shield: p.shield,
    reload: p.reload,
    slot: c.slot,
    switch: p.switch,
    swap: p.swap,
    heal: c.heal,
    use: p.use,
    melee: p.melee,
  };
}
