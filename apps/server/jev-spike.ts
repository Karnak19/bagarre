// Jev spike (issue #48, step 0): sends Jev (typesafe/jev-1.13 on OpenRouter)
// hand-written royale situations and checks that it picks one of our goals,
// how fast, and what a call costs. Run with `bun apps/server/jev-spike.ts`
// from the repo root (bun loads OPENROUTER_API_KEY from the root .env).
//
// Jev is a "decisions" model: OpenRouter rejects it on /chat/completions and
// serves it on POST /api/alpha/decisions instead. A request carries a `state`
// (text or JSON) and typed `questions`; a `choice` question lists its allowed
// answers as the keys of `criteria`, so Jev can only answer one of them. The
// script first checks the chat surface once per variant (system prompt,
// response_format, tools, max_tokens + temperature), then runs each situation
// RUNS times through three shapes of decision request:
//   - text:  state is a one-line summary, one choice over the flat answers
//            ("fight 2", "loot 1", "heal", ...);
//   - json:  state is a JSON object of the same numbers, same question;
//   - split: text state, two questions in one call: the goal (5 fixed labels)
//            and the target (enemy/crate/item index).
// Prompts hold numbers and goal labels only, never player names. The key is
// never printed.

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("OPENROUTER_API_KEY is not set (put it in the repo root .env)");
  process.exit(1);
}

const MODEL = "typesafe/jev-1.13";
const BASE = "https://openrouter.ai/api";
const RUNS = Number(process.env.RUNS ?? 5);
const TIMEOUT_MS = 10_000;
const BOTS = 9;

type Enemy = { dist: number; hp: number; gun: string; inSight: boolean };
type Loot = { kind: "crate" | "gun" | "bandage" | "medkit"; dist: number };

type Situation = {
  name: string;
  hp: number;
  gun: string;
  ammo: string;
  bandages: number;
  medkits: number;
  /** Negative: outside the zone, by that many metres. */
  zoneEdge: number;
  zoneClosesIn: number;
  enemies: Enemy[];
  loot: Loot[];
  /** Answers that match the rule table in issue #48. */
  expect: string[];
};

const SITUATIONS: Situation[] = [
  {
    name: "outside zone",
    hp: 80, gun: "rifle", ammo: "20/30", bandages: 1, medkits: 0,
    zoneEdge: -12, zoneClosesIn: 0,
    enemies: [], loot: [{ kind: "crate", dist: 6 }],
    expect: ["escape_zone"],
  },
  {
    name: "zone closing on bot",
    hp: 90, gun: "shotgun", ammo: "6/8", bandages: 0, medkits: 1,
    zoneEdge: 2, zoneClosesIn: 4,
    enemies: [], loot: [{ kind: "gun", dist: 9 }],
    expect: ["escape_zone"],
  },
  {
    name: "low hp, safe, has heals",
    hp: 25, gun: "rifle", ammo: "18/30", bandages: 2, medkits: 1,
    zoneEdge: 30, zoneClosesIn: 60,
    enemies: [], loot: [{ kind: "crate", dist: 14 }],
    expect: ["heal"],
  },
  {
    name: "one enemy in range",
    hp: 85, gun: "rifle", ammo: "25/30", bandages: 1, medkits: 0,
    zoneEdge: 25, zoneClosesIn: 40,
    enemies: [{ dist: 12, hp: 60, gun: "pistol", inSight: true }],
    loot: [],
    expect: ["fight 1"],
  },
  {
    name: "two enemies, one weak and close",
    hp: 70, gun: "smg", ammo: "30/40", bandages: 0, medkits: 0,
    zoneEdge: 20, zoneClosesIn: 45,
    enemies: [
      { dist: 22, hp: 100, gun: "rifle", inSight: true },
      { dist: 7, hp: 15, gun: "pistol", inSight: true },
    ],
    loot: [],
    expect: ["fight 2"],
  },
  {
    name: "weak kit, crate and gun nearby",
    hp: 100, gun: "pistol", ammo: "12/12", bandages: 0, medkits: 0,
    zoneEdge: 35, zoneClosesIn: 70,
    enemies: [],
    loot: [{ kind: "crate", dist: 18 }, { kind: "gun", dist: 5 }],
    expect: ["loot 2", "loot 1"],
  },
  {
    name: "low hp, no heals, medkit on floor",
    hp: 30, gun: "rifle", ammo: "10/30", bandages: 0, medkits: 0,
    zoneEdge: 28, zoneClosesIn: 50,
    enemies: [],
    loot: [{ kind: "medkit", dist: 6 }, { kind: "crate", dist: 20 }],
    expect: ["loot 1"],
  },
  {
    name: "nothing around",
    hp: 100, gun: "rifle", ammo: "30/30", bandages: 2, medkits: 1,
    zoneEdge: 15, zoneClosesIn: 50,
    enemies: [], loot: [],
    expect: ["roam"],
  },
];

