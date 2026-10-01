// Battle royale: what we just picked up, read off two snapshots of our own
// player (the server's kit, before and after). A walk-over pickup and an F
// swap both show up there, with no message of their own. The match calls it
// only on two snapshots of the same phase where we are alive in both, so a
// match start, a reset, a knock-out or a reconnect's first snapshot never
// counts. What only goes down (a shot, a throw, a heal used) adds nothing.

import { HEAL_ITEMS, NO_GUN, ROYALE, grenadeDef, gunAt, healsOf, weaponDef, type PlayerView } from "@bagarre/shared";
import type { LootLine } from "./hud.ts";
import { grenadeView } from "./items.ts";

/** A loot feed line before it has a number and a fade. */
export type LootGain = Omit<LootLine, "n" | "opacity">;

function grenadeName(type: number): string {
  return `${grenadeView(type).icon} ${grenadeDef(type).name}`;
}

/** What `next` carries that `prev` didn't: guns into a slot (or swapped in), grenades, healing items, shield charges. */
export function lootGained(prev: PlayerView, next: PlayerView): LootGain[] {
  const out: LootGain[] = [];
  for (let i = 0; i < ROYALE.gunSlots; i++) {
    const was = gunAt(prev.kit, i);
    const now = gunAt(next.kit, i);
    if (now === was || now === NO_GUN) continue;
    out.push({ kind: "gun", key: weaponDef(now).key, to: weaponDef(now).name, from: was === NO_GUN ? "" : weaponDef(was).name });
  }
  const had = prev.kit.grenades;
  const has = next.kit.grenades;
  // Another type, with some still held before: an F swap. Else more of what we hold (or a first stack).
  if (has > 0 && next.grenade !== prev.grenade && had > 0)
    out.push({ kind: "grenade", key: grenadeDef(next.grenade).key, to: grenadeName(next.grenade), from: grenadeName(prev.grenade) });
  else if (has > 0 && (next.grenade !== prev.grenade || has > had)) {
    const n = next.grenade === prev.grenade ? has - had : has;
    out.push({ kind: "grenade", key: grenadeDef(next.grenade).key, to: `${n} ${grenadeName(next.grenade)}`, from: "" });
  }
  HEAL_ITEMS.forEach((h, i) => {
    const n = healsOf(next.kit, i) - healsOf(prev.kit, i);
    if (n > 0) out.push({ kind: "heal", key: h.key, to: `${n} ${h.name}`, from: "" });
  });
  const shields = next.kit.shields - prev.kit.shields;
  if (shields > 0) out.push({ kind: "shield", key: "shield", to: `${shields} Shield charge`, from: "" });
  return out;
}
