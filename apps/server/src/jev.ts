// The Jev brain (#48): a bot's goal picked by Jev (typesafe/jev-1.13 on
// OpenRouter) instead of the rule table. Jev is a "decisions" model, not a
// chat model: it is served on POST /api/alpha/decisions only. A request
// carries a `state` (a JSON object here: it worked best in the spike, whose
// results are in issue #48) and one `choice` question whose allowed answers
// are the keys of `criteria`, so Jev can only answer one of ours ("fight 2",
// "loot 1", "heal", ...). The answer comes back with a confidence.
//
// The state is built from BotView fields one by one: numbers, flags, gun and
// item keys, and targets by index (enemy 1, loot 2). Never a player name or
// anything from an account (BotView has none; nothing is spread from it).
// Jev doesn't infer "the zone is about to close" from raw numbers, so the
// view's derived flags (outside_zone, zone_closing, low_hp, weak_kit,
// in_range) go into the state as they are.
//
// `decide` rejects on any failure (timeout, HTTP error, bad JSON, an answer
// not among ours, low confidence) and, without calling the network, when the
// day's budget is spent. The caller then falls back to the rule brain. There
// is no per-bot rate limit here: the driver (bots.ts) already has each bot
// decide about once a second (BOT_TUNING.decideEvery) and caps the decisions
// in flight per room. The API key never leaves the Authorization header: not in
// an error, not in a log.

import { HEAL_ITEMS, ITEM_GUN, ITEM_HEAL, ITEM_KINDS, ITEM_PERK, NO_HEAL, PERKS, WEAPONS, type BotBrain, type BotView, type Goal } from "@bagarre/shared";

export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODEL = "typesafe/jev-1.13";

/** Defaults sized from the spike: p95 ≈ 310 ms, ≈ $0.000024 a call, ≈ $0.78/h for 9 bots at 1 decision/s. */
export const JEV_DEFAULTS = {
  /** ~3x the spike's p95. */
  timeoutMs: 1000,
  /** Below this, the answer is a guess: the rule brain decides instead. */
  minConfidence: 0.3,
  /** Dollars per UTC day, all bots together (JEV_DAILY_BUDGET_USD). */
  dailyBudgetUsd: 2,
  /** Charged up front for each call, corrected by the response's usage.cost. */
  costPerCallUsd: 0.000025,
  /** At most this many enemies and loot spots in a request (nearest first). */
  maxEnemies: 5,
  maxLoot: 6,
} as const;

export interface JevOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  minConfidence?: number;
  budget?: { dailyBudgetUsd?: number; costPerCallUsd?: number };
  /** Milliseconds since the epoch (Date.now); the budget day is the UTC day. */
  now?: () => number;
}

/** Why a decision was refused. "budget" never reached the network. */
export type JevFailure = "budget" | "timeout" | "network" | "http" | "bad_json" | "bad_answer" | "low_confidence";

export class JevError extends Error {
  constructor(
    readonly reason: JevFailure,
    message: string,
  ) {
    super(`jev: ${reason}: ${message}`);
    this.name = "JevError";
  }
}

export interface JevStats {
  /** Requests sent to OpenRouter. */
  calls: number;
  /** Requests that gave a goal. */
  answered: number;
  /** Refusals per reason (budget ones made no call). */
  failed: Record<JevFailure, number>;
  /** Spent in the current UTC day, and since start. */
  spentTodayUsd: number;
  spentTotalUsd: number;
  dailyBudgetUsd: number;
  /** Round trip of answered calls. */
  latencyMs: { last: number; mean: number };
}

/** A BotBrain whose `decide` is always async, with its counters. */
export interface JevBrain extends BotBrain {
  decide(view: BotView): Promise<Goal>;
  stats(): JevStats;
}

// ─── The request ──────────────────────────────────────────────────────────

// Every mode: a duel, an FFA or a team deathmatch has no zone, chests or floor items, so only
// fight and roam (and heal, with something to heal with) are offered there.
const INSTRUCTIONS = "You control a bot in a top-down shooter. Which goal should it follow for the next second?";

