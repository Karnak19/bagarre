// Every tuning number of the bots, in one place like the weapons table
// (constants.ts). Times are in seconds (turned into ticks with `ticks()`
// where they are used), distances in metres, angles in radians. One
// difficulty level (#48): beatable by an average player.

export const BOT_TUNING = {
  // --- Seeing ---
  /**
   * How far a bot sees an enemy, about what a player sees on screen: the
   * royale camera shows ~26 m of view height (match.ts FOLLOW_VIEW_HEIGHT),
   * which is ~45 m of ground across at the iso angle, so ~22 m from the
   * centre to an edge.
   */
  sightRange: 22,
  /** Chests and floor items listed in the view: within this distance, the nearest few. */
  lootRange: 20,
  /** At most this many chests, and this many items, in a view (the nearest). */
  maxListed: 6,

  // --- Deciding (the rule brain) ---
  /** Seconds between two decisions of one bot (the server staggers them). */
  decideEvery: 1,
  /** The zone counts as "about to close over the bot" if it would be outside this many seconds from now. */
  zoneLookahead: 6,
  /** ...or if it is closer than this to the zone's edge while the zone shrinks. */
  zoneEdgeMargin: 3,
  /** Heal below this HP (and out of sight, with an item). */
  healBelow: 70,
  /** A medkit rather than a bandage below this HP (when both are carried). */
  medkitBelow: 45,
  /** An enemy is "in range" up to this share of the gun's bullet range. */
  fightRangeScale: 1.1,
  /** Any wanted item or chest this close is worth a detour even with a good kit. */
  lootNear: 8,
  /** Goal scores: the highest wins. */
  score: {
    escapeOutside: 100,
    escapeSoon: 80,
    heal: 70,
    fight: 60,
    /** An enemy in sight but out of the gun's range. */
    fightFar: 30,
    lootWeak: 50,
    lootNear: 35,
    roam: 10,
  },

  // --- Moving ---
  /** Navigation grid cell side. */
  cell: 0.5,
  /** Obstacles are inflated by PLAYER_RADIUS plus this, in the grid. */
  gridMargin: 0.1,
  /** A smoothed path segment keeps PLAYER_RADIUS plus this from every box. */
  smoothMargin: 0.05,
  /** Nodes one A* search expands at most (past it: the best partial path). */
  astarMaxNodes: 16000,
  /** Cells round a blocked start or goal searched for a free one. */
  snapRadiusCells: 8,
  /** Seconds between two replans of one bot, at the least (a stuck bot replans at once). */
  replanEvery: 0.5,
  /** A waypoint is reached this close. */
  waypointReach: 0.35,
  /** Replan when the destination moved more than this. */
  replanMoved: 1.5,
  /** No progress (moving less than `stuckDist`) for this long while trying to move: stuck. */
  stuckTime: 1,
  stuckDist: 0.6,
  /** A stuck bot sidesteps in a random direction for this long, then replans. */
  sidestepTime: 0.35,
  /** Roam: a new waypoint, inside this share of the zone's radius round its centre. */
  roamSpread: 0.6,
  /** Roam: a waypoint is dropped once this close, or after this long. */
  roamReach: 2,
  roamTimeout: 20,

  // --- Fighting ---
  /** Seconds between first seeing a target and the first shot at it. */
  reaction: 0.35,
  /** A target out of sight longer than this needs a new reaction when it shows again. */
  forget: 1,
  /** Aim error: uniform in [-aimSpread, aimSpread], drawn again every `aimJitter` seconds. */
  aimSpread: 0.09,
  aimJitter: 0.2,
  /** Preferred distance to the target: this share of the gun's range, give or take `rangeBand`. */
  preferredRange: 0.6,
  rangeBand: 1.5,
  /** Strafe: sideways speed share, and how long one direction lasts (min, max). */
  strafe: 0.7,
  strafeTime: [0.6, 1.4] as const,
  /** Raise a shield charge in a fight below this HP. */
  shieldBelow: 55,

  // --- Looting ---
  /** Press F on a chest this much inside ROYALE.openRadius. */
  openInset: 0.3,
  /** Seconds between two F presses. */
  pressGap: 0.4,
} as const;
