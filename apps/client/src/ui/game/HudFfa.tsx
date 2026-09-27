// The free-for-all's own HUD pieces, mounted by Hud.tsx when the HUD model
// has `ffa`: the rank panel (your place, the top three, the clock) and the
// kill feed at the top right, and the minimap at the bottom right.
//
// Like the rest of the HUD, nothing here renders per frame: the panel
// re-renders on a kill or when the clock's seconds change, the feed when a
// line comes or goes. The feed lines' fade moves every frame and is written
// to the DOM from a store subscription; the minimap canvas is drawn by the
// frame loop (minimap.ts), React only hands it over.

import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { countRender } from "../../renders.ts";
import { jsonEqual, useEngine, useSelector, useStoreEffect } from "../hooks.ts";
import { shared, slotDot, slotText } from "../styles.ts";

const styles = stylex.create({
  panel: {
    backgroundColor: "var(--bagarre-hud-panel)",
    borderRadius: "var(--radius-element)",
    paddingBlock: "8px",
    paddingInline: "10px",
  },
  rankPanel: { width: "min(230px, 40vw)", gap: "6px" },
  rank: { fontSize: "13px", fontWeight: 700 },
  rankPlace: { fontSize: "20px", marginInlineEnd: "6px" },
  time: { fontSize: "15px", fontWeight: 700, whiteSpace: "nowrap" },
  low: { color: "var(--color-text-red)" },
  sudden: { color: "var(--bagarre-gold)", fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase" },
  top: { gap: "2px" },
  topRow: {
    gap: "8px",
    paddingBlock: "2px",
    paddingInline: "6px",
    marginInline: "-6px",
    borderRadius: "4px",
    fontSize: "13px",
  },
  topYou: { backgroundColor: "rgba(255, 255, 255, 0.1)", fontWeight: 700 },
  topName: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  topKills: { fontWeight: 700 },
  feed: { gap: "4px", alignItems: "flex-end", maxWidth: "min(360px, 60vw)" },
  line: {
    gap: "8px",
    paddingBlock: "4px",
    paddingInline: "10px",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--bagarre-hud-panel)",
    fontSize: "13px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  byYou: { boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.55)" },
  onYou: { boxShadow: "inset 0 0 0 1px var(--color-border-red)", backgroundColor: "rgba(120, 24, 16, 0.55)" },
  lineName: { overflow: "hidden", textOverflow: "ellipsis", maxWidth: "14ch" },
  weapon: {
    paddingInline: "6px",
    borderRadius: "4px",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    color: "var(--color-text-secondary)",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  minimap: {
    position: "absolute",
    right: "16px",
    // Above the ability bar where the screen is too narrow for both side by side.
    bottom: { default: "16px", "@media (max-width: 1000px)": "110px" },
    width: "150px",
    height: "150px",
    borderRadius: "var(--radius-container)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--color-border)",
    backgroundColor: "var(--bagarre-hud-panel)",
  },
});

/** Your rank, the top three and the time left. */
export function FfaPanel() {
  countRender("hud.ffa");
  const { hud } = useEngine();
  const f = useSelector(
    hud,
    (m) => {
      const x = m?.ffa;
      if (!x) return null;
      return {
        rankLabel: x.rankLabel,
        players: x.players,
        kills: x.kills,
        killsToWin: x.killsToWin,
        top: x.top,
        timeLeft: x.timeLeft,
        lowTime: x.lowTime,
        suddenDeath: x.suddenDeath,
      };
    },
    jsonEqual,
  );
  if (!f) return null;
  const clock = f.suddenDeath ? "Sudden death" : f.timeLeft;
  return (
    <VStack xstyle={[styles.panel, styles.rankPanel]} data-testid="hud-ffa">
      <HStack justify="between" align="center" gap={2}>
        <Text xstyle={[styles.rank, shared.tabular]} data-testid="hud-ffa-rank" aria-label={`You are ${f.rankLabel} of ${f.players}, ${f.kills} kills`}>
          <Text as="span" xstyle={[shared.display, styles.rankPlace]} color="inherit">
            {f.rankLabel}
          </Text>
          of {f.players} · {f.kills} {f.kills === 1 ? "kill" : "kills"}
        </Text>
        {clock && (
          <Text
            xstyle={[styles.time, shared.tabular, f.lowTime && styles.low, f.suddenDeath && styles.sudden]}
            aria-label={f.suddenDeath ? "Sudden death: the next kill wins" : `Time left ${f.timeLeft}`}
            data-testid="hud-ffa-time"
            data-low={f.lowTime || undefined}
          >
            {clock}
          </Text>
        )}
      </HStack>
      <VStack as="ol" xstyle={styles.top} aria-label={`Top players, first to ${f.killsToWin}`} data-testid="hud-ffa-top">
        {f.top.map((p) => (
          <HStack as="li" key={p.id} align="center" xstyle={[styles.topRow, p.you && styles.topYou]} data-you={p.you || undefined}>
            <HStack as="span" xstyle={[shared.dot, slotDot(p.slot)]} aria-hidden="true" />
            <Text as="span" color="inherit" xstyle={styles.topName}>
              {p.you ? `${p.name} (you)` : p.name}
            </Text>
            <Text as="span" color="inherit" xstyle={[styles.topKills, shared.tabular]}>
              {p.kills}
            </Text>
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}

/** "Killer [Weapon] Victim", newest last; each line fades out on its own. */
export function KillFeed() {
  countRender("hud.killfeed");
  const { hud } = useEngine();
  // Everything but the fade: this changes only when a line comes or goes.
  const lines = useSelector(
    hud,
    (m) =>
      (m?.feed ?? []).map((l) => ({
        n: l.n,
        killer: l.killer,
        killerSlot: l.killerSlot,
        victim: l.victim,
        victimSlot: l.victimSlot,
        weapon: l.weapon,
        byYou: l.byYou,
        onYou: l.onYou,
      })),
    jsonEqual,
  );
  const box = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const el = box.current;
    if (!el || !m) return;
    for (const child of el.children) {
      if (!(child instanceof HTMLElement)) continue;
      const line = m.feed.find((l) => String(l.n) === child.dataset.n);
      const opacity = String(line ? line.opacity : 0);
      if (child.style.opacity !== opacity) child.style.opacity = opacity;
    }
  });
  if (lines.length === 0) return null;
  return (
    <VStack ref={box} xstyle={styles.feed} aria-live="polite" data-testid="hud-killfeed">
      {lines.map((l) => (
        <HStack
          key={l.n}
          align="center"
          xstyle={[styles.line, l.byYou && styles.byYou, l.onYou && styles.onYou]}
          data-n={l.n}
          data-you={l.byYou || l.onYou || undefined}
          data-testid="hud-killfeed-row"
        >
          {/* A self-kill (own grenade) reads "victim [Grenade]". */}
          {l.killer ? <FeedName name={l.killer} slot={l.killerSlot} /> : <FeedName name={l.victim} slot={l.victimSlot} />}
          <Text as="span" xstyle={styles.weapon}>
            {l.weapon}
          </Text>
          {l.killer && <FeedName name={l.victim} slot={l.victimSlot} />}
        </HStack>
      ))}
    </VStack>
  );
}

function FeedName({ name, slot }: { name: string; slot: number }) {
  return (
    <Text as="span" color="inherit" xstyle={[styles.lineName, slotText(slot)]}>
      {name}
    </Text>
  );
}

/** The minimap's canvas; minimap.ts draws into it from the frame loop. */
export function MinimapBox() {
  const { minimap } = useEngine();
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    minimap.attach(canvas.current);
    return () => minimap.attach(null);
  }, [minimap]);
  return <canvas ref={canvas} aria-label="Minimap" data-testid="hud-minimap" {...stylex.props(styles.minimap)} />;
}
