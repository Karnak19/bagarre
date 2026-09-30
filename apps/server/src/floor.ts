// The battle royale's floor: the crates still standing and the items lying
// about (`state.crates`, `state.items`), all owned by the server. GameRoom
// calls it once per tick while a royale match is played (`step`: crates
// broken open, items picked up), on an F press (`swap`), when someone is
// knocked out (`scatter`: their guns, grenades, healing items and shield
// charges where they fell), and at
// the start and the end of a match (`reset`, `clear`).
//
// Who gets an item is decided here and nowhere else: items are handled one
// at a time, each one goes to the nearest player who can take it, and a taken
// item is gone before the next player is looked at. So two players stepping
// on the same item in the same tick never both get it. The rules of what
// can be taken (a free gun slot, a stack's maximum) are the shared
// ones (royale.ts); this file only moves things between the floor and the
// players.
//
// An item a player just dropped (a grenade swap, an F swap) lies under their
// feet: they can't pick it back up until they have stepped off it, or a
// walk-over swap would bounce the two stacks back and forth every tick.
// That player is the item's synced `blockedFor`, so the client's swap prompt
// skips it too (swapTarget).

import {
  ITEM_GRENADE,
  ITEM_GUN,
  ITEM_HEAL,
  ITEM_SHIELD,
  carriedStack,
  carriedStacks,
  setCarriedStack,
  stackMax,
  takeStack,
  PISTOL,
  PLAYER_RADIUS,
  ROYALE,
  circleOverlapsBox,
  clamp,
  readSim,
  rollLoot,
  swapGun,
  swapTarget,
  takeGrenades,
  takeGun,
  carriedGuns,
  gunInHand,
  writeSim,
  type ItemDrop,
  type MapDef,
  type Spawn,
} from "@bagarre/shared";
import { Crate, FloorItem, type GameState, type Player } from "./state.ts";

/** Radius an item needs clear of cover when it is dropped (so it never lands inside a box). */
const ITEM_CLEARANCE = 0.3;

export class Floor {
  private nextId = 0;
  /** A drop every crate gives instead of a random one (null: the loot table). Only the e2e server sets it. */
  force: ItemDrop | null = null;
  constructor(
    private readonly state: GameState,
    private readonly map: () => MapDef,
    /** Draws in [0, 1): the loot. Math.random on the server; the checks pass their own. */
    private readonly random: () => number = Math.random,
  ) {}

  /** Nothing on the floor: no crate, no item (the end of a match, or back to waiting). */
  clear() {
    this.state.items.clear();
    this.state.crates.clear();
  }

  /** A new match: the floor cleared, and a crate on every crate spot of the map. */
  reset(spots: readonly Spawn[]) {
    this.clear();
    for (const s of spots) {
      const c = new Crate();
      c.x = s.x;
      c.z = s.z;
      this.state.crates.set(String(this.nextId++), c);
    }
  }

