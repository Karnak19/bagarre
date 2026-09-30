// The battle royale's own HUD pieces, mounted by Hud.tsx when the HUD model
// has `royale`: the panel at the top right (players still in, the zone's
// timer), the arrow back to the zone while we stand outside it, and the three
// gun slots in place of the single weapon box.
//
// Like the rest of the HUD, nothing renders per frame: the panel re-renders
// when the count or the timer's seconds change, the slots on a switch, a shot
// or a pickup, and the arrow's angle is written to the DOM from a store
// subscription.

import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { ticks, weaponDef } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import { countRender } from "../../renders.ts";
import { jsonEqual, useEngine, useSelector, useStoreEffect } from "../hooks.ts";
import { shared } from "../styles.ts";

const styles = stylex.create({
  panel: {
    backgroundColor: "var(--bagarre-hud-panel)",
    borderRadius: "var(--radius-element)",
    paddingBlock: "8px",
    paddingInline: "10px",
  },
  royalePanel: { width: "min(230px, 40vw)", gap: "4px" },
  alive: { fontSize: "13px", fontWeight: 700 },
  aliveCount: { fontSize: "20px", marginInlineEnd: "6px" },
  zone: { fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary)" },
  zoneTime: { color: "var(--color-text-primary)", fontWeight: 700 },
  zoneClosing: { color: "#9fd8ff" },
  arrow: {
    position: "absolute",
    top: "118px",
    left: "50%",
    transform: "translateX(-50%)",
    paddingBlock: "6px",
    paddingInline: "12px",
    borderRadius: "6px",
    backgroundColor: "rgba(120, 24, 16, 0.7)",
    boxShadow: "inset 0 0 0 1px var(--color-border-red)",
    fontSize: "14px",
    fontWeight: 700,
  },
  arrowGlyph: { display: "inline-block", fontSize: "18px", lineHeight: 1 },
  slot: { minWidth: "96px", paddingInline: "10px", opacity: 0.6 },
  slotHand: { opacity: 1, boxShadow: "inset 0 0 0 2px var(--bagarre-gold)" },
  slotEmpty: { opacity: 0.3 },
  key: { fontSize: "11px", opacity: 0.7 },
  slotName: { fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" },
  slotAmmo: { fontSize: "18px", fontWeight: 700 },
  reload: { height: "4px", marginBlockStart: "3px", borderRadius: "2px", overflow: "hidden", backgroundColor: "rgba(255, 255, 255, 0.12)" },
  reloadFill: { height: "100%", width: 0, backgroundColor: "var(--bagarre-gold)" },
});

/** Players still in and the zone's timer, at the top right. */
export function RoyalePanel() {
  countRender("hud.royale");
  const { hud } = useEngine();
  const r = useSelector(
    hud,
    (m) => {
      const x = m?.royale;
      return x ? { alive: x.alive, players: x.players, zone: x.zone, zoneTime: x.zoneTime } : null;
    },
    jsonEqual,
  );
  if (!r) return null;
  const zoneLine =
    r.zone === "waiting" ? "Zone shrinks in" : r.zone === "shrinking" ? "Zone closes in" : r.zone === "closed" ? "Zone closed" : "";
  return (
    <VStack xstyle={[styles.panel, styles.royalePanel]} data-testid="hud-royale" data-alive={r.alive} data-zone={r.zone}>
      <Text xstyle={[styles.alive, shared.tabular]} data-testid="hud-royale-alive" aria-label={`${r.alive} of ${r.players} still in`}>
        <Text as="span" xstyle={[shared.display, styles.aliveCount]} color="inherit">
          {r.alive}
        </Text>{" "}
        of {r.players} still in
      </Text>
      {zoneLine && (
        <Text xstyle={[styles.zone, shared.tabular]} data-testid="hud-zone-time">
          {zoneLine}{" "}
          {r.zoneTime && (
            <Text as="span" color="inherit" xstyle={[styles.zoneTime, r.zone === "shrinking" && styles.zoneClosing]}>
              {r.zoneTime}
            </Text>
          )}
        </Text>
      )}
    </VStack>
  );
}

/** Outside the zone: a warning with an arrow toward its centre (turned per frame, off React). */
export function ZoneArrow() {
  countRender("hud.zoneArrow");
  const { hud } = useEngine();
  const outside = useSelector(hud, (m) => !!m?.royale?.outside);
  const glyph = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const t = `rotate(${Math.round(m?.royale?.arrow ?? 0)}deg)`;
    if (glyph.current && glyph.current.style.transform !== t) glyph.current.style.transform = t;
  });
  if (!outside) return null;
  return (
    <HStack gap={2} align="center" xstyle={styles.arrow} role="alert" data-testid="hud-zone-arrow">
      <Text as="span" ref={glyph} color="inherit" xstyle={styles.arrowGlyph} aria-hidden>
        ➜
      </Text>
      <Text as="span" color="inherit">
        Outside the zone: get back in
      </Text>
    </HStack>
  );
}

/** The three gun slots (keys 1-3, the wheel), the one in hand outlined, each with its own magazine. */
export function GunSlots() {
  countRender("hud.slots");
  const { hud } = useEngine();
  const slots = useSelector(hud, (m) => m?.royale?.slots ?? [], jsonEqual);
  const fill = useRef<HTMLElement>(null);
  // The reload bar of the gun in hand moves every tick: written here.
  useStoreEffect(hud, (m) => {
    const s = m?.sim;
    const hand = m?.royale?.slots.find((x) => x.hand);
    const frac = s && hand && hand.weapon >= 0 && s.reloadTicks > 0 ? 1 - s.reloadTicks / ticks(weaponDef(hand.weapon).reloadTime) : 0;
    const width = `${frac * 100}%`;
    if (fill.current && fill.current.style.width !== width) fill.current.style.width = width;
  });
  return (
    <HStack gap={2} align="stretch" data-testid="hud-slots">
      {slots.map((s, i) => (
        <VStack
          key={i}
          xstyle={[styles.panel, styles.slot, s.hand && styles.slotHand, s.weapon < 0 && styles.slotEmpty]}
          data-testid={`hud-slot-${i + 1}`}
          data-weapon={s.weapon >= 0 ? weaponDef(s.weapon).key : undefined}
          data-active={s.hand ? "" : undefined}
          data-ammo={s.weapon >= 0 ? s.ammo : undefined}
        >
          <Text xstyle={styles.key}>{i + 1}</Text>
          <Text xstyle={styles.slotName}>{s.weapon >= 0 ? s.name : "Empty"}</Text>
          <Text xstyle={[styles.slotAmmo, shared.tabular]} data-testid={s.hand ? "hud-ammo" : undefined}>
            {s.weapon < 0 ? "–" : s.reloading ? "Reloading" : `${s.ammo} / ${s.magazine}`}
          </Text>
          {s.hand && (
            <VStack xstyle={styles.reload}>
              <VStack ref={fill} xstyle={styles.reloadFill} />
            </VStack>
          )}
        </VStack>
      ))}
    </HStack>
  );
}