// ─── Prompt building (numbers and labels only) ────────────────────────────

const GOAL_HELP = {
  escape_zone: "Run back inside the safe zone. Pick when outside the zone, or the zone is about to close over the bot.",
  heal: "Use a bandage or medkit. Pick when HP is low, no enemy is in sight, and the bot carries a bandage or medkit.",
  fight: "Attack an enemy. Pick when an enemy is in sight and in range.",
  loot: "Go to a crate or floor item. Pick when the kit is weak (pistol only, or no heals when hurt) and loot is nearby.",
  roam: "Walk toward the zone centre. Pick when nothing else applies.",
} as const;

const textState = (s: Situation): string => {
  const zone = s.zoneEdge < 0
    ? `OUTSIDE the zone, ${-s.zoneEdge} m from its edge`
    : `inside the zone, ${s.zoneEdge} m from its edge, zone shrinks in ${s.zoneClosesIn} s`;
  const enemies = s.enemies.length
    ? s.enemies.map((e, i) => `enemy ${i + 1}: ${e.dist} m, HP ${e.hp}, ${e.gun}${e.inSight ? ", in sight" : ""}`).join("; ")
    : "none";
  const loot = s.loot.length
    ? s.loot.map((l, i) => `${l.kind === "crate" ? "crate" : "item"} ${i + 1}: ${l.kind}, ${l.dist} m`).join("; ")
    : "none";
  return `HP ${s.hp}/100. Gun: ${s.gun}, ammo ${s.ammo}. Bandages ${s.bandages}, medkits ${s.medkits}. ` +
    `Bot is ${zone}. Enemies: ${enemies}. Loot: ${loot}.`;
};

const jsonState = (s: Situation) => ({
  hp: s.hp, max_hp: 100, gun: s.gun, ammo: s.ammo,
  bandages: s.bandages, medkits: s.medkits,
  outside_zone: s.zoneEdge < 0,
  zone_edge_m: Math.abs(s.zoneEdge),
  zone_shrinks_in_s: s.zoneClosesIn,
  enemies: s.enemies.map((e, i) => ({ index: i + 1, dist_m: e.dist, hp: e.hp, gun: e.gun, in_sight: e.inSight })),
  loot: s.loot.map((l, i) => ({ index: i + 1, kind: l.kind, dist_m: l.dist })),
});

/** Flat answers allowed in this situation, each with its rule-table hint. */
const flatCriteria = (s: Situation): Record<string, string> => {
  const c: Record<string, string> = { escape_zone: GOAL_HELP.escape_zone, heal: GOAL_HELP.heal };
  s.enemies.forEach((_, i) => { c[`fight ${i + 1}`] = `${GOAL_HELP.fight} Target: enemy ${i + 1}.`; });
  s.loot.forEach((l, i) => { c[`loot ${i + 1}`] = `${GOAL_HELP.loot} Target: ${l.kind === "crate" ? "crate" : "item"} ${i + 1}.`; });
  c.roam = GOAL_HELP.roam;
  return c;
};

const INSTRUCTIONS = "You control a bot in a top-down battle royale shooter. Which goal should it follow for the next second?";

type Question = { type: "choice"; instructions: string; criteria: Record<string, string> };
type DecisionRequest = { state: string | object; questions: Record<string, Question> };

const flatRequest = (state: string | object, s: Situation): DecisionRequest => ({
  state,
  questions: { goal: { type: "choice", instructions: INSTRUCTIONS, criteria: flatCriteria(s) } },
});

const splitRequest = (s: Situation): DecisionRequest => {
  const targets: Record<string, string> = { none: "No target: the goal is escape_zone, heal or roam." };
  s.enemies.forEach((_, i) => { targets[`enemy ${i + 1}`] = `Enemy ${i + 1}, when the goal is fight.`; });
  s.loot.forEach((l, i) => { targets[`${l.kind === "crate" ? "crate" : "item"} ${i + 1}`] = `The ${l.kind} ${i + 1}, when the goal is loot.`; });
  return {
    state: textState(s),
    questions: {
      goal: { type: "choice", instructions: INSTRUCTIONS, criteria: { ...GOAL_HELP } },
      target: { type: "choice", instructions: "If the bot fights or loots, which target?", criteria: targets },
    },
  };
};

