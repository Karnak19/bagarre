// A map seen from above, as a small SVG for the Maps page: the floor, the
// FFA zones (tinted), the cover (darker the taller it is), the spawns and
// the landmarks. It is turned 45° like the in-game minimap (the same
// `planProjector`), so the top of the drawing is the top of the screen when
// you play. Pure data to shapes, computed once per map.

import type { FfaMapDef, MapDef } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { memo, useMemo } from "react";
import { planProjector } from "../../minimap.ts";
import { TEAM_PAINT } from "../../paint.ts";
import { PLAYER_CSS_COLORS } from "../../scene.ts";

/** The drawing's own units: the viewBox is SIZE x SIZE, scaled by CSS. */
const SIZE = 200;

const styles = stylex.create({
  svg: { display: "block", width: "100%", height: "auto", aspectRatio: "1" },
});

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

const asFfa = (m: MapDef): FfaMapDef | null => ((m as Partial<FfaMapDef>).mode === "ffa" ? (m as FfaMapDef) : null);

/** Cover shading: the low kinds light, a 2 m container nearly black. */
const coverAlpha = (h: number) => Math.min(0.95, 0.5 + h * 0.2);

interface Shape {
  points: string;
  fill: string;
  opacity?: number;
}

interface Dot {
  x: number;
  y: number;
  fill: string;
  r: number;
}

function plan(map: MapDef) {
  const toPx = planProjector(map, SIZE, 4);
  const quad = (x0: number, z0: number, x1: number, z1: number) =>
    [toPx(x0, z0), toPx(x1, z0), toPx(x1, z1), toPx(x0, z1)].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const floor = quad(-map.halfX, -map.halfZ, map.halfX, map.halfZ);
  const ffa = asFfa(map);

  // Zones: where they overlap the first one wins, so draw them in reverse.
  const zones: Shape[] = [];
  if (ffa)
    for (let i = ffa.zones.length - 1; i >= 0; i--) {
      const z = ffa.zones[i];
      zones.push({
        points: quad(Math.max(z.x0, -map.halfX), Math.max(z.z0, -map.halfZ), Math.min(z.x1, map.halfX), Math.min(z.z1, map.halfZ)),
        fill: hex(z.tint),
        opacity: 0.3,
      });
    }

  const cover: Shape[] = map.obstacles.map((b) => ({
    points: quad(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2),
    fill: "#08090c",
    opacity: coverAlpha(b.h),
  }));

  // Spawns: a duel's first pair in the two seat colours, a team map's sides
  // in red and blue, every other spawn a faint white dot.
  const paint = new Map<number, string>();
  if (ffa?.teams)
    ffa.teams.forEach((side, t) => side.spawns.forEach((i) => paint.set(i, PLAYER_CSS_COLORS[TEAM_PAINT[t]])));
  else if (!ffa) {
    paint.set(0, PLAYER_CSS_COLORS[0]);
    paint.set(1, PLAYER_CSS_COLORS[1]);
  }
  const spawns: Dot[] = map.spawns.map((s, i) => {
    const [x, y] = toPx(s.x, s.z);
    const fill = paint.get(i);
    return { x, y, fill: fill ?? "rgba(255, 255, 255, 0.55)", r: fill ? 3 : 2.2 };
  });

  const landmarks = (ffa?.landmarks ?? []).map((l) => {
    const [x, y] = toPx(l.x, l.z);
    return { x, y, name: l.name };
  });

  return { floor, floorFill: hex(map.theme.floor), zones, cover, spawns, landmarks };
}

/** The top-down drawing of `map`. Maps are constants, so it draws once per map. */
export const MapPlan = memo(function MapPlan({ map }: { map: MapDef }) {
  const p = useMemo(() => plan(map), [map]);
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`${map.name} seen from above`}
      {...stylex.props(styles.svg)}
      data-testid={`map-plan-${map.id}`}
    >
      <polygon points={p.floor} fill={p.floorFill} opacity={0.9} />
      <polygon points={p.floor} fill="rgba(10, 11, 16, 0.45)" />
      {p.zones.map((z, i) => (
        <polygon key={`z${i}`} points={z.points} fill={z.fill} opacity={z.opacity} />
      ))}
      {p.cover.map((c, i) => (
        <polygon key={`c${i}`} points={c.points} fill={c.fill} opacity={c.opacity} />
      ))}
      <polygon points={p.floor} fill="none" stroke="rgba(255, 255, 255, 0.4)" strokeWidth={1} />
      {p.landmarks.map((l) => (
        <circle key={l.name} cx={l.x} cy={l.y} r={2} fill="rgba(255, 217, 138, 0.9)">
          <title>{l.name}</title>
        </circle>
      ))}
      {p.spawns.map((s, i) => (
        <circle key={`s${i}`} cx={s.x} cy={s.y} r={s.r} fill={s.fill} stroke="rgba(0, 0, 0, 0.6)" strokeWidth={0.8} />
      ))}
    </svg>
  );
});
