// A* on the navigation grid (grid.ts), then path smoothing: 8 neighbours, no
// corner cutting (a diagonal step needs both side cells free), a start or a
// goal on a blocked cell moved to the nearest free one. The cell path is then
// pulled tight with `segmentClear`, which keeps the body's radius off every
// box, so a smoothed segment never cuts an inflated corner.
//
// A search expands at most BOT_TUNING.astarMaxNodes cells; past that (or with
// the goal walled off) it returns the path to the cell nearest the goal, so a
// bot always has somewhere to go.

import type { Vec2 } from "../physics.ts";
import { NEIGHBOURS, cellAt, cellCentre, nearestFree, segmentClear, type NavGrid } from "./grid.ts";
import { BOT_TUNING } from "./tuning.ts";

export interface NavPath {
  /** Waypoints to walk through in order, the start excluded, the goal (or the nearest reachable point) last. */
  points: Vec2[];
  /** False: the goal wasn't reached (no way there, or the node cap): `points` ends as close as the search got. */
  complete: boolean;
}

/** Octile distance between two cells, in cells. */
function octile(grid: NavGrid, a: number, b: number): number {
  const ai = a % grid.cols;
  const bi = b % grid.cols;
  const dx = Math.abs(ai - bi);
  const dz = Math.abs((a - ai) / grid.cols - (b - bi) / grid.cols);
  return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
}

/**
 * The cells of the cheapest path from cell `start` to cell `goal` (both
 * free), start and end included, or the path to the closest cell found when
 * the goal can't be reached within `maxNodes` expansions.
 */
export function astarCells(grid: NavGrid, start: number, goal: number, maxNodes: number = BOT_TUNING.astarMaxNodes): { cells: number[]; complete: boolean } {
  const { cols, rows, blocked, g, parent, seen, closed, heap } = grid;
  const search = ++grid.search;
  heap.clear();
  seen[start] = search;
  g[start] = 0;
  parent[start] = -1;
  heap.push(start, octile(grid, start, goal));
  let best = start;
  let bestH = octile(grid, start, goal);
  let expanded = 0;
  let found = false;
  while (heap.size > 0) {
    const c = heap.pop();
    if (closed[c] === search) continue;
    closed[c] = search;
    if (c === goal) {
      found = true;
      break;
    }
    const h = octile(grid, c, goal);
    if (h < bestH) {
      bestH = h;
      best = c;
    }
    if (++expanded > maxNodes) break;
    const ci = c % cols;
    const cj = (c - ci) / cols;
    for (const [di, dj, cost] of NEIGHBOURS) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= cols || j >= rows) continue;
      const n = j * cols + i;
      if (blocked[n] || closed[n] === search) continue;
      // No corner cutting: a diagonal needs both cells beside it free.
      if (di !== 0 && dj !== 0 && (blocked[cj * cols + i] || blocked[j * cols + ci])) continue;
      const ng = g[c] + cost;
      if (seen[n] === search && ng >= g[n]) continue;
      seen[n] = search;
      g[n] = ng;
      parent[n] = c;
      heap.push(n, ng + octile(grid, n, goal));
    }
  }
  const end = found ? goal : best;
  const cells: number[] = [];
  for (let c = end; c !== -1; c = parent[c]) cells.push(c);
  cells.reverse();
  return { cells, complete: found };
}

/**
 * Pulls a polyline tight: from each kept point, skips to the farthest later
 * point it reaches in a straight, clear line (`segmentClear`). The first
 * point is always kept.
 */
export function smoothPath(grid: NavGrid, pts: readonly Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const out: Vec2[] = [pts[0]];
  let anchor = pts[0];
  for (let k = 1; k < pts.length - 1; k++) {
    if (!segmentClear(grid, anchor, pts[k + 1])) {
      out.push(pts[k]);
      anchor = pts[k];
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * A walkable path from `from` to `to` (world points), smoothed. Null when no
 * free cell is near the start (a body can't be there). A goal on a blocked
 * cell (in cover, against a wall) is moved to the nearest free cell; one
 * with no free cell near is aimed at as close as the search gets.
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2, maxNodes: number = BOT_TUNING.astarMaxNodes): NavPath | null {
  const start = nearestFree(grid, cellAt(grid, from.x, from.z));
  if (start < 0) return null;
  const rawGoal = cellAt(grid, to.x, to.z);
  let goal = nearestFree(grid, rawGoal);
  const goalSnapped = goal !== rawGoal;
  const goalFound = goal >= 0;
  if (!goalFound) goal = start;
  const { cells, complete } = astarCells(grid, start, goal, maxNodes);
  const pts: Vec2[] = [from];
  for (const c of cells) pts.push(cellCentre(grid, c));
  // The exact goal point when it's free and in reach from its cell's centre.
  if (complete && !goalSnapped && segmentClear(grid, pts[pts.length - 1], to)) pts.push({ x: to.x, z: to.z });
  const smooth = smoothPath(grid, pts);
  smooth.shift();
  if (smooth.length === 0) smooth.push(cellCentre(grid, start));
  return { points: smooth, complete: complete && goalFound };
}