const HELP = {
  escape_zone: "Run back inside the safe zone. Pick when outside_zone is true, or zone_closing is true (the zone is about to close over the bot).",
  heal: "Use a bandage or medkit. Pick when low_hp is true and no enemy is listed.",
  fight: "Attack an enemy. Pick when an enemy is in range (in_range true); prefer a close, weak one.",
  loot: "Go to a chest or floor item. Pick when weak_kit is true (pistol only, or no heals) and loot is near, or the loot is very close.",
  roam: "Walk toward the zone centre (the map centre when there is no zone). Pick when nothing else applies.",
} as const;

/** "chest", or the floor item's kind and key ("gun rifle", "heal medkit", "perk ..."). */
function itemLabel(kind: number, item: number): string {
  const k = ITEM_KINDS[kind] ?? "item";
  if (kind === ITEM_GUN) return `${k} ${WEAPONS[item]?.key ?? "?"}`;
  if (kind === ITEM_HEAL) return `${k} ${HEAL_ITEMS[item]?.key ?? "?"}`;
  if (kind === ITEM_PERK) return `${k} ${PERKS[item]?.key ?? "?"}`;
  return k;
}

type Loot = { label: string; dist: number; ready: boolean; goal: Goal };

/** The request for `view`, and each allowed answer's goal. Only BotView fields, picked one by one. */
export function jevRequest(view: BotView): { body: object; answers: Map<string, Goal> } {
  const { self, zone } = view;
  const enemies = view.enemies.slice(0, JEV_DEFAULTS.maxEnemies);
  const loot: Loot[] = [
    ...view.chests.map((c): Loot => ({ label: "chest", dist: c.dist, ready: true, goal: { kind: "loot", target: c.id, source: "chest" } })),
    ...view.items.map((i): Loot => ({ label: itemLabel(i.kind, i.item), dist: i.dist, ready: i.ready, goal: { kind: "loot", target: i.id, source: "item" } })),
  ]
    .sort((a, b) => a.dist - b.dist)
    .slice(0, JEV_DEFAULTS.maxLoot);

  const state = {
    hp: self.hp,
    max_hp: 100,
    gun: WEAPONS[self.weapon]?.key ?? "?",
    ammo: `${self.ammo}/${self.magazine}`,
    reloading: self.reloading,
    bandages: self.bandages,
    medkits: self.medkits,
    healing: self.healing,
    low_hp: self.lowHp,
    weak_kit: self.weakKit,
    outside_zone: self.outsideZone,
    zone_closing: self.zoneClosing,
    zone_edge_m: zone ? Math.round(Math.abs(zone.edge)) : null,
    zone_reaches_bot_in_s: zone?.edgeIn != null ? Math.round(zone.edgeIn) : null,
    enemies: enemies.map((e, i) => ({ index: i + 1, dist_m: Math.round(e.dist), hp: e.hp, gun: WEAPONS[e.weapon]?.key ?? "?", in_sight: true, in_range: e.inRange, shielded: e.shielded })),
    loot: loot.map((l, i) => ({ index: i + 1, kind: l.label, dist_m: Math.round(l.dist), ready: l.ready })),
  };

  const criteria: Record<string, string> = {};
  const answers = new Map<string, Goal>();
  const allow = (key: string, help: string, goal: Goal) => {
    criteria[key] = help;
    answers.set(key, goal);
  };
  if (zone) allow("escape_zone", HELP.escape_zone, { kind: "escape_zone" });
  if (self.heal !== NO_HEAL || self.healing) allow("heal", HELP.heal, { kind: "heal" });
  enemies.forEach((e, i) => allow(`fight ${i + 1}`, `${HELP.fight} Target: enemy ${i + 1}.`, { kind: "fight", target: e.id }));
  loot.forEach((l, i) => allow(`loot ${i + 1}`, `${HELP.loot} Target: loot ${i + 1} (${l.label}).`, l.goal));
  allow("roam", HELP.roam, { kind: "roam" });

  return {
    body: { model: JEV_MODEL, state, questions: { goal: { type: "choice", instructions: INSTRUCTIONS, criteria } } },
    answers,
  };
}

// ─── The brain ────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

type ChoiceAnswer = { choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> };
type DecisionsResponse = { answers?: { goal?: ChoiceAnswer }; usage?: { cost?: unknown } };

