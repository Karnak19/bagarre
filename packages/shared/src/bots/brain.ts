// The decision layer: about once a second a brain looks at a bot's view and
// picks one goal from a fixed list; the control layer (control.ts) turns the
// goal into inputs every tick. A brain sits behind one interface
// (`BotBrain`), so the server can swap the rule brain below for the Jev
// brain (an LLM, asynchronous) and fall back to this one.
//
// `ruleBrain` scores every goal per #48's table and the highest wins:
//   escape_zone  outside the zone, or it's about to close over the bot
//   heal         low HP, no enemy in sight, a healing item to use
//   fight        an enemy in line of sight and in range
//   loot         a weak kit (Pistol only, no heals) and a chest or item nearby
//   roam         nothing else: toward the zone's centre

import { NO_HEAL } from "../constants.ts";
import { BOT_TUNING } from "./tuning.ts";
import type { BotView } from "./view.ts";

/** One goal, targets by id (a session id, a chest id or an item id: never a name). */
export type Goal =
  | { kind: "escape_zone" }
  | { kind: "heal" }
  | { kind: "fight"; target: string }
  | { kind: "loot"; target: string; source: "chest" | "item" }
  | { kind: "roam" };

export type GoalKind = Goal["kind"];

export const GOAL_KINDS: readonly GoalKind[] = ["escape_zone", "heal", "fight", "loot", "roam"];

/** Takes a bot's view, returns its goal. Async for a brain that asks a remote model. */
export interface BotBrain {
  decide(view: BotView): Goal | Promise<Goal>;
}

/** A goal and its score (`scoreGoals`). */
export interface ScoredGoal {
  goal: Goal;
  score: number;
}

/** Every goal that makes sense in `view`, with its score, best first (roam is always there). */
export function scoreGoals(view: BotView): ScoredGoal[] {
  const S = BOT_TUNING.score;
  const out: ScoredGoal[] = [{ goal: { kind: "roam" }, score: S.roam }];
  const { self } = view;
  if (!self.alive) return out;

  if (self.outsideZone) out.push({ goal: { kind: "escape_zone" }, score: S.escapeOutside });
  else if (self.zoneClosing) out.push({ goal: { kind: "escape_zone" }, score: S.escapeSoon });

  // Heal: low, nobody in sight, and a heal can start (or one is running: keep at it).
  if (view.enemies.length === 0 && self.lowHp && (self.heal !== NO_HEAL || self.healing)) {
    out.push({ goal: { kind: "heal" }, score: S.heal + (BOT_TUNING.lowHp - self.hp) / 10 });
  }

  // Fight: the nearest enemy in range (`inRange`: a clear shot, within the gun's useful range), else the nearest in sight.
  const target = view.enemies.find((e) => e.inRange) ?? view.enemies.find((e) => e.shot) ?? view.enemies[0];
  if (target) out.push({ goal: { kind: "fight", target: target.id }, score: target.inRange ? S.fight : S.fightFar });

  // Loot: the nearest chest or wanted item. A weak kit wants it from anywhere in the view, a good one only close by.
  const weak = self.weakKit;
  const chest = view.chests[0];
  const item = view.items[0];
  const pick = chest && (!item || chest.dist <= item.dist) ? { target: chest.id, source: "chest" as const, dist: chest.dist } : item ? { target: item.id, source: "item" as const, dist: item.dist } : null;
  if (pick && (weak || pick.dist <= BOT_TUNING.lootNear)) {
    out.push({ goal: { kind: "loot", target: pick.target, source: pick.source }, score: weak ? S.lootWeak : S.lootNear });
  }

  // A stable sort: on a tie the order above wins.
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** The rule brain: pure, deterministic, synchronous. */
export const ruleBrain: BotBrain = {
  decide: (view) => scoreGoals(view)[0].goal,
};

/**
 * Whether a goal still makes sense in `view`: its target is still there (the
 * enemy alive and in sight, the chest still closed, the item still on the
 * floor and wanted). An answer that arrives late (Jev) is checked with this
 * before the bot switches to it.
 */
export function goalValid(goal: Goal, view: BotView): boolean {
  switch (goal.kind) {
    case "fight":
      return view.enemies.some((e) => e.id === goal.target);
    case "loot":
      return goal.source === "chest" ? view.chests.some((c) => c.id === goal.target) : view.items.some((i) => i.id === goal.target);
    case "heal":
      return view.self.healing || view.self.heal !== NO_HEAL;
    case "escape_zone":
      return view.zone !== null;
    case "roam":
      return true;
  }
}
