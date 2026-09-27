// The spectator's view-model: pure functions over the latest snapshot (who
// is in the game, their scores, alive and connected flags) and the camera's
// mode. It decides who the camera follows, switches away when that player
// dies (to their killer, else the leader), orders the player list and says
// whether a seat is free. No DOM, no Three.js, no network: model.test.ts runs
// it under `bun test`, and spectator.ts feeds it one snapshot at a time.
//
// It reads plain maps of player fields, so a net.ts `Snapshot` (players is a
// Map<string, PlayerView>) fits as it is.

/** How the spectator camera frames the game (camera.ts does the framing). */
export type CameraMode = "follow" | "overview" | "free";

export const CAMERA_MODES: readonly CameraMode[] = ["follow", "overview", "free"];

/** The fields of a player the spectator needs (a subset of PlayerView). */
export interface SpectatePlayer {
  name: string;
  slot: number;
  kills: number;
  deaths: number;
  alive: boolean;
  connected: boolean;
}

/** Anything with `get`, `has`, `forEach` and `size`: a Map, or a Colyseus MapSchema. */
export interface PlayerMap<P = SpectatePlayer> {
  readonly size: number;
  get(id: string): P | undefined;
  has(id: string): boolean;
  forEach(cb: (p: P, id: string) => void): void;
}

/** One snapshot, as far as the spectator cares. */
export interface SpectateSnapshot<P extends SpectatePlayer = SpectatePlayer> {
  players: PlayerMap<P>;
  /** Synced spectator count (the room's `spectators` field). Missing: unknown, shown as 0. */
  spectators?: number;
  /** Seats in this game: 2 in a duel, the mode's cap in FFA. */
  maxPlayers: number;
  /**
   * Who killed whom since the previous snapshot, when the server says so
   * (a kill feed message, see docs/spectate.md). Without it the killer is
   * inferred from whose `kills` went up in the same snapshot.
   */
  kills?: readonly { victim: string; killer: string }[];
}

/** How long the camera stays on a player who just died before moving on, ms. */
export const AUTO_SWITCH_DELAY_MS = 1200;

/** The spectator's own state: who is followed, and a switch waiting to happen. */
export interface SpectateState {
  followId: string | null;
  /** Set when the followed player died: move to `to` at `at` (performance.now() ms). */
  pending: { to: string | null; at: number } | null;
}

export const initialSpectateState: SpectateState = { followId: null, pending: null };

/** What the previous snapshot said about each player, for death and kill detection. */
export type PreviousPlayers = PlayerMap<Pick<SpectatePlayer, "alive" | "kills">>;

/**
 * Scoreboard order: most kills, then fewest deaths, then seat. Ties are
 * settled by the seat so the list never shuffles on its own.
 */
export function orderPlayers(players: PlayerMap): string[] {
  const ids: string[] = [];
  players.forEach((_, id) => ids.push(id));
  return ids.sort((a, b) => {
    const pa = players.get(a)!;
    const pb = players.get(b)!;
    return pb.kills - pa.kills || pa.deaths - pb.deaths || pa.slot - pb.slot || (a < b ? -1 : a > b ? 1 : 0);
  });
}

/**
 * The player to watch by default: the first in scoreboard order, preferring
 * someone alive and connected. `except` is skipped (the player who just died).
 */
export function leaderId(players: PlayerMap, except: string | null = null): string | null {
  let fallback: string | null = null;
  for (const id of orderPlayers(players)) {
    if (id === except) continue;
    const p = players.get(id)!;
    if (p.alive && p.connected) return id;
    fallback ??= id;
  }
  return fallback;
}

/** Who has the most kills, strictly (null on a tie or with no kills yet): the list's gold row. */
export function scoreLeader(players: PlayerMap): string | null {
  let best: string | null = null;
  let bestKills = 0;
  let tie = false;
  players.forEach((p, id) => {
    if (p.kills > bestKills) {
      best = id;
      bestKills = p.kills;
      tie = false;
    } else if (p.kills === bestKills && bestKills > 0) tie = true;
  });
  return tie ? null : best;
}

/**
 * Who killed `victim` between two snapshots: the server's word if it sent a
 * kill feed, else the one other player whose kills went up (null when nobody
 * or several did, e.g. a grenade kill landing with another kill).
 */
export function findKiller(victim: string, prev: PreviousPlayers, snap: SpectateSnapshot): string | null {
  const said = snap.kills?.find((k) => k.victim === victim);
  if (said) return said.killer !== victim && snap.players.has(said.killer) ? said.killer : null;
  let killer: string | null = null;
  let count = 0;
  snap.players.forEach((p, id) => {
    if (id === victim) return;
    const before = prev.get(id);
    if (before && p.kills > before.kills) {
      killer = id;
      count++;
    }
  });
  return count === 1 ? killer : null;
}

