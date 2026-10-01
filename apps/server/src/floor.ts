// The battle royale's floor: the chests and the items lying about
// (`state.crates`, `state.items`), all owned by the server. GameRoom calls it
// once per tick while a royale match is played (`step`: items picked up), on
// an F press (`interact`: a chest opened, or a gun or grenade swap), when
// someone is knocked out (`scatter`: their guns, grenades, healing items and
// shield charges where they fell), and at the start and the end of a match
// (`reset`, `clear`). Perks are floor items too: walked over with none held,
// swapped with F otherwise (the old one drops under your feet, like a gun).
//
// A chest is opened by F only (in reach, still closed: `fTarget`), and its
// loot pops out next to it (`lootSpot`). The loot is the server's from the
// start, but nobody can take it until it has landed, ROYALE.lootDrop later
// (`readyTick`, checked here on every pickup and swap): the client only draws
// the arc.
//
// Who gets an item is decided here and nowhere else: items are handled one
// at a time, each one goes to the nearest player who can take it, and a taken
// item is gone before the next player is looked at. So two players stepping
// on the same item in the same tick never both get it. The rules of what
// can be taken (a free gun slot, a stack's maximum, a grenade stack only
// when it swaps nothing) are the shared ones (royale.ts); this file only
// moves things between the floor and the players.
//
// An item a player just dropped (an F swap of a gun, a grenade stack or a perk) lies
// under their feet: they can't pick it back up until they have stepped off
// it, or the next F (or, with a free slot, walking) would take it straight back.
// That player is the item's synced `blockedFor`, so the client's F prompt
// skips it too (fTarget).

import {
  ITEM_CLEARANCE,
  ITEM_GRENADE,
  ITEM_GUN,
  ITEM_HEAL,
  ITEM_PERK,
  ITEM_SHIELD,
  NO_PERK,
  carriedStack,
  carriedStacks,
  setCarriedStack,
  stackMax,
  takeStack,
  PISTOL,
  ROYALE,
  circleOverlapsBox,
  clamp,
  fTarget,
  itemReady,
  lootSpot,
  readSim,
  rollLoot,
  swapGun,
  takeGrenades,
  takeGun,
  ticks,
  carriedGuns,
  gunInHand,
  walkTakesGrenades,
  walkTakesPerk,
  writeSim,
  type ItemDrop,
  type MapDef,
  type Spawn,
} from "@bagarre/shared";
import { Crate, FloorItem, type GameState, type Player } from "./state.ts";

export class Floor {
  private nextId = 0;
  /** A drop every chest gives instead of a random one (null: the loot table). Only the e2e server sets it. */
  force: ItemDrop | null = null;
  /** Seconds a chest's loot takes to land (ROYALE.lootDrop). Only the e2e server changes it, to watch a slow fall. */
  dropTime: number = ROYALE.lootDrop;
  constructor(
    private readonly state: GameState,
    private readonly map: () => MapDef,
    /** Draws in [0, 1): the loot. Math.random on the server; the checks pass their own. */
    private readonly random: () => number = Math.random,
  ) {}

  /** Nothing on the floor: no chest, no item (the end of a match, or back to waiting). */
  clear() {
    this.state.items.clear();
    this.state.crates.clear();
  }

