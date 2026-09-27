// A player's colour, as an index into the palette (scene.ts' PLAYER_COLORS,
// the theme's `--bagarre-p0`..`--bagarre-p7`, styles.ts' slotDot / slotText).
// Indices 0-5 are the seat colours of a duel and an FFA; 6 and 7 are the team
// colours, red and blue, which replace the seat colour of every player in a
// team deathmatch (character, name bars, scoreboard, minimap, bullets).
// Everything that colours a player goes through `paintOf`, never the raw slot.

import { TEAM_BLUE, TEAM_RED } from "@bagarre/shared";

/** Palette index of each team's colour (TEAM_RED, TEAM_BLUE). */
export const TEAM_PAINT = [6, 7] as const;

/** The palette index a player is drawn in: their team's colour with teams, else their seat's. */
export function paintOf(p: { slot: number; team: number }): number {
  return p.team === TEAM_RED || p.team === TEAM_BLUE ? TEAM_PAINT[p.team] : p.slot;
}

/** The palette index of a team, or of a seat when `team` is not a team (a kill feed line's two sides). */
export function paintFor(slot: number, team: number): number {
  return paintOf({ slot, team });
}
