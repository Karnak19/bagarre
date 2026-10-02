// Bots: battle royale seats the server drives (#48). A bot is a seat like
// any other (a Player in `state.players` and its internals in GameRoom), with
// no Colyseus client: GameRoom.addBot seats it, and every tick
// GameRoom.feedBots puts one input from the room's `BotDriver` in its queue,
// which then goes through applyInput and the shared step exactly like a
// client's.
//
// The driver holds each bot's memory and runs the shared two layers
// (@bagarre/shared bots): about once a second a brain picks a goal, every
// tick the control layer turns it into an input. The brain is picked in one
// place (`chooseBrain`). It may answer later (a Promise, the Jev brain): the
// tick never waits for it. The bot keeps its goal meanwhile, an answer is
// checked against a fresh view before it's taken, and one that fails (no
// answer within BOT_DECISION_TIMEOUT, an error, garbage) makes the bot's
// next decision the rule brain's.
//
// Outside "playing" (the lobby, the warmup, the result) a bot stands still
// and presses nothing.

import {
  BOT_TUNING,
  GOAL_KINDS,
  NO_HEAL,
  buildBotView,
  createBotState,
  createRng,
  flowField,
  goalValid,
  botInput as controlInput,
  navGrid,
  ruleBrain,
  ticks,
  zoneFlowTarget,
  type BotBrain,
  type BotRng,
  type BotState,
  type BotView,
  type BotWorld,
  type Goal,
  type InputMessage,
  type MapDef,
  type ZoneView,
} from "@bagarre/shared";

/**
 * Bot ids start with this. Colyseus session ids are letters, digits, `_` and
 * `-`, never a `:`, so a bot's id can't collide with a client's.
 */
export const BOT_ID_PREFIX = "bot:";

/**
 * Bot names, in the order they are handed out. Never a guest name, and never
 * a username (those have no spaces), so nobody mistakes a bot for a person.
 */
export const BOT_NAMES = ["Bot Ada", "Bot Rex", "Bot Ivy", "Bot Max", "Bot Zoe", "Bot Leo", "Bot Kit", "Bot Sam", "Bot Uma", "Bot Ned"] as const;

/** The first bot name nobody in the room has (`taken`: every seat's name). */
export function botName(taken: ReadonlySet<string>): string {
  const free = BOT_NAMES.find((n) => !taken.has(n));
  if (free) return free;
  for (let i = BOT_NAMES.length + 1; ; i++) if (!taken.has(`Bot ${i}`)) return `Bot ${i}`;
}

/** An answer not in by then is given up (the bot's next decision is the rule brain's). Ticks. */
export const BOT_DECISION_TIMEOUT = ticks(1);

/** Decisions waiting for an answer in one room at most; a bot due past it tries again next tick. */
export const BOT_MAX_IN_FLIGHT = 4;

/** The seed of a room's bots when none is given: the same bots every run. */
export const BOT_ROOM_SEED = 48;

/**
 * The brain bots decide with. The one place to pick it: the rule brain for
 * now; the Jev brain (jev.ts) goes here.
 */
export function chooseBrain(): BotBrain {
  return ruleBrain;
}

/**
 * Where a decision came from: "jev" an answer taken from the chosen brain
 * when it isn't the rule brain, "rule" the rule brain as the chosen brain,
 * "fallback" the rule brain because the bot's last decision failed.
 */
export type DecisionSource = "jev" | "rule" | "fallback";

/** A room's decision counts since the last match end, and the answers dropped (late, errors, garbage, stale). */
export interface DecisionCounts {
  jev: number;
  rule: number;
  fallback: number;
  dropped: number;
}

/** One bot's memory, from tick to tick and match to match. */
interface BotMind {
  state: BotState;
  rng: BotRng;
  goal: Goal;
  /** The tick of its next decision. */
  nextDecide: number;
  /** The decision waiting for an answer: its token and the tick it was asked on. */
  pending: { gen: number; since: number } | null;
  /** An answer in, taken (if still valid) on the bot's next feed, with that tick's view. */
  answer: Goal | null;
  /** The last decision failed: the next one is the rule brain's. */
  fallback: boolean;
}