  /**
   * Puts an item on the floor at (x, z). Past ROYALE.maxItems the oldest one
   * goes first, so the floor never grows without bound. `droppedBy`: the
   * player it lands under, who has to step off it before taking it back.
   */
  drop(item: ItemDrop, x: number, z: number, droppedBy?: string): string {
    while (this.state.items.size >= ROYALE.maxItems) {
      const oldest = this.state.items.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
    const it = new FloorItem();
    const map = this.map();
    it.x = clamp(x, -map.halfX + 0.5, map.halfX - 0.5);
    it.z = clamp(z, -map.halfZ + 0.5, map.halfZ - 0.5);
    it.kind = item.kind;
    it.item = item.item;
    it.amount = item.amount;
    it.blockedFor = droppedBy ?? "";
    const id = String(this.nextId++);
    this.state.items.set(id, it);
    return id;
  }

  private remove(id: string) {
    this.state.items.delete(id);
  }

  /**
   * A player is knocked out at (x, z): their guns (not the Pistol: everyone
   * has one), their grenades, healing items and shield charges drop round
   * that spot, each on open floor.
   */
  scatter(p: Player, x: number, z: number) {
    const drops: ItemDrop[] = [];
    for (const g of carriedGuns(readSim(p))) if (g.weapon !== PISTOL) drops.push({ kind: ITEM_GUN, item: g.weapon, amount: g.mag });
    if (p.kit.grenades > 0) drops.push({ kind: ITEM_GRENADE, item: p.grenade, amount: p.kit.grenades });
    drops.push(...carriedStacks(p.kit));
    drops.forEach((d, i) => {
      const at = this.spotNear(x, z, (i / Math.max(1, drops.length)) * 2 * Math.PI);
      this.drop(d, at.x, at.z);
    });
  }

  /** A spot ROYALE.dropSpread from (x, z) at about `angle`, clear of cover; (x, z) itself if none is. */
  private spotNear(x: number, z: number, angle: number): Spawn {
    const map = this.map();
    for (let k = 0; k < 8; k++) {
      const a = angle + (k * Math.PI) / 4;
      const p = { x: x + Math.cos(a) * ROYALE.dropSpread, z: z + Math.sin(a) * ROYALE.dropSpread };
      const inside = Math.abs(p.x) < map.halfX - 0.5 && Math.abs(p.z) < map.halfZ - 0.5;
      if (inside && !map.obstacles.some((b) => circleOverlapsBox(p.x, p.z, ITEM_CLEARANCE, b))) return p;
    }
    return { x, z };
  }

  /**
   * One tick of a royale match: crates touched by a living player break open
   * (one random item each, where the crate stood), then every item goes to
   * the nearest player who can take it. `players` are the ones who may:
   * alive and connected.
   */
  step(players: readonly { id: string; p: Player }[]) {
    // Crates.
    const reach = ROYALE.crateRadius + PLAYER_RADIUS;
    // A copy: breaking a crate deletes it from the map being walked.
    for (const [id, c] of Array.from(this.state.crates.entries())) {
      if (!players.some(({ p }) => Math.hypot(p.x - c.x, p.z - c.z) <= reach)) continue;
      this.state.crates.delete(id);
      this.drop(this.force ?? rollLoot(this.random()), c.x, c.z);
    }

    // Stepping off what you dropped makes it yours to take again.
    this.state.items.forEach((it) => {
      if (!it.blockedFor) return;
      const q = players.find((e) => e.id === it.blockedFor);
      if (!q || Math.hypot(q.p.x - it.x, q.p.z - it.z) > ROYALE.pickupRadius) it.blockedFor = "";
    });

    // Pickups, one item at a time, nearest player first.
    for (const [id, it] of Array.from(this.state.items.entries())) {
      const near = players
        .map((e) => ({ ...e, d: Math.hypot(e.p.x - it.x, e.p.z - it.z) }))
        .filter((e) => e.d <= ROYALE.pickupRadius && it.blockedFor !== e.id)
        .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
      for (const e of near) if (this.take(e.id, e.p, id, it)) break;
    }
  }

  /** `p` walks over item `id`: takes what the shared rules allow. Returns whether anything was taken. */
  private take(pid: string, p: Player, id: string, it: FloorItem): boolean {
    if (it.kind === ITEM_GUN) {
      const next = takeGun(readSim(p), it.item, it.amount);
      if (!next) return false;
      writeSim(p, next);
      this.remove(id);
      return true;
    }
    if (it.kind === ITEM_GRENADE) {
      const r = takeGrenades({ type: p.grenade, count: p.kit.grenades }, { type: it.item, count: it.amount });
      if (r.taken === 0) return false;
      p.grenade = r.held.type;
      p.kit.grenades = r.held.count;
      if (r.left > 0) it.amount = r.left;
      else this.remove(id);
      if (r.dropped && r.dropped.count > 0) this.drop({ kind: ITEM_GRENADE, item: r.dropped.type, amount: r.dropped.count }, p.x, p.z, pid);
      return true;
    }
    if (it.kind === ITEM_HEAL || it.kind === ITEM_SHIELD) {
      // Healing items and shield charges: each its own stack, up to its maximum.
      const r = takeStack(carriedStack(p.kit, it.kind, it.item), stackMax(it.kind, it.item), it.amount);
      if (r.taken === 0) return false;
      setCarriedStack(p.kit, it.kind, it.item, r.have);
      if (r.left > 0) it.amount = r.left;
      else this.remove(id);
      return true;
    }
    return false;
  }

  /**
   * F: swap the gun in hand for the floor gun `swapTarget` picks (the
   * nearest in reach not blocked for them, if it isn't carried already; the
   * HUD's prompt names the same one). The old gun drops under the player's
   * feet (theirs to take back once they step off). Returns whether it
   * swapped. With a free slot the walk-over pickup has already taken any
   * gun in reach, so F only matters with all three slots full.
   */
  swap(pid: string, p: Player): boolean {
    const pick = swapTarget(p.kit, p.x, p.z, this.state.items, pid);
    if (!pick) return false;
    const r = swapGun(readSim(p), pick.item.item, pick.item.amount);
    if (!r) return false;
    writeSim(p, r.sim);
    p.weapon = gunInHand(p.kit);
    this.remove(pick.id);
    this.drop({ kind: ITEM_GUN, item: r.dropped.weapon, amount: r.dropped.mag }, p.x, p.z, pid);
    return true;
  }
}
