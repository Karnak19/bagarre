// What a perk changes, as the numbers the step uses. Pure lookups on PERKS
// (constants.ts): `stepPlayer` (combat.ts) and the gun switch (royale.ts)
// read the player's own `PlayerSim.perk` through these, so the server and
// the client's prediction always agree, and the HUD shows the same numbers.
// NO_PERK (or any unknown id) changes nothing.
//
// The double dash lives in `dashCd` alone, the ticks until a dash is fully
// ready again. Without a window (no perk, the other perks) a dash needs it at
// 0 and sets it to the cooldown: the plain dash. With one (Double dash), the
// first dash sets it to window + cooldown, and while it is still above the
// cooldown the window is open: a second dash is allowed, and sets it to the
// cooldown. Unused, it runs down past the cooldown, which closes the window
// (that second dash is lost), and the cooldown counts down as usual.
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

/** Ticks of dash cooldown (after the second dash, or the unused window, with Double dash). */
export function dashCooldownTicks(perk: number): number {
  return ticks(perkDef(perk)?.dashCooldown ?? DASH.cooldown);
}

/** Ticks from the start of a first dash during which a second one is allowed (0: no second dash). */
export function dashWindowTicks(perk: number): number {
  const w = perkDef(perk)?.dashWindow;
  return w ? ticks(w) : 0;
}

/** The most `dashCd` can be with this perk: the window and the cooldown (the step caps it, for a perk swapped mid-life). */
export function maxDashCd(perk: number): number {
  return dashWindowTicks(perk) + dashCooldownTicks(perk);
}

/** The second dash's window is open (a first dash went, less than the window ago). */
export function dashWindowOpen(dashCd: number, perk: number): boolean {
  return dashWindowTicks(perk) > 0 && dashCd > dashCooldownTicks(perk);
}

/** A dash is allowed by the cooldown now (ready, or the second dash's window is open). */
export function canDash(dashCd: number, perk: number): boolean {
  return dashCd === 0 || dashWindowOpen(dashCd, perk);
}

/** `dashCd` right after a dash: a first one opens the window (with Double dash), anything else starts the cooldown. */
export function dashCdAfter(dashCd: number, perk: number): number {
  return dashCd === 0 ? maxDashCd(perk) : dashCooldownTicks(perk);
}

/** Dash speed, m/s: the dash always lasts DASH_TICKS, a longer one goes faster. */
export function dashSpeed(perk: number): number {
  return (DASH.distance * (perkDef(perk)?.dashDistance ?? 1)) / (DASH_TICKS * TICK_DT);
}

/**
 * Dashes left now, for the HUD: with Double dash 2 when ready, 1 while the
 * window is open, 0 during the cooldown; without, 1 or 0.
 */
export function dashesReady(dashCd: number, perk: number): number {
  if (dashCd === 0) return dashWindowTicks(perk) > 0 ? 2 : 1;
  return dashWindowOpen(dashCd, perk) ? 1 : 0;
}

/**
 * What the HUD's dash timer shows: the window running out (`window`, with
 * Double dash, while it is open), else the cooldown. Ticks left of it, and its full length.
 */
export function dashTimer(dashCd: number, perk: number): { left: number; total: number; window: boolean } {
  const cd = dashCooldownTicks(perk);
  if (dashWindowOpen(dashCd, perk)) return { left: dashCd - cd, total: dashWindowTicks(perk), window: true };
  return { left: dashCd, total: cd, window: false };
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