/** A 32-bit hash of a string (FNV-1a): a bot's own seed from its id. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * A goal as an untrusted answer: one of GOAL_KINDS with the fields it needs
 * (ids are strings), else null. Only the known fields are kept.
 */
export function saneGoal(x: unknown): Goal | null {
  if (typeof x !== "object" || x === null) return null;
  const g = x as Record<string, unknown>;
  if (typeof g.kind !== "string" || !(GOAL_KINDS as readonly string[]).includes(g.kind)) return null;
  switch (g.kind) {
    case "fight":
      return typeof g.target === "string" && g.target !== "" ? { kind: "fight", target: g.target } : null;
    case "loot":
      return typeof g.target === "string" && g.target !== "" && (g.source === "chest" || g.source === "item") ? { kind: "loot", target: g.target, source: g.source } : null;
    case "escape_zone":
    case "heal":
    case "roam":
      return { kind: g.kind };
  }
  return null;
}

/** Standing still, pressing nothing new (the counters as they are), aim kept. */
function idleInput(state: BotState, me: { x: number; z: number; kit: { hand: number } }): InputMessage {
  const p = state.presses;
  return { seq: state.seq, mx: 0, mz: 0, aim: state.aim, fire: false, gx: me.x, gz: me.z, ...p, slot: me.kit.hand, heal: NO_HEAL };
}

/**
 * A room's bots: each one's memory (control state, seeded random numbers,
 * goal, decision schedule), the brain, and the decision counts. GameRoom
 * builds the world once a tick and asks `input` for each bot.
 */
export class BotDriver {
  private minds = new Map<string, BotMind>();
  /** Bots seen so far: the order that staggers their decisions. */
  private seen = 0;
  /** Decisions waiting for an answer, across the room. */
  private inFlight = 0;
  private gen = 0;
  private readonly brain: BotBrain;
  private readonly seed: number;
  counts: DecisionCounts = { jev: 0, rule: 0, fallback: 0, dropped: 0 };

  constructor(opts: { brain?: BotBrain; seed?: number } = {}) {
    this.brain = opts.brain ?? chooseBrain();
    this.seed = opts.seed ?? BOT_ROOM_SEED;
  }

  recordDecision(source: DecisionSource) {
    this.counts[source]++;
  }

  /** The counts since the last call, which starts them again from 0. */
  takeCounts(): DecisionCounts {
    const c = this.counts;
    this.counts = { jev: 0, rule: 0, fallback: 0, dropped: 0 };
    return c;
  }

  /** Decisions waiting for an answer right now. */
  get pending(): number {
    return this.inFlight;
  }

  /**
   * A match starts: every bot starts afresh (path, target, roam, goal), its
   * press counters and seq kept (they only go up: applyInput baselined the
   * seat once), and any decision still out is given up. The map's grid is
   * built now rather than in a tick.
   */
  startMatch(map: MapDef) {
    navGrid(map);
    this.minds.forEach((m) => {
      this.settle(m);
      const fresh = createBotState(m.state.id, m.state.aim);
      fresh.seq = m.state.seq;
      fresh.presses = m.state.presses;
      m.state = fresh;
      m.goal = { kind: "roam" };
      m.answer = null;
      m.fallback = false;
    });
  }

  /** Play starts with this zone: its flow field (escape_zone) is built now rather than in a tick. */
  zoneSet(map: MapDef, zone: ZoneView) {
    const target = zoneFlowTarget(zone);
    if (target) flowField(navGrid(map), target);
  }

  /** A bot's seat is gone for good: its memory goes, and its decision out (if any) is given up. */
  forget(id: string) {
    const m = this.minds.get(id);
    if (!m) return;
    this.settle(m);
    this.minds.delete(id);
  }

