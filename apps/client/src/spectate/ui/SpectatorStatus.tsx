// The spectator's phase line, under the top bar: a spectator has no waiting
// or result card, so this says what the game is doing between matches
// ("Waiting for players", the countdown, the warmup's timer, who won). Nothing while a match
// runs, except in a team deathmatch, where it keeps the team score
// ("Red 12 – 9 Blue"), and in a battle royale, how many are still in. It reads the game view through a selector: it re-renders when the
// line's text changes, not per frame.

import { Text } from "@astryxdesign/core/Text";
import { NO_TEAM, TEAM_NAMES, TICK_RATE, rulesOf } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import type { GameView } from "../../app.ts";
import { warmupLeft } from "../../scoreboard.ts";
import { useEngine, useSelector } from "../../ui/hooks.ts";
import { shared } from "../../ui/styles.ts";

const styles = stylex.create({
  line: {
    position: "fixed",
    top: "76px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 20,
    paddingBlock: "6px",
    paddingInline: "14px",
    fontSize: "14px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
});

function statusLine(v: GameView | null): string {
  const s = v?.snapshot;
  if (!s) return "";
  if (s.phase === "waiting") {
    if (s.countdown > 0) return `Starting in ${Math.ceil(s.countdown / TICK_RATE)}`;
    let n = 0;
    s.players.forEach(() => n++);
    const need = rulesOf(s.mode).minPlayers - n;
    return need > 0 ? `Waiting for ${need === 1 ? "one more player" : `${need} more players`}` : "Waiting for players";
  }
  // The players are on the map picking their loadout: the same timer they see.
  if (s.phase === "warmup") return `Match starts in ${warmupLeft(s)}`;
  const teamScore = `${TEAM_NAMES[0]} ${s.redScore} – ${s.blueScore} ${TEAM_NAMES[1]}`;
  if (s.mode === "tdm") {
    if (s.phase === "playing") return s.suddenDeath ? `${teamScore} · sudden death` : teamScore;
    if (s.phase === "ended")
      return s.winningTeam === NO_TEAM ? `${teamScore} · next match soon` : `${TEAM_NAMES[s.winningTeam]} team wins ${teamScore} · next match soon`;
  }
  // Battle royale: how many are still in (a knocked-out player watches from here too).
  if (s.mode === "royale" && s.phase === "playing") {
    let alive = 0;
    s.players.forEach((p) => (alive += p.alive ? 1 : 0));
    return `${alive} still in${v?.knockedOut ? " · you're out, watching" : ""}`;
  }
  if (s.phase === "ended") {
    const winner = s.winner ? s.players.get(s.winner)?.name : "";
    return winner ? `${winner} wins · next match soon` : "Match over · next match soon";
  }
  return "";
}

export function SpectatorStatus() {
  const { view } = useEngine();
  const line = useSelector(view, statusLine);
  if (!line) return null;
  return (
    <Text xstyle={[shared.hudPanel, styles.line]} role="status" data-testid="spectate-status">
      {line}
    </Text>
  );
}
