// The battle royale's own HUD pieces, mounted by Hud.tsx when the HUD model
// has `royale`: the panel under the minimap (players still in, the zone's
// timer), the arrow back to the zone while we stand outside it, the three
// gun slots in place of the single weapon box, the healing items (keys 4
// and 5) under them, and in the alert slot under the character (Hud.tsx'
// Alert) the heal's progress, or how it ended (above all when the zone's
// damage cancelled it), or the F prompt ("F  Open chest", "F  Swap Pistol →
// Rifle", "F  Swap Frag → Smoke", "F  Swap ⏩ Double dash → 🔋 Bigger mag")
// while F would do something, and the loot feed over our bar at the bottom
// left (what we just picked up: "+ Rifle", "+ 2 💥 Frag", "Pistol → Rifle",
// "+ ⏩ Double dash").
//
// Like the rest of the HUD, nothing renders per frame: the panel re-renders
// when the count or the timer's seconds change, the slots on a switch, a shot
// or a pickup, and the arrow's angle is written to the DOM from a store
// subscription.

import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { HEAL_ITEMS, healProgress, reloadTicksOf, weaponDef } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import { countRender } from "../../renders.ts";
import type { RoyaleHud } from "../../hud.ts";
import { jsonEqual, useEngine, useSelector, useStoreEffect } from "../hooks.ts";
import { shared } from "../styles.ts";

