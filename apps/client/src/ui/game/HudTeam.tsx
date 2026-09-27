// The team deathmatch's own HUD piece, mounted by Hud.tsx when the HUD model
// has `team`: the team score ("RED 12 – 9 BLUE"), the time left, and our own
// team marked. The kill feed and the minimap are the FFA ones (HudFfa.tsx),
// in team colours. Like the rest of the HUD it re-renders on a kill or when
// the clock's seconds change, never per frame.

import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { TEAM_BLUE, TEAM_NAMES, TEAM_RED } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { TEAM_PAINT } from "../../paint.ts";
import { countRender } from "../../renders.ts";
import { jsonEqual, useEngine, useSelector } from "../hooks.ts";
import { shared, slotText } from "../styles.ts";

const styles = stylex.create({
  panel: {
    backgroundColor: "var(--bagarre-hud-panel)",
    borderRadius: "var(--radius-element)",
    paddingBlock: "8px",
    paddingInline: "12px",
    gap: "4px",
    alignItems: "center",
    minWidth: "min(230px, 40vw)",
  },
  score: { gap: "10px", alignItems: "baseline", whiteSpace: "nowrap" },
  team: { fontSize: "13px", letterSpacing: "0.08em" },
  points: { fontSize: "24px", fontWeight: 800 },
  dash: { fontSize: "18px", color: "var(--color-text-secondary)" },
  ours: {
    paddingInline: "6px",
    borderRadius: "4px",
    boxShadow: "inset 0 0 0 1px currentColor",
  },
  line: { gap: "8px", fontSize: "12px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" },
  time: { fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" },
  low: { color: "var(--color-text-red)" },
  sudden: { color: "var(--bagarre-gold)", letterSpacing: "0.06em", textTransform: "uppercase" },
});

/** "RED 12 – 9 BLUE", the clock, and which side we're on. */
export function TeamPanel() {
  countRender("hud.team");
  const { hud } = useEngine();
  const t = useSelector(hud, (m) => m?.team ?? null, jsonEqual);
  if (!t) return null;
  const yours = t.you === TEAM_RED || t.you === TEAM_BLUE ? TEAM_NAMES[t.you] : "";
  return (
    <VStack
      xstyle={styles.panel}
      data-testid="hud-team"
      data-red={t.red}
      data-blue={t.blue}
      data-you={t.you}
      aria-label={`Red ${t.red}, blue ${t.blue}, first to ${t.killsToWin}${yours ? `. You are on ${yours}` : ""}`}
    >
      <HStack align="center" gap={2} data-testid="hud-team-score">
        <Side team={TEAM_RED} points={t.red} ours={t.you === TEAM_RED} />
        <Text as="span" xstyle={styles.dash}>
          –
        </Text>
        <Side team={TEAM_BLUE} points={t.blue} ours={t.you === TEAM_BLUE} />
      </HStack>
      <HStack xstyle={styles.line} align="center">
        {yours && (
          <Text as="span" color="inherit" data-testid="hud-team-you">
            You're on <Text as="span" color="inherit" weight="bold" xstyle={slotText(TEAM_PAINT[t.you])}>{yours}</Text>
          </Text>
        )}
        <Text as="span" color="inherit">
          First to {t.killsToWin}
        </Text>
        {(t.suddenDeath || t.timeLeft) && (
          <Text
            as="span"
            xstyle={[styles.time, shared.tabular, t.lowTime && styles.low, t.suddenDeath && styles.sudden]}
            data-testid="hud-team-time"
            aria-label={t.suddenDeath ? "Sudden death: the next team kill wins" : `Time left ${t.timeLeft}`}
          >
            {t.suddenDeath ? "Sudden death" : t.timeLeft}
          </Text>
        )}
      </HStack>
    </VStack>
  );
}

/** One team's half of the score: "RED 12" on the left, "9 BLUE" on the right (the numbers meet at the dash). */
function Side({ team, points, ours }: { team: number; points: number; ours: boolean }) {
  const name = (
    <Text as="span" color="inherit" xstyle={[shared.display, styles.team]}>
      {TEAM_NAMES[team]}
    </Text>
  );
  const score = (
    <Text as="span" color="inherit" xstyle={[styles.points, shared.tabular]} data-testid={team === TEAM_RED ? "hud-team-red" : "hud-team-blue"}>
      {points}
    </Text>
  );
  return (
    <HStack as="span" xstyle={[styles.score, ours && styles.ours, slotText(TEAM_PAINT[team])]} data-ours={ours || undefined}>
      {team === TEAM_RED ? name : score}
      {team === TEAM_RED ? score : name}
    </HStack>
  );
}
