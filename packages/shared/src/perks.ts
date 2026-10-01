// What a perk changes, as the numbers the step uses. Pure lookups on PERKS
// (constants.ts): `stepPlayer` (combat.ts) and the gun switch (royale.ts)
// read the player's own `PlayerSim.perk` through these, so the server and
// the client's prediction always agree, and the HUD shows the same numbers.
// NO_PERK (or any unknown id) changes nothing.
//
// The dash charges live in `dashCd` alone: it counts the ticks until every
// charge is back. Each dash adds one cooldown to it, and a dash is allowed
// while at least one charge is back (`dashCd` at most charges - 1 cooldowns).
// With one charge that is exactly the plain cooldown (a dash sets it, the
// next waits for 0). With two, a second dash right after the first is
// allowed, and the charges come back one cooldown apart.
//
// `perks.test.ts` tests them (`bun run test`).

import { DASH, DASH_TICKS, NO_PERK, PERKS, ROYALE, TICK_DT, ticks, type PerkDef, type WeaponDef } from "./constants.ts";

/** A PERKS index (not NO_PERK). */
export function isPerk(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < PERKS.length;
}

/** What a loadout pick may carry: a perk, or NO_PERK for none. */
export const isPerkPick = (v: unknown): v is number => v === NO_PERK || isPerk(v);

/** The perk's line, or null for NO_PERK (or an unknown id). */
export function perkDef(id: number): PerkDef | null {
  return PERKS[id] ?? null;
}

/** Dash charges held at most (1 without a perk that adds some). */
export function dashCharges(perk: number): number {
  return perkDef(perk)?.dashCharges ?? 1;
}

/** Ticks one dash charge takes to come back. */
export function dashCooldownTicks(perk: number): number {
  return ticks(DASH.cooldown * (perkDef(perk)?.dashCooldown ?? 1));
}

/** Dash speed, m/s: the dash always lasts DASH_TICKS, a longer one goes faster. */
export function dashSpeed(perk: number): number {
  return (DASH.distance * (perkDef(perk)?.dashDistance ?? 1)) / (DASH_TICKS * TICK_DT);
}

/**
 * Dash charges ready now, for a `dashCd` (see the top of this file): every
 * charge whose cooldown has fully run. 0 to dashCharges(perk).
 */
export function dashChargesReady(dashCd: number, perk: number): number {
  return Math.max(0, dashCharges(perk) - Math.ceil(dashCd / dashCooldownTicks(perk)));
}

/** Ticks until the next dash charge comes back (0: every charge is back). */
export function nextDashCharge(dashCd: number, perk: number): number {
  const cd = dashCooldownTicks(perk);
  return dashCd <= 0 ? 0 : dashCd - (Math.ceil(dashCd / cd) - 1) * cd;
}

/** A gun's magazine with this perk (whole rounds, never fewer than the gun's own). */
export function magazineOf(w: WeaponDef, perk: number): number {
  return Math.max(w.magazine, Math.round(w.magazine * (perkDef(perk)?.magazine ?? 1)));
}

/** Ticks a gun's reload takes with this perk. */
export function reloadTicksOf(w: WeaponDef, perk: number): number {
  return ticks(w.reloadTime * (perkDef(perk)?.handling ?? 1));
}

/** Battle royale: ticks from a gun switch (or swap) until the new gun may fire, with this perk. */
export function switchTicks(perk: number): number {
  return ticks(ROYALE.switchTime * (perkDef(perk)?.handling ?? 1));
}