const styles = stylex.create({
  royalePanel: { gap: "4px" },
  alive: { fontSize: "13px", fontWeight: 700 },
  aliveCount: { fontSize: "20px", marginInlineEnd: "6px" },
  zone: { fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary)" },
  zoneTime: { color: "var(--color-text-primary)", fontWeight: 700 },
  zoneClosing: { color: "#9fd8ff" },
  arrow: {
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
  heal: { minWidth: "74px", paddingInline: "10px", textAlign: "center" },
  healNone: { opacity: 0.4 },
  healOn: { boxShadow: "inset 0 0 0 2px #6dff9a" },
  healFill: { height: "100%", width: 0, backgroundColor: "#6dff9a" },
  healStatus: {
    minWidth: "200px",
    textAlign: "center",
    fontSize: "13px",
    fontWeight: 600,
  },
  healing: { color: "#6dff9a", boxShadow: "inset 0 0 0 1px rgba(109, 255, 154, 0.6)" },
  healDone: { color: "#6dff9a" },
  healCancel: { color: "#ffb4a6", boxShadow: "inset 0 0 0 1px var(--color-border-red)" },
  healZone: { color: "#ffffff", backgroundColor: "rgba(120, 24, 16, 0.8)", boxShadow: "inset 0 0 0 1px var(--color-border-red)" },
  swap: {
    paddingBlock: "3px",
    paddingInline: "8px",
    whiteSpace: "nowrap",
    fontSize: "13px",
    fontWeight: 600,
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: { default: "120ms", "@media (prefers-reduced-motion: reduce)": "0s" },
    transitionTimingFunction: "ease-out",
  },
  swapOn: { opacity: 1 },
  swapFrom: { color: "var(--color-text-secondary)" },
  swapTo: { color: "var(--bagarre-gold)" },
  // Over our bar, newest at the bottom.
  loot: { gap: "4px", alignItems: "flex-start", maxWidth: "min(260px, 100%)" },
  // The kill feed's line (HudFfa.tsx), a little smaller.
  lootLine: {
    gap: "6px",
    paddingBlock: "3px",
    paddingInline: "8px",
    borderRadius: "var(--radius-element)",
    backgroundColor: "var(--bagarre-hud-panel)",
    fontSize: "13px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  lootGun: { color: "var(--bagarre-gold)" },
  lootHeal: { color: "#6dff9a" },
  lootShield: { color: "#9fe6ff" },
  lootPerk: { color: "#e0b4ff" },
});

/** Players still in and the zone's timer, under the minimap. */
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
    <VStack xstyle={[shared.hudBox, styles.royalePanel]} data-testid="hud-royale" data-alive={r.alive} data-zone={r.zone}>
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
    const frac = s && hand && hand.weapon >= 0 && s.reloadTicks > 0 ? 1 - s.reloadTicks / reloadTicksOf(weaponDef(hand.weapon), s.perk) : 0;
    const width = `${frac * 100}%`;
    if (fill.current && fill.current.style.width !== width) fill.current.style.width = width;
  });
  return (
    <HStack gap={2} align="stretch" data-testid="hud-slots">
      {slots.map((s, i) => (
        <VStack
          key={i}
          xstyle={[shared.hudBox, styles.slot, s.hand && styles.slotHand, s.weapon < 0 && styles.slotEmpty]}
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

/** The healing items (4 the bandage, 5 the medkit), each with its count; the one in use outlined. */
export function HealItems() {
  countRender("hud.heals");
  const { hud } = useEngine();
  const r = useSelector(hud, (m) => (m?.royale ? { heals: m.royale.heals, healing: m.royale.healing } : null), jsonEqual);
  if (!r) return null;
  return (
    <HStack gap={2} align="stretch" data-testid="hud-heals">
      {r.heals.map((h, i) => (
        <VStack
          key={h.key}
          xstyle={[shared.hudBox, styles.heal, h.count === 0 && styles.healNone, r.healing === i && styles.healOn]}
          data-testid={`hud-heal-${h.key}`}
          data-count={h.count}
          data-active={r.healing === i ? "" : undefined}
        >
          <Text xstyle={styles.key}>{i + 4}</Text>
          <Text xstyle={styles.slotName}>{h.name}</Text>
          <Text xstyle={[styles.slotAmmo, shared.tabular]}>
            {h.count}
            <Text as="span" color="inherit" xstyle={styles.key}>
              {" "}
              / {h.max}
            </Text>
          </Text>
        </VStack>
      ))}
    </HStack>
  );
}

/**
 * In the alert slot: the heal in progress (the item, "slowed", a bar that
 * fills, written per frame), or for a few seconds after, how it ended. A heal
 * cancelled by the zone gets the zone's red, so it is clear why it stopped.
 */
export function HealStatus() {
  countRender("hud.healStatus");
  const { hud } = useEngine();
  const r = useSelector(hud, (m) => (m?.royale ? { healing: m.royale.healing, note: m.royale.healNote, kind: m.royale.stopKind } : null), jsonEqual);
  const bar = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const kit = m?.sim?.kit;
    const width = `${kit ? healProgress(kit) * 100 : 0}%`;
    if (bar.current && bar.current.style.width !== width) bar.current.style.width = width;
  });
  if (!r) return null;
  if (r.healing >= 0) {
    const def = HEAL_ITEMS[r.healing];
    return (
      <VStack xstyle={[shared.hudBox, styles.healStatus, styles.healing]} role="status" data-testid="hud-heal-status" data-state="healing">
        <Text color="inherit">✚ {def?.name ?? "Healing"} · slowed, don't shoot</Text>
        <VStack xstyle={styles.reload}>
          <VStack ref={bar} xstyle={styles.healFill} />
        </VStack>
      </VStack>
    );
  }
  if (!r.note) return null;
  const look = r.kind === "done" ? styles.healDone : r.kind === "zone" ? styles.healZone : styles.healCancel;
  return (
    <VStack xstyle={[shared.hudBox, styles.healStatus, look]} role="status" data-testid="hud-heal-status" data-state={r.kind}>
      <Text color="inherit">{r.note}</Text>
    </VStack>
  );
}

/**
 * While F would do something: the key and what it does, from the HUD
 * model's `prompt` (the same pick as the server's, fTarget): "F  Open chest",
 * or the gun in hand / grenades held / perk held and what F takes instead
 * ("F  Swap Pistol → Rifle"). Re-renders only when that changes. Always mounted, faded
 * in and out (opacity only); it keeps the last text while it fades out.
 * `data-state` "on" / "off" and `data-kind` for the tests.
 */
export function SwapPrompt() {
  countRender("hud.swap");
  const { hud } = useEngine();
  const prompt = useSelector(hud, (m) => m?.royale?.prompt ?? null, jsonEqual);
  const last = useRef<RoyaleHud["prompt"]>(null);
  if (prompt) last.current = prompt;
  const shown = prompt ?? last.current;
  return (
    <HStack
      gap={1.5}
      align="center"
      xstyle={[shared.hudBox, styles.swap, !!prompt && styles.swapOn]}
      data-testid="hud-swap"
      data-state={prompt ? "on" : "off"}
      data-kind={prompt?.kind}
      data-from={prompt && prompt.kind !== "chest" ? prompt.from : undefined}
      data-to={prompt && prompt.kind !== "chest" ? prompt.to : undefined}
      aria-hidden={!prompt}
    >
      <Kbd keys="F" />
      {shown?.kind === "chest" ? (
        <Text as="span" color="inherit" xstyle={styles.swapTo}>
          Open chest
        </Text>
      ) : (
        <Text as="span" color="inherit">
          Swap{" "}
          <Text as="span" color="inherit" xstyle={styles.swapFrom}>
            {shown?.fromName ?? ""}
          </Text>{" "}
          →{" "}
          <Text as="span" color="inherit" xstyle={styles.swapTo}>
            {shown?.toName ?? ""}
          </Text>
        </Text>
      )}
    </HStack>
  );
}

const LOOT_COLOR = { gun: styles.lootGun, grenade: styles.lootGun, heal: styles.lootHeal, shield: styles.lootShield, perk: styles.lootPerk };

/**
 * The loot feed: our last few pickups and F swaps, a line each ("+ Rifle",
 * "+ 2 💥 Frag", "Pistol → Rifle"), each gone after a few seconds (match.ts'
 * lootLines). Like the kill feed, it re-renders only when a line comes or
 * goes; the fade is written per frame, off React. `data-kind`, `data-key`
 * and `data-from` for the tests.
 */
export function LootFeed() {
  countRender("hud.loot");
  const { hud } = useEngine();
  const lines = useSelector(hud, (m) => (m?.royale?.loot ?? []).map((l) => ({ n: l.n, kind: l.kind, key: l.key, to: l.to, from: l.from })), jsonEqual);
  const box = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const el = box.current;
    if (!el || !m?.royale) return;
    for (const child of el.children) {
      if (!(child instanceof HTMLElement)) continue;
      const line = m.royale.loot.find((l) => String(l.n) === child.dataset.n);
      const opacity = String(line ? line.opacity : 0);
      if (child.style.opacity !== opacity) child.style.opacity = opacity;
    }
  });
  if (lines.length === 0) return null;
  return (
    <VStack ref={box} xstyle={styles.loot} aria-live="polite" data-testid="hud-loot">
      {lines.map((l) => (
        <HStack
          key={l.n}
          align="center"
          xstyle={styles.lootLine}
          data-n={l.n}
          data-kind={l.kind}
          data-key={l.key}
          data-from={l.from || undefined}
          data-testid="hud-loot-row"
        >
          {l.from ? (
            <>
              <Text as="span" color="inherit" xstyle={styles.swapFrom}>
                {l.from}
              </Text>
              <Text as="span" color="inherit">
                →
              </Text>
            </>
          ) : (
            <Text as="span" color="inherit">
              +
            </Text>
          )}
          <Text as="span" color="inherit" xstyle={LOOT_COLOR[l.kind]}>
            {l.to}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}