// ─── Calls ────────────────────────────────────────────────────────────────

type ChoiceAnswer = { type: "choice"; choice: string; confidence?: number; probabilities?: Record<string, number> };
type DecisionsResponse = {
  answers?: Record<string, ChoiceAnswer>;
  usage?: { input_tokens: number; output_tokens: number; cost?: number };
  error?: { message: string; code: number };
};

type Sample = {
  approach: string;
  situation: Situation;
  ms: number;
  answer: string | null;
  confidence: number | null;
  inTok: number;
  outTok: number;
  cost: number;
  error: string | null;
};

const post = async (path: string, body: object) => {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json()) as DecisionsResponse;
  return { status: res.status, ms: performance.now() - t0, json };
};

const decide = (req: DecisionRequest) => post("/alpha/decisions", { model: MODEL, ...req });

/** Joins the split answers back into the flat form ("fight 2", "loot 1", ...). */
const joinSplit = (goal: string, target: string | undefined): string => {
  if (goal !== "fight" && goal !== "loot") return goal;
  const index = target?.match(/^(enemy|crate|item) (\d+)$/);
  if (!index) return `${goal} ?`;
  if ((goal === "fight") !== (index[1] === "enemy")) return `${goal} ${target}`;
  return `${goal} ${index[2]}`;
};

const sample = async (approach: string, s: Situation, raw: { log: boolean }): Promise<Sample> => {
  const req = approach === "text" ? flatRequest(textState(s), s)
    : approach === "json" ? flatRequest(jsonState(s), s)
    : splitRequest(s);
  const base = { approach, situation: s, answer: null, confidence: null, inTok: 0, outTok: 0, cost: 0 };
  try {
    const { status, ms, json } = await decide(req);
    if (raw.log) {
      console.log(`\n--- raw ${approach} / ${s.name} (HTTP ${status}, ${ms.toFixed(0)} ms)`);
      console.log("state:", JSON.stringify(req.state));
      console.log("response:", JSON.stringify(json));
    }
    if (status !== 200 || !json.answers) return { ...base, ms, error: json.error?.message ?? `HTTP ${status}` };
    const goal = json.answers.goal;
    const answer = approach === "split" ? joinSplit(goal.choice, json.answers.target?.choice) : goal.choice;
    return {
      ...base, ms, answer,
      confidence: goal.confidence ?? null,
      inTok: json.usage?.input_tokens ?? 0,
      outTok: json.usage?.output_tokens ?? 0,
      cost: json.usage?.cost ?? 0,
      error: null,
    };
  } catch (e) {
    return { ...base, ms: TIMEOUT_MS, error: e instanceof Error ? e.message : String(e) };
  }
};

/** The answers a situation allows, in the flat form. */
const allowed = (s: Situation) => new Set(Object.keys(flatCriteria(s)));

// ─── 1. The chat surface ─────────────────────────────────────────────────

const probeChat = async () => {
  const s = SITUATIONS[2];
  const system = `You control a bot in a battle royale. Pick exactly one goal. Allowed answers: ${Object.keys(flatCriteria(s)).join(", ")}. Reply with the answer only.`;
  const messages = [{ role: "system", content: system }, { role: "user", content: textState(s) }];
  const variants: [string, object][] = [
    ["system prompt only", {}],
    ["response_format json_schema", {
      response_format: {
        type: "json_schema",
        json_schema: { name: "goal", strict: true, schema: { type: "object", properties: { goal: { type: "string", enum: Object.keys(flatCriteria(s)) } }, required: ["goal"] } },
      },
    }],
    ["tools + tool_choice required", {
      tools: [{ type: "function", function: { name: "choose", parameters: { type: "object", properties: { goal: { type: "string", enum: Object.keys(flatCriteria(s)) } }, required: ["goal"] } } }],
      tool_choice: "required",
    }],
    ["max_tokens 5 + temperature 0", { max_tokens: 5, temperature: 0 }],
  ];
  console.log("\n## Chat surface (/v1/chat/completions)");
  for (const [label, extra] of variants) {
    const { status, ms, json } = await post("/v1/chat/completions", { model: MODEL, messages, usage: { include: true }, ...extra });
    console.log(`${label.padEnd(30)} HTTP ${status} in ${ms.toFixed(0)} ms: ${json.error?.message ?? JSON.stringify(json).slice(0, 120)}`);
  }
  // Chat-style knobs on the decisions endpoint: rejected or ignored?
  const { status, json } = await post("/alpha/decisions", { model: MODEL, ...flatRequest(textState(s), s), temperature: 0, max_tokens: 5 });
  console.log(`${"decisions + temperature/max_tokens".padEnd(30)} HTTP ${status}: ${json.error?.message ?? `ok, answer ${json.answers?.goal?.choice}`}`);
};