  /** A new match: the floor cleared, and a closed chest on every crate spot of the map. */
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
   * Returns the new item's id.
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
   * has one), their grenades, healing items, shield charges and perk drop
   * round that spot, each on open floor.
   */
  scatter(p: Player, x: number, z: number) {
    const drops: ItemDrop[] = [];
    for (const g of carriedGuns(readSim(p))) if (g.weapon !== PISTOL) drops.push({ kind: ITEM_GUN, item: g.weapon, amount: g.mag });
    if (p.kit.grenades > 0) drops.push({ kind: ITEM_GRENADE, item: p.grenade, amount: p.kit.grenades });
    drops.push(...carriedStacks(p.kit));
    if (p.perk !== NO_PERK) drops.push({ kind: ITEM_PERK, item: p.perk, amount: 1 });
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
   * One tick of a royale match: every item that has landed goes to the
   * nearest player who can take it. `players` are the ones who may: alive
   * and connected.
   */
  step(players: readonly { id: string; p: Player }[]) {
    const tick = this.state.tick;
    // Stepping off what you dropped makes it yours to take again.
    this.state.items.forEach((it) => {
      if (!it.blockedFor) return;
      const q = players.find((e) => e.id === it.blockedFor);
      if (!q || Math.hypot(q.p.x - it.x, q.p.z - it.z) > ROYALE.pickupRadius) it.blockedFor = "";
    });

    // Pickups, one item at a time, nearest player first.
    for (const [id, it] of Array.from(this.state.items.entries())) {
      if (!itemReady(it, tick)) continue;
      const near = players
        .map((e) => ({ ...e, d: Math.hypot(e.p.x - it.x, e.p.z - it.z) }))
        .filter((e) => e.d <= ROYALE.pickupRadius && it.blockedFor !== e.id)
        .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
      for (const e of near) if (this.take(e.id, e.p, id, it)) break;
    }
  }

  /** `p` walks over item `id` (landed): takes what the shared rules allow. Returns whether anything was taken. */
  private take(pid: string, p: Player, id: string, it: FloorItem): boolean {
    if (it.kind === ITEM_GUN) {
      const next = takeGun(readSim(p), it.item, it.amount);
      if (!next) return false;
      writeSim(p, next);
      this.remove(id);
      return true;
    }
    if (it.kind === ITEM_GRENADE) {
      // Only when it swaps nothing (none held, or the same type): another type is F's.
      if (!walkTakesGrenades({ type: p.grenade, count: p.kit.grenades }, it.item)) return false;
      return this.takeGrenadeStack(pid, p, id, it);
    }
    if (it.kind === ITEM_PERK) {
      // One slot: only with none held. Holding one, another is F's (a swap).
      if (!walkTakesPerk(p.perk)) return false;
      p.perk = it.item;
      this.remove(id);
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
   * `p` takes grenade stack `id`, a swap if it is another type: the held
   * stack drops under their feet (theirs to take back once they step off).
   * Returns whether anything was taken.
   */
  private takeGrenadeStack(pid: string, p: Player, id: string, it: FloorItem): boolean {
    const r = takeGrenades({ type: p.grenade, count: p.kit.grenades }, { type: it.item, count: it.amount });
    if (r.taken === 0) return false;
    p.grenade = r.held.type;
    p.kit.grenades = r.held.count;
    if (r.left > 0) it.amount = r.left;
    else this.remove(id);
    if (r.dropped && r.dropped.count > 0) this.drop({ kind: ITEM_GRENADE, item: r.dropped.type, amount: r.dropped.count }, p.x, p.z, pid);
    return true;
  }

  /**
   * F: does what `fTarget` picks for this player (the HUD's prompt names the
   * same one): opens the chest in reach, or swaps the gun in hand, the
   * grenade stack held or the perk for the one on the floor. A swapped gun
   * or perk drops under the player's feet (theirs to take back once they
   * step off). Returns what it did (null: nothing).
   */
  interact(pid: string, p: Player): "chest" | "gun" | "grenade" | "perk" | null {
    const tick = this.state.tick;
    const pick = fTarget(p.kit, { type: p.grenade, count: p.kit.grenades }, p.x, p.z, this.state.items, this.state.crates, pid, tick, p.perk);
    if (!pick) return null;
    if (pick.kind === "chest") return this.open(pick.id, p) ? "chest" : null;
    if (pick.kind === "grenade") return this.takeGrenadeStack(pid, p, pick.id, pick.item) ? "grenade" : null;
    if (pick.kind === "perk") {
      // The perk takes effect on the next step (the sim reads `perk`); the old one lies where it was swapped.
      const old = p.perk;
      p.perk = pick.item.item;
      this.remove(pick.id);
      this.drop({ kind: ITEM_PERK, item: old, amount: 1 }, p.x, p.z, pid);
      return "perk";
    }
    const r = swapGun(readSim(p), pick.item.item, pick.item.amount);
    if (!r) return null;
    writeSim(p, r.sim);
    p.weapon = gunInHand(p.kit);
    this.remove(pick.id);
    this.drop({ kind: ITEM_GUN, item: r.dropped.weapon, amount: r.dropped.mag }, p.x, p.z, pid);
    return "gun";
  }

  /**
   * Opens chest `id` for a player at `p` (fTarget checked the reach and that
   * it is closed): it stays, open, and its loot pops out toward the player,
   * landing on open floor clear of the chests and the other items
   * (`lootSpot`), ROYALE.lootDrop from now (`dropTime`). Returns whether it opened.
   */
  private open(id: string, p: { x: number; z: number }): boolean {
    const c = this.state.crates.get(id);
    if (!c || c.open) return false;
    c.open = true;
    const avoid: { x: number; z: number; r: number }[] = [];
    this.state.crates.forEach((o) => avoid.push({ x: o.x, z: o.z, r: ROYALE.crateRadius + ITEM_CLEARANCE }));
    this.state.items.forEach((it) => avoid.push({ x: it.x, z: it.z, r: ROYALE.lootGap }));
    const at = lootSpot(this.map(), c.x, c.z, Math.atan2(p.z - c.z, p.x - c.x), avoid);
    const it = this.state.items.get(this.drop(this.force ?? rollLoot(this.random()), at.x, at.z));
    if (it) {
      it.fromX = c.x;
      it.fromZ = c.z;
      it.dropTick = this.state.tick;
      it.readyTick = this.state.tick + Math.max(1, ticks(this.dropTime));
    }
    return true;
  }
}