/** Next or previous player in scoreboard order, wrapping round. From nobody: the first (or last). */
export function cycleTarget(players: PlayerMap, current: string | null, dir: 1 | -1): string | null {
  const order = orderPlayers(players);
  if (order.length === 0) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i < 0) return dir === 1 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}

/**
 * Advances the state by one snapshot. Returns the same object when nothing
 * changed, so a caller can compare by identity.
 *
 * - Nobody followed yet (or they left): the leader.
 * - The followed player died: after AUTO_SWITCH_DELAY_MS, their killer if
 *   there is one, else the leader (never the dead player again).
 * - A manual pick (`follow`) cancels a pending switch.
 */
export function stepSpectate(state: SpectateState, prev: PreviousPlayers | null, snap: SpectateSnapshot, now: number): SpectateState {
  const players = snap.players;
  if (players.size === 0) return state.followId === null && state.pending === null ? state : initialSpectateState;

  const { followId, pending } = state;
  if (!followId || !players.has(followId)) return { followId: leaderId(players), pending: null };

  const followed = players.get(followId)!;
  if (pending) {
    // They respawned before the switch: stay.
    if (followed.alive) return { followId, pending: null };
    if (now < pending.at) return state;
    const to = pending.to && players.has(pending.to) ? pending.to : leaderId(players, followId);
    return { followId: to ?? followId, pending: null };
  }

  const before = prev?.get(followId);
  if (before?.alive && !followed.alive) {
    const killer = prev ? findKiller(followId, prev, snap) : null;
    return { followId, pending: { to: killer, at: now + AUTO_SWITCH_DELAY_MS } };
  }
  return state;
}

/** A manual pick: follow `id` now, whatever was pending. */
export function follow(state: SpectateState, id: string): SpectateState {
  return state.followId === id && !state.pending ? state : { followId: id, pending: null };
}

// --- What the spectator UI shows ------------------------------------------------

export interface SpectateRow {
  id: string;
  name: string;
  /** CSS colour of the player's slot. */
  color: string;
  kills: number;
  deaths: number;
  alive: boolean;
  connected: boolean;
  followed: boolean;
  /** Strictly the most kills. */
  leader: boolean;
}

export interface SpectateUiModel {
  mode: CameraMode;
  /** The followed player (in Follow mode), or null. */
  watching: { id: string; name: string; color: string } | null;
  rows: SpectateRow[];
  spectators: number;
  /** Seats taken, and the game's cap. */
  players: number;
  maxPlayers: number;
  /** A seat is free: offer "Join the game". */
  canJoin: boolean;
}

/**
 * Fallback slot colours: the duel's two (scene.ts' PLAYER_CSS_COLORS), then
 * four more for FFA. The wiring passes the real palette once FFA has one.
 */
export const FALLBACK_SLOT_COLORS = ["#ff6b4a", "#4ab8ff", "#8be36a", "#ffd24a", "#c77dff", "#4ae3d2"];

export const fallbackColor = (slot: number): string =>
  FALLBACK_SLOT_COLORS[((slot % FALLBACK_SLOT_COLORS.length) + FALLBACK_SLOT_COLORS.length) % FALLBACK_SLOT_COLORS.length];

/** The UI model for a snapshot, the spectator state and the camera mode. Compare with jsonEqual. */
export function spectateUiModel(
  snap: SpectateSnapshot,
  state: SpectateState,
  mode: CameraMode,
  colorOf: (slot: number) => string = fallbackColor,
): SpectateUiModel {
  const players = snap.players;
  const leader = scoreLeader(players);
  const rows = orderPlayers(players).map((id): SpectateRow => {
    const p = players.get(id)!;
    return {
      id,
      name: p.name,
      color: colorOf(p.slot),
      kills: p.kills,
      deaths: p.deaths,
      alive: p.alive,
      connected: p.connected,
      followed: id === state.followId,
      leader: id === leader,
    };
  });
  const f = mode === "follow" && state.followId ? players.get(state.followId) : undefined;
  return {
    mode,
    watching: f && state.followId ? { id: state.followId, name: f.name, color: colorOf(f.slot) } : null,
    rows,
    spectators: snap.spectators ?? 0,
    players: players.size,
    maxPlayers: snap.maxPlayers,
    canJoin: players.size < snap.maxPlayers,
  };
}

/** Keeps just what `stepSpectate` needs from a snapshot, reusing `into`'s entries. */
export function rememberPlayers(
  players: PlayerMap,
  into: Map<string, { alive: boolean; kills: number }>,
): Map<string, { alive: boolean; kills: number }> {
  for (const id of into.keys()) if (!players.has(id)) into.delete(id);
  players.forEach((p, id) => {
    const e = into.get(id);
    if (e) {
      e.alive = p.alive;
      e.kills = p.kills;
    } else into.set(id, { alive: p.alive, kills: p.kills });
  });
  return into;
}