// ─── Stats ───────────────────────────────────────────────────────────────

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const usd = (x: number) => `$${x.toFixed(x < 0.01 ? 7 : 2)}`;

const summarize = (label: string, samples: Sample[]) => {
  const ok = samples.filter((x) => !x.error);
  const valid = ok.filter((x) => x.answer !== null && allowed(x.situation).has(x.answer));
  const sensible = valid.filter((x) => x.situation.expect.includes(x.answer!));
  const ms = ok.map((x) => x.ms);
  return {
    approach: label,
    calls: samples.length,
    errors: samples.length - ok.length,
    valid: `${valid.length}/${samples.length}`,
    sensible: `${sensible.length}/${samples.length}`,
    p50_ms: Math.round(pct(ms, 50)),
    p95_ms: Math.round(pct(ms, 95)),
    max_ms: Math.round(Math.max(...ms)),
    in_tok: Math.round(mean(ok.map((x) => x.inTok))),
    out_tok: Math.round(mean(ok.map((x) => x.outTok))),
    cost_call: usd(mean(ok.map((x) => x.cost))),
  };
};

// ─── Main ────────────────────────────────────────────────────────────────

await probeChat();

const APPROACHES = ["text", "json", "split"];
const all: Sample[] = [];
console.log(`\n## Decisions endpoint (/alpha/decisions): ${SITUATIONS.length} situations × ${RUNS} runs × ${APPROACHES.length} approaches, sequential`);
for (const approach of APPROACHES) {
  for (const [si, s] of SITUATIONS.entries()) {
    for (let r = 0; r < RUNS; r++) {
      // Print the raw exchange for two situations of each approach.
      all.push(await sample(approach, s, { log: r === 0 && (si === 2 || si === 4) }));
    }
  }
}

console.log("\n## Picks per situation (sequential runs)");
console.table(SITUATIONS.map((s) => {
  const row: Record<string, string> = { situation: s.name, expected: s.expect.join(" | ") };
  for (const a of APPROACHES) {
    const picks = all.filter((x) => x.approach === a && x.situation === s).map((x) => x.error ? "ERR" : x.answer ?? "?");
    const counts = new Map<string, number>();
    for (const p of picks) counts.set(p, (counts.get(p) ?? 0) + 1);
    row[a] = [...counts].map(([p, n]) => `${p}×${n}`).join(", ");
  }
  const conf = all.filter((x) => x.approach === "text" && x.situation === s && x.confidence !== null).map((x) => x.confidence!);
  row.text_conf = conf.length ? mean(conf).toFixed(2) : "-";
  return row;
}));

// A burst like 9 bots deciding in the same tick.
console.log(`\n## Burst: ${BOTS} concurrent calls (text approach), twice`);
const burst: Sample[] = [];
for (let b = 0; b < 2; b++) {
  const t0 = performance.now();
  burst.push(...await Promise.all(Array.from({ length: BOTS }, (_, i) => sample("text", SITUATIONS[i % SITUATIONS.length], { log: false }))));
  console.log(`burst ${b + 1}: all ${BOTS} answered in ${(performance.now() - t0).toFixed(0)} ms`);
}

const errors = [...all, ...burst].filter((x) => x.error);
if (errors.length) console.log("\nErrors:", [...new Set(errors.map((x) => x.error))].join(" | "));

console.log("\n## Summary");
const rows = [...APPROACHES.map((a) => summarize(a, all.filter((x) => x.approach === a))), summarize("text (burst of 9)", burst)];
console.table(rows);

const okCalls = [...all, ...burst].filter((x) => !x.error);
const perCall = mean(okCalls.map((x) => x.cost));
const spent = okCalls.reduce((a, x) => a + x.cost, 0);
console.log(`\nCalls made: ${all.length + burst.length + 5}, spent ${usd(spent)} (from usage.cost).`);
for (const r of rows.slice(0, APPROACHES.length)) {
  const cost = Number(r.cost_call.slice(1));
  console.log(`${r.approach.padEnd(6)} ${BOTS} bots × 1 decision/s: ${usd(cost * BOTS * 3600)} per hour`);
}
console.log(`average ${usd(perCall)} per call → ${usd(perCall * BOTS * 3600)} per hour for ${BOTS} bots at 1 decision/s`);

export {};
