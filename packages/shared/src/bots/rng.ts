// The bots' seeded random numbers (mulberry32, like the physics bench). No
// Math.random anywhere in bot code: the same seed gives the same bot, so the
// unit and e2e tests are repeatable.

export interface BotRng {
  /** The generator's state: copy it to fork or replay a bot. */
  state: number;
}

export function createRng(seed: number): BotRng {
  return { state: seed >>> 0 };
}

/** The next draw in [0, 1). */
export function rngNext(rng: BotRng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A draw in [lo, hi). */
export function rngRange(rng: BotRng, lo: number, hi: number): number {
  return lo + (hi - lo) * rngNext(rng);
}
