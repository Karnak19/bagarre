// Checks for every message a client sends. The server runs each payload
// through one of these before touching the room: a payload of the wrong
// shape, with a wrong type, a non-finite number or a value out of range is
// refused whole (the parser returns null) and the handler drops it. Nothing
// is coerced or partly applied, so a bad message never changes the state.
//
// Hand-written rather than Colyseus' `validate()`: that helper closes the
// sender's connection (4002) on the first bad payload, and we'd rather drop
// the message and keep the player in the match.

import { isPickableWeapon } from "./combat.ts";
import { TEAM_BLUE, TEAM_RED } from "./constants.ts";
import { isGrenadeType } from "./grenades.ts";
import type { InputMessage, PickMessage, PingMessage, TeamMessage } from "./protocol.ts";
import { isHealItem } from "./royale.ts";

/** Largest press counter or input seq (they are synced as uint32). */
export const MAX_COUNTER = 0xffffffff;
/** The move vector is clamped to length 1 by the step; anything past this is not a real client. */
const MOVE_LIMIT = 2;
/** Aim is an atan2 angle, in -π..π. */
const AIM_LIMIT = 2 * Math.PI;
/** Grenade target on the ground: clamped to the throw range by the sim, bounded here. */
const TARGET_LIMIT = 10_000;

type Fields = Record<string, unknown>;

/** A plain object (not null, not an array). */
function record(raw: unknown): Fields | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Fields) : null;
}

const finiteIn = (v: unknown, limit: number): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= limit;
const counter = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_COUNTER;

/**
 * MSG_INPUT. Every field is required but the battle royale's `slot`,
 * `switch`, `swap`, `heal` and `use`, which read as 0 when missing (a client of the other
 * modes may leave them out); present, they must be valid. Extra fields are
 * ignored (not copied).
 */
export function parseInput(raw: unknown): InputMessage | null {
  const m = record(raw);
  if (!m) return null;
  const { seq, mx, mz, aim, fire, gx, gz, dash, grenade, shield, reload } = m;
  if (!counter(seq) || seq === 0) return null;
  if (!finiteIn(mx, MOVE_LIMIT) || !finiteIn(mz, MOVE_LIMIT) || !finiteIn(aim, AIM_LIMIT)) return null;
  if (typeof fire !== "boolean") return null;
  if (!finiteIn(gx, TARGET_LIMIT) || !finiteIn(gz, TARGET_LIMIT)) return null;
  if (!counter(dash) || !counter(grenade) || !counter(shield) || !counter(reload)) return null;
  const { slot = 0, switch: sw = 0, swap = 0, heal = 0, use = 0 } = m;
  if (!(slot === 0 || slot === 1 || slot === 2) || !counter(sw) || !counter(swap)) return null;
  if (!isHealItem(heal) || !counter(use)) return null;
  return { seq, mx, mz, aim, fire, gx, gz, dash, grenade, shield, reload, slot, switch: sw, swap, heal, use };
}

/**
 * MSG_PICK: a weapon id that exists and can be picked, a grenade type that exists, or both.
 * A field that is there must be valid (a bad grenade drops the weapon pick
 * sent with it too); a message with neither is refused.
 */
export function parsePick(raw: unknown): PickMessage | null {
  const m = record(raw);
  if (!m) return null;
  const hasWeapon = m.weapon !== undefined;
  const hasGrenade = m.grenade !== undefined;
  if (!hasWeapon && !hasGrenade) return null;
  // Only a gun the picker offers: never a starting-only one (the royale's Pistol).
  if (hasWeapon && !isPickableWeapon(m.weapon)) return null;
  if (hasGrenade && !isGrenadeType(m.grenade)) return null;
  const out: PickMessage = {};
  if (hasWeapon) out.weapon = m.weapon as number;
  if (hasGrenade) out.grenade = m.grenade as number;
  return out;
}

/** MSG_PONG: the number of the probe being answered. */
export function parsePong(raw: unknown): PingMessage | null {
  const m = record(raw);
  return m && counter(m.n) ? { n: m.n } : null;
}

/** MSG_TAKE_SEAT: a plain object; its fields are ignored. */
export function parseTakeSeat(raw: unknown): Record<string, never> | null {
  return record(raw) ? {} : null;
}

/** MSG_START: a plain object; its fields are ignored. */
export function parseStart(raw: unknown): Record<string, never> | null {
  return record(raw) ? {} : null;
}

/** MSG_TEAM: TEAM_RED or TEAM_BLUE, nothing else. */
export function parseTeam(raw: unknown): TeamMessage | null {
  const m = record(raw);
  return m && (m.team === TEAM_RED || m.team === TEAM_BLUE) ? { team: m.team } : null;
}