export function createJevBrain(opts: JevOptions): JevBrain {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? JEV_DEFAULTS.timeoutMs;
  const minConfidence = opts.minConfidence ?? JEV_DEFAULTS.minConfidence;
  const dailyBudgetUsd = opts.budget?.dailyBudgetUsd ?? JEV_DEFAULTS.dailyBudgetUsd;
  const costPerCallUsd = opts.budget?.costPerCallUsd ?? JEV_DEFAULTS.costPerCallUsd;

  const stats: JevStats = {
    calls: 0,
    answered: 0,
    failed: { budget: 0, timeout: 0, network: 0, http: 0, bad_json: 0, bad_answer: 0, low_confidence: 0 },
    spentTodayUsd: 0,
    spentTotalUsd: 0,
    dailyBudgetUsd,
    latencyMs: { last: 0, mean: 0 },
  };
  let day = Math.floor(now() / DAY_MS);

  const spend = (usd: number) => {
    stats.spentTodayUsd += usd;
    stats.spentTotalUsd += usd;
  };
  const fail = (reason: JevFailure, message: string): never => {
    stats.failed[reason]++;
    throw new JevError(reason, message);
  };

  async function call(body: object): Promise<DecisionsResponse> {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced too, so a fetch that ignores the signal still times out.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctrl.abort();
        reject(new JevError("timeout", `no answer in ${timeoutMs} ms`));
      }, timeoutMs);
    });
    const request = (async () => {
      let res: Response;
      try {
        res = await doFetch(JEV_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch {
        throw new JevError(ctrl.signal.aborted ? "timeout" : "network", "request failed");
      }
      if (!res.ok) throw new JevError("http", `HTTP ${res.status}`);
      try {
        return (await res.json()) as DecisionsResponse;
      } catch {
        throw new JevError(ctrl.signal.aborted ? "timeout" : "bad_json", "unreadable response");
      }
    })();
    try {
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
      // The loser of the race must not surface as an unhandled rejection.
      request.catch(() => {});
    }
  }

  async function decide(view: BotView): Promise<Goal> {
    const t = now();
    const today = Math.floor(t / DAY_MS);
    if (today !== day) {
      day = today;
      stats.spentTodayUsd = 0;
    }
    if (stats.spentTodayUsd + costPerCallUsd > dailyBudgetUsd) fail("budget", "daily budget spent");

    const { body, answers } = jevRequest(view);
    stats.calls++;
    // Charged before the answer so that calls in flight count against the budget.
    spend(costPerCallUsd);
    let json: DecisionsResponse;
    try {
      json = await call(body);
    } catch (e) {
      if (!(e instanceof JevError)) return fail("network", "request failed");
      stats.failed[e.reason]++;
      throw e;
    }
    const ms = now() - t;

    const cost = json?.usage?.cost;
    if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) spend(cost - costPerCallUsd);

    const answer = json?.answers?.goal;
    const choice = answer?.choice;
    if (typeof choice !== "string") return fail("bad_json", "no goal answer");
    const goal = answers.get(choice);
    if (!goal) return fail("bad_answer", `"${choice.slice(0, 40)}" is not one of ours`);
    const confidence = typeof answer?.confidence === "number" ? answer.confidence : answer?.probabilities?.[choice];
    if (typeof confidence !== "number" || !(confidence >= minConfidence)) return fail("low_confidence", `${choice} at ${confidence}`);

    stats.answered++;
    stats.latencyMs.last = ms;
    stats.latencyMs.mean += (ms - stats.latencyMs.mean) / stats.answered;
    return goal;
  }

  return { decide, stats: () => structuredClone(stats) };
}

/**
 * The Jev brain from the environment: OPENROUTER_API_KEY (none: null, the
 * caller uses the rule brain and warns once) and JEV_DAILY_BUDGET_USD.
 */
export function jevBrainFromEnv(env: Record<string, string | undefined> = process.env): JevBrain | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  const budget = Number(env.JEV_DAILY_BUDGET_USD);
  return createJevBrain({ apiKey, budget: { dailyBudgetUsd: env.JEV_DAILY_BUDGET_USD && Number.isFinite(budget) && budget >= 0 ? budget : JEV_DEFAULTS.dailyBudgetUsd } });
}