  /**
   * Bot `id`'s input for this tick (`world`: the room this tick, built once
   * for every bot), or null when it isn't in `world.players`. Synchronous,
   * whatever the brain: an answer that isn't in yet is taken on a later tick.
   */
  input(world: BotWorld, id: string): InputMessage | null {
    const me = world.players.get(id);
    if (!me) return null;
    const m = this.mind(id, world.tick);
    if (world.phase !== "playing") {
      m.state.seq++;
      return idleInput(m.state, me);
    }
    const view = buildBotView(world, id);
    if (!view) return null;
    this.think(m, view);
    return controlInput(m.state, m.goal, view, navGrid(world.map), m.rng);
  }

  private mind(id: string, tick: number): BotMind {
    let m = this.minds.get(id);
    if (!m) {
      // Staggered: bots seen one after the other decide on different ticks.
      const offset = this.seen++ % ticks(BOT_TUNING.decideEvery);
      m = { state: createBotState(id), rng: createRng(hash(id) ^ this.seed), goal: { kind: "roam" }, nextDecide: tick + 1 + offset, pending: null, answer: null, fallback: false };
      this.minds.set(id, m);
    }
    return m;
  }

  /** The decision part of a tick: an answer that came in, a decision given up, a new one due. */
  private think(m: BotMind, view: BotView) {
    if (m.answer) {
      const goal = m.answer;
      m.answer = null;
      if (goalValid(goal, view)) {
        m.goal = goal;
        this.recordDecision("jev");
      } else this.counts.dropped++;
    }
    if (m.pending && view.tick - m.pending.since >= BOT_DECISION_TIMEOUT) {
      this.settle(m);
      this.fail(m);
    }
    // Knocked out: nothing left to decide (and no remote call spent on it).
    if (!view.self.alive || view.tick < m.nextDecide || m.pending) return;

    if (m.fallback || this.brain === ruleBrain) {
      m.nextDecide = view.tick + ticks(BOT_TUNING.decideEvery);
      // The rule brain answers at once.
      m.goal = ruleBrain.decide(view) as Goal;
      this.recordDecision(m.fallback ? "fallback" : "rule");
      m.fallback = false;
      return;
    }
    // At the cap: try again next tick, on the goal it has.
    if (this.inFlight >= BOT_MAX_IN_FLIGHT) return;
    m.nextDecide = view.tick + ticks(BOT_TUNING.decideEvery);
    let answer: Goal | Promise<Goal>;
    try {
      answer = this.brain.decide(view);
    } catch {
      this.fail(m);
      return;
    }
    if (!(answer instanceof Promise)) {
      const goal = saneGoal(answer);
      if (!goal) this.fail(m);
      else if (!goalValid(goal, view)) this.counts.dropped++;
      else {
        m.goal = goal;
        this.recordDecision("jev");
      }
      return;
    }
    const gen = ++this.gen;
    m.pending = { gen, since: view.tick };
    this.inFlight++;
    answer.then(
      (raw) => {
        if (m.pending?.gen !== gen) return; // Given up already (late, or the bot is gone).
        this.settle(m);
        const goal = saneGoal(raw);
        // Checked against the view of the tick it is taken on (think, above).
        if (goal) m.answer = goal;
        else this.fail(m);
      },
      () => {
        if (m.pending?.gen !== gen) return;
        this.settle(m);
        this.fail(m);
      },
    );
  }

  /**
   * The decision out is answered, or given up (its answer, when it comes, is
   * then ignored): it no longer counts toward the cap.
   */
  private settle(m: BotMind) {
    if (!m.pending) return;
    m.pending = null;
    this.inFlight--;
  }

  /** A decision failed (late, an error, garbage): the goal stays, the next decision is the rule brain's. */
  private fail(m: BotMind) {
    this.counts.dropped++;
    m.fallback = true;
  }
}
