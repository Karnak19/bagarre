// The in-game HUD: both players' HP (and perks), the score, the status line, the map
// card, the weapon and ammo, the ability cooldowns, the sound toggle, the
// weapon picker line and the netcode debug line. In a free-for-all the score
// and the opponent's bar give way to the rank panel, the kill feed and the
// minimap (HudFfa.tsx); in a team deathmatch to the team score (HudTeam.tsx),
// the same kill feed and minimap, in team colours; in a battle royale to
// the players still in and the zone's timer, and the weapon box to the three
// gun slots, plus the loot feed (HudRoyale.tsx).
//
// The layout is one grid over the screen, so nothing sits on hand-tuned
// offsets and the boxes stack on their own: world info at the top (the
// minimap and the mode's panel at the left, the score, status and map card in
// the middle, the kill feed or the opponent at the right), your own state at
// the bottom (you and your abilities at the left, your guns and heals at the
// right), and the warmup panel or the picker centred just above it. The one
// thing placed by hand is the alert slot (Alert) under the character, which the
// camera keeps at the centre of the screen (scene.follow).
//
// match.ts writes a HudModel every frame (hud.ts). Nothing here re-renders
// per frame: each widget selects the few fields it shows and re-renders only
// when they change (a hit, a kill, a shot, a cooldown starting or ending).
// What moves continuously (the cooldown sweeps and timers, the reload bar,
// the map card's fade, the debug line) is written to its DOM node from a
// store subscription (useStoreEffect), outside React.

import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import {
  GRENADES,
  KILLS_TO_WIN,
  MAX_HP,
  MELEE_COOLDOWN_TICKS,
  NO_PERK,
  SHIELD,
  SHIELD_CHARGE_TICKS,
  SHIELD_COOLDOWN_TICKS,
  STUN_TICKS,
  TICK_RATE,
  WEAPONS,
  dashTimer,
  dashWindowTicks,
  dashesReady,
  grenadeCooldownTicks,
  grenadeDef,
  magazineOf,
  perkDef,
  reloadTicksOf,
  weaponDef,
} from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useRef } from "react";
import type { HudModel } from "../../hud.ts";
import { countRender } from "../../renders.ts";
import { paintOf } from "../../paint.ts";
import { shallowEqual, useEngine, useSelector, useStoreEffect } from "../hooks.ts";
import { shared, slotFill } from "../styles.ts";
import { FfaPanel, KillFeed, MinimapBox } from "./HudFfa.tsx";
import { GunSlots, HealItems, HealStatus, LootFeed, RoyalePanel, SwapPrompt, ZoneArrow } from "./HudRoyale.tsx";
import { TeamPanel } from "./HudTeam.tsx";
import { PICKABLE_WEAPONS, WEAPON_KEYS, grenadeView, perkLabel, perkView } from "../../items.ts";
import { GrenadePicker, PerkPicker, WeaponPicker } from "./WeaponPicker.tsx";

const styles = stylex.create({
  // Four rows: the top edge, the open middle (the game), the centred panel
  // (warmup or picker) and the bottom edge.
  root: {
    position: "fixed",
    inset: 0,
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto auto",
    rowGap: "12px",
    padding: "16px",
    pointerEvents: "none",
    zIndex: 10,
  },
  // The top edge: left and right corners as wide as each other, so the middle stays centred.
  top: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", columnGap: "12px", alignItems: "start" },
  // The minimap and the mode's panel under it, one width (smaller on a short screen).
  topLeft: { width: "clamp(190px, 26vh, 230px)", maxWidth: "100%", justifySelf: "start" },
  topCentre: { minWidth: 0, maxWidth: "min(520px, 44vw)" },
  topRight: { minWidth: 0, justifySelf: "end" },
  dock: { gridRow: "3", justifySelf: "center", minWidth: 0, maxWidth: "100%" },
  // The bottom edge: you at the left (taking what's left), your gear at the right.
  bottom: { gridRow: "4", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "12px" },
  bottomLeft: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  // Your bar and the abilities side by side; on a narrow screen the abilities go up a line, over the bar.
  you: { display: "flex", flexWrap: "wrap-reverse", alignItems: "flex-start", gap: "8px" },
  bottomRight: { flexShrink: 0 },
  // Just under the character (the camera keeps it at the centre of the screen).
  alert: {
    position: "absolute",
    top: "calc(50% + max(40px, 6vh))",
    left: "50%",
    transform: "translateX(-50%)",
    display: "grid",
    justifyItems: "center",
  },
  // Every alert in the same cell: one shows, the fading swap prompt over what follows it.
  alertItem: { gridArea: "1 / 1" },
  alertHidden: { display: "none" },
  player: { width: "min(320px, 38vw)" },
  me: { width: "min(340px, calc(100vw - 32px))" },
  right: { textAlign: "end" },
  absent: { opacity: 0.35 },
  nameLine: { gap: "8px", marginBlockEnd: "6px" },
  name: { fontSize: "13px", fontWeight: 600, opacity: 0.9, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  // The perk glyph after the opponent's name.
  namePerk: { marginInlineStart: "6px" },
  // Your perk: a small badge after your name, its name and what it does on hover.
  perkBadge: {
    flexShrink: 0,
    paddingInline: "6px",
    borderRadius: "4px",
    fontSize: "13px",
    lineHeight: "18px",
    boxShadow: "inset 0 0 0 1px rgba(224, 180, 255, 0.55)",
    backgroundColor: "rgba(224, 180, 255, 0.12)",
    pointerEvents: "auto",
    cursor: "help",
  },
  hp: { height: "10px", borderRadius: "5px", overflow: "hidden", backgroundColor: "rgba(255, 255, 255, 0.12)" },
  hpMine: { height: "14px", borderRadius: "7px", flexGrow: 1 },
  hpRight: { transform: "scaleX(-1)" },
  hpValue: { minWidth: "3ch", fontSize: "18px", fontWeight: 800, lineHeight: 1, textAlign: "end" },
  // Scaled, not resized: the HP change animates on the compositor.
  hpFill: { height: "100%", width: "100%", transformOrigin: "left center", transition: "transform 120ms linear" },
  // The shield bubble's strength left, a thin bar under the HP; empty (and dim) with no bubble up.
  shieldBar: { height: "4px", marginBlockStart: "4px", borderRadius: "2px", overflow: "hidden", backgroundColor: "rgba(159, 230, 255, 0.12)" },
  shieldFill: { height: "100%", width: "100%", transformOrigin: "left center", backgroundColor: "#9fe6ff", transition: "transform 120ms linear" },
  score: { paddingInline: "16px", fontSize: "22px", fontWeight: 700, whiteSpace: "nowrap" },
  status: { paddingBlock: "6px", paddingInline: "14px", fontSize: "14px", textAlign: "center" },
  mapCard: {
    maxWidth: "100%",
    textAlign: "center",
    padding: "12px 24px",
    borderRadius: "10px",
    animationName: {
      default: stylex.keyframes({ from: { opacity: 0, transform: "translateY(-6px)" } }),
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "0.3s",
    animationTimingFunction: "ease",
    animationFillMode: "backwards",
  },
  mapTitle: { fontSize: "26px", fontWeight: 800, letterSpacing: "0.02em" },
  mapSub: { marginBlockStart: "4px", fontSize: "14px", opacity: 0.8 },
  debug: { fontSize: "12px", opacity: 0.6, whiteSpace: "nowrap" },
  watchers: { fontSize: "12px", opacity: 0.7 },
  weapon: { minWidth: "130px", paddingInline: "12px" },
  wname: { fontSize: "13px", fontWeight: 600, opacity: 0.85 },
  ammo: { fontSize: "22px", fontWeight: 700 },
  reload: { height: "4px", marginBlockStart: "4px", borderRadius: "2px", overflow: "hidden", backgroundColor: "rgba(255, 255, 255, 0.12)" },
  reloadFill: { height: "100%", width: 0, backgroundColor: "var(--bagarre-gold)" },
  ability: { position: "relative", width: "76px", textAlign: "center", overflow: "hidden", paddingInline: "12px" },
  sound: { paddingBlock: "4px", fontSize: "12px", whiteSpace: "nowrap" },
  muted: { opacity: 0.55 },
  ready: { boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.45)" },
  active: { boxShadow: "inset 0 0 0 2px #9fe6ff" },
  cd: { position: "absolute", left: 0, right: 0, bottom: 0, height: 0, backgroundColor: "rgba(0, 0, 0, 0.55)" },
  front: { position: "relative" },
  key: { fontSize: "11px", opacity: 0.7 },
  label: { fontSize: "13px", fontWeight: 600 },
  t: { fontSize: "12px", minHeight: "15px" },
  picker: { flexWrap: "wrap", justifyContent: "center", fontSize: "12px" },
  pick: { paddingBlock: "4px", paddingInline: "8px", borderRadius: "5px", opacity: 0.55 },
  picked: { opacity: 1, boxShadow: "inset 0 0 0 1px #fff" },
  hint: { opacity: 0.75, marginInlineStart: "4px" },
  pickPerk: { whiteSpace: "nowrap" },
  warmup: {
    width: "min(560px, calc(100vw - 32px))",
    paddingBlock: "12px",
    paddingInline: "14px",
    pointerEvents: "auto",
  },
  warmupTitle: { fontSize: "26px", lineHeight: 1, color: "var(--bagarre-sand)" },
  warmupNumber: { color: "var(--bagarre-gold)" },
  warmupSub: { fontSize: "13px", opacity: 0.8 },
  stunned: {
    minWidth: "170px",
    color: "#9fe6ff",
    boxShadow: "inset 0 0 0 1px rgba(159, 230, 255, 0.6)",
  },
  stunFill: { height: "100%", width: 0, backgroundColor: "#9fe6ff" },
  // Over the HUD itself: nothing shows through a full flash.
  flash: { position: "fixed", inset: 0, backgroundColor: "#ffffff", opacity: 0, pointerEvents: "none", zIndex: 20 },
});

/** The HUD, mounted only while in a game. */
export function Hud() {
  countRender("hud");
  const { hud } = useEngine();
  // A free-for-all swaps the duel's score and opponent bar for its rank panel,
  // the kill feed and the minimap; a team deathmatch for the team score, the
  // kill feed and the minimap.
  const layout = useSelector(hud, (m) => (m?.royale ? "royale" : m?.team ? "team" : m?.ffa ? "ffa" : "duel"));
  const big = layout !== "duel";
  const royale = layout === "royale";
  return (
    <div {...stylex.props(styles.root)} data-testid="hud" aria-hidden="false">
      <div {...stylex.props(styles.top)}>
        <VStack gap={2} align="stretch" xstyle={styles.topLeft} data-testid="hud-top-left">
          {big && <MinimapBox />}
          {layout === "team" ? <TeamPanel /> : royale ? <RoyalePanel /> : layout === "ffa" ? <FfaPanel /> : null}
        </VStack>
        <VStack gap={2} align="center" xstyle={styles.topCentre} data-testid="hud-top-centre">
          {!big && <Score />}
          <Status />
          {royale && <ZoneArrow />}
          <MapCard />
        </VStack>
        <VStack gap={2} align="end" xstyle={styles.topRight} data-testid="hud-top-right">
          {big ? <KillFeed /> : <PlayerBar mine={false} />}
        </VStack>
      </div>
      <VStack gap={2} align="center" xstyle={styles.dock}>
        <Warmup />
        {!royale && <Picker />}
      </VStack>
      <div {...stylex.props(styles.bottom)}>
        <VStack gap={2} align="start" xstyle={styles.bottomLeft} data-testid="hud-bottom-left">
          {royale && <LootFeed />}
          <Watchers />
          <div {...stylex.props(styles.you)}>
            <PlayerBar mine />
            <HStack gap={2} align="stretch" data-testid="hud-abilities">
              <Ability kind="dash" keyLabel="Space" label="Dash" />
              <Ability kind="grenade" keyLabel="Q" label="Grenade" />
              <Ability kind="shield" keyLabel="E" label="Shield" />
              <Ability kind="melee" keyLabel="V" label="Melee" />
            </HStack>
          </div>
          {/* The netcode line, for us: dev builds only. */}
          {import.meta.env.DEV && <Debug />}
        </VStack>
        <VStack gap={2} align="end" xstyle={styles.bottomRight} data-testid="hud-bottom-right">
          {royale ? <GunSlots /> : <Weapon />}
          <HStack gap={2} align="end">
            {royale && <HealItems />}
            <Sound />
          </HStack>
        </VStack>
      </div>
      <Alert royale={royale} />
      <FlashScreen />
    </div>
  );
}

/**
 * The alert slot under the character: one thing at a time, by priority,
 * stunned (it blocks the dash) over the F prompt over the heal's progress.
 * They all stay mounted (the prompt fades in and out, and the tests read
 * their data attributes); the ones behind the top one are hidden.
 */
function Alert({ royale }: { royale: boolean }) {
  countRender("hud.alert");
  const { hud } = useEngine();
  const top = useSelector(hud, (m) =>
    (m?.sim?.stunTicks ?? 0) > 0 ? "stun" : m?.royale?.prompt ? "swap" : m?.royale && (m.royale.healing >= 0 || m.royale.healNote !== "") ? "heal" : null,
  );
  return (
    <div {...stylex.props(styles.alert)} data-testid="hud-alert" data-top={top ?? undefined}>
      <Stunned />
      {royale && (
        <VStack xstyle={[styles.alertItem, top === "stun" && styles.alertHidden]}>
          <SwapPrompt />
        </VStack>
      )}
      {royale && (
        <VStack xstyle={[styles.alertItem, top !== "heal" && styles.alertHidden]}>
          <HealStatus />
        </VStack>
      )}
    </div>
  );
}

/**
 * Stunned by a stun grenade: a small badge under the character with the
 * time left, while the predicted stun runs (the slow and the dash block are
 * the shared step's). The time and bar are written per frame, off React.
 */
function Stunned() {
  countRender("hud.stunned");
  const { hud } = useEngine();
  const on = useSelector(hud, (m) => (m?.sim?.stunTicks ?? 0) > 0);
  const t = useRef<HTMLElement>(null);
  const bar = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const left = m?.sim?.stunTicks ?? 0;
    const text = `${(left / TICK_RATE).toFixed(1)}s`;
    if (t.current && t.current.textContent !== text) t.current.textContent = text;
    const width = `${Math.min(1, left / STUN_TICKS) * 100}%`;
    if (bar.current && bar.current.style.width !== width) bar.current.style.width = width;
  });
  if (!on) return null;
  return (
    <VStack xstyle={[shared.hudBox, styles.stunned, styles.alertItem]} data-testid="hud-stunned" role="status" aria-label="Stunned: slowed, no dash">
      <HStack gap={1.5} align="center" justify="center">
        <Text xstyle={styles.label}>⚡ Stunned · no dash</Text>
        <Text ref={t} xstyle={[styles.t, shared.tabular]}>
          {""}
        </Text>
      </HStack>
      <VStack xstyle={styles.reload}>
        <VStack ref={bar} xstyle={styles.stunFill} />
      </VStack>
    </VStack>
  );
}

/**
 * The flash grenade's white screen over everything, its opacity written per
 * frame from the synced end tick (match.ts: full white, then one steady fade
 * out, never a strobe). `data-active` while it shows, for the tests.
 */
function FlashScreen() {
  countRender("hud.flash");
  const { hud } = useEngine();
  const el = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const node = el.current;
    if (!node) return;
    const a = m?.flash ?? 0;
    const opacity = a > 0 ? a.toFixed(3) : "0";
    if (node.style.opacity !== opacity) node.style.opacity = opacity;
    if (a > 0) node.dataset.active = "";
    else delete node.dataset.active;
  });
  return <VStack ref={el} xstyle={styles.flash} data-testid="hud-flash" aria-hidden />;
}

/** How many are watching, small by your bar: players see they have an audience. Nothing when nobody is. */
function Watchers() {
  countRender("hud.watchers");
  const { hud } = useEngine();
  const n = useSelector(hud, (m) => m?.spectators ?? 0);
  if (n <= 0) return null;
  return (
    <Text xstyle={[shared.tabular, styles.watchers]} aria-label={`${n} watching`} data-testid="hud-spectators" data-count={n}>
      👁 {n}
    </Text>
  );
}

/**
 * A player's bar: the name, the HP and the shield bubble's strength left.
 * Ours (bottom left) is the big one, with the HP as a number and our perk as
 * a badge after the name (`hud-perk`, `data-perk` its key; the name and what
 * it does on hover). The duel opponent's (top right) fills from the right,
 * its perk a glyph after the name.
 */
function PlayerBar({ mine }: { mine: boolean }) {
  countRender(mine ? "hud.me" : "hud.opponent");
  const { hud } = useEngine();
  const p = useSelector(
    hud,
    (m) => {
      const v = mine ? m?.me : m?.opponent;
      return {
        name: v?.name ?? "",
        hp: v?.hp ?? 0,
        shield: v && v.shieldTicks > 0 ? v.shieldHp / SHIELD.absorb : 0,
        slot: v ? paintOf(v) : null,
        present: !!v,
        away: !!v && !v.connected,
        // Ours: the predicted perk first (a royale pickup shows at once).
        perk: (mine ? m?.sim?.perk : undefined) ?? v?.perk ?? NO_PERK,
      };
    },
    shallowEqual,
  );
  const name = p.name ? (mine ? `${p.name} (you)` : p.name) : mine ? "You" : "Opponent";
  // The opponent's connection dropped: the server keeps their seat for a while.
  const label = p.away ? `${name} · reconnecting…` : name;
  const perk = perkDef(p.perk);
  const hp = (
    <VStack
      xstyle={[styles.hp, mine && styles.hpMine, !mine && styles.hpRight]}
      role="meter"
      aria-label={`${name} health`}
      aria-valuemin={0}
      aria-valuemax={MAX_HP}
      aria-valuenow={p.hp}
    >
      <VStack xstyle={[styles.hpFill, slotFill(p.slot)]} style={{ transform: `scaleX(${p.hp / MAX_HP})` }} />
    </VStack>
  );
  return (
    <VStack
      xstyle={[shared.hudBox, mine ? styles.me : styles.player, !mine && styles.right, (!p.present || p.away) && styles.absent]}
      data-away={p.away || undefined}
      data-testid={mine ? "hud-me" : "hud-opponent"}
    >
      <HStack align="center" justify={mine ? "start" : "end"} xstyle={styles.nameLine}>
        <Text xstyle={styles.name} color="inherit">
          {label}
          {!mine && perk && (
            <Text as="span" color="inherit" xstyle={styles.namePerk} aria-label={perk.name} data-testid="hud-opponent-perk">
              {perkView(p.perk)?.icon}
            </Text>
          )}
        </Text>
        {mine && perk && (
          <span
            {...stylex.props(styles.perkBadge)}
            title={`${perk.name}: ${perkView(p.perk)?.blurb ?? ""}`}
            aria-label={`Perk: ${perk.name}. ${perkView(p.perk)?.blurb ?? ""}`}
            data-testid="hud-perk"
            data-perk={perk.key}
          >
            {perkView(p.perk)?.icon}
          </span>
        )}
      </HStack>
      {mine ? (
        <HStack gap={2} align="center">
          {hp}
          <Text xstyle={[styles.hpValue, shared.tabular]} aria-hidden>
            {p.hp}
          </Text>
        </HStack>
      ) : (
        hp
      )}
      <VStack xstyle={[styles.shieldBar, !mine && styles.hpRight]} data-testid={mine ? "hud-me-shield" : undefined} data-shield={p.shield > 0 ? "" : undefined}>
        <VStack xstyle={styles.shieldFill} style={{ transform: `scaleX(${p.shield})` }} />
      </VStack>
    </VStack>
  );
}

function Score() {
  countRender("hud.score");
  const { hud } = useEngine();
  const score = useSelector(hud, (m) => `${m?.me?.kills ?? 0} - ${m?.opponent?.kills ?? 0}`);
  return (
    <Text xstyle={[shared.hudBox, styles.score, shared.tabular]} aria-label={`Score, first to ${KILLS_TO_WIN}: ${score}`} data-testid="hud-score">
      {score}
    </Text>
  );
}

function Status() {
  countRender("hud.status");
  const { hud } = useEngine();
  const status = useSelector(hud, (m) => m?.status ?? "");
  if (!status) return null;
  return (
    <Text xstyle={[shared.hudBox, styles.status]} data-testid="hud-status">
      {status}
    </Text>
  );
}

function MapCard() {
  countRender("hud.mapCard");
  const { hud } = useEngine();
  const card = useSelector(hud, (m) => (m?.mapCard ? { title: m.mapCard.title, sub: m.mapCard.sub } : null), shallowEqual);
  const el = useRef<HTMLElement>(null);
  // Fades out by frame time (see match.ts' mapCardLeft): per frame, off React.
  useStoreEffect(hud, (m) => {
    if (el.current && m?.mapCard) el.current.style.opacity = String(m.mapCard.opacity);
  });
  if (!card) return null;
  return (
    <VStack ref={el} xstyle={[shared.hudBox, styles.mapCard]} data-testid="hud-map">
      <Text xstyle={styles.mapTitle}>{card.title}</Text>
      <Text xstyle={styles.mapSub}>{card.sub}</Text>
    </VStack>
  );
}

function Weapon() {
  countRender("hud.weapon");
  const { hud } = useEngine();
  const w = useSelector(
    hud,
    (m) => {
      const def = weaponDef(m?.me?.weapon ?? 0);
      const s = m?.sim;
      return {
        name: def.name,
        // The magazine is the perk's (Bigger mag).
        ammo: s ? (s.reloadTicks > 0 ? "Reloading" : `${s.ammo} / ${magazineOf(def, s.perk)}`) : "",
      };
    },
    shallowEqual,
  );
  const fill = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const s = m?.sim;
    const def = weaponDef(m?.me?.weapon ?? 0);
    const frac = s && s.reloadTicks > 0 ? 1 - s.reloadTicks / reloadTicksOf(def, s.perk) : 0;
    const width = `${frac * 100}%`;
    if (fill.current && fill.current.style.width !== width) fill.current.style.width = width;
  });
  return (
    <VStack xstyle={[shared.hudBox, styles.weapon]} data-testid="hud-weapon">
      <Text xstyle={styles.wname}>{w.name}</Text>
      <Text xstyle={[styles.ammo, shared.tabular]} data-testid="hud-ammo">
        {w.ammo}
      </Text>
      <VStack xstyle={styles.reload}>
        <VStack ref={fill} xstyle={styles.reloadFill} />
      </VStack>
    </VStack>
  );
}

const ABILITY: Record<"dash" | "grenade" | "shield" | "melee", { cd: (m: HudModel) => number; total: (m: HudModel) => number }> = {
  // The perk's dash (perks.ts): with Double dash, the sweep is the second dash's window while it is open, then the cooldown.
  dash: { cd: (m) => dashTimer(m.sim?.dashCd ?? 0, m.sim?.perk ?? NO_PERK).left, total: (m) => dashTimer(m.sim?.dashCd ?? 0, m.sim?.perk ?? NO_PERK).total },
  // Each grenade type has its own cooldown: the sweep is out of the one in hand's.
  grenade: { cd: (m) => m.sim?.grenadeCd ?? 0, total: (m) => grenadeCooldownTicks(m.me?.grenade ?? 0) },
  // Battle royale: charges, with a short wait between two (the bubble, then ROYALE.shieldGap).
  shield: { cd: (m) => m.sim?.shieldCd ?? 0, total: (m) => (m.royale ? SHIELD_CHARGE_TICKS : SHIELD_COOLDOWN_TICKS) },
  melee: { cd: (m) => m.sim?.meleeCd ?? 0, total: () => MELEE_COOLDOWN_TICKS },
};

function Ability({ kind, keyLabel, label }: { kind: keyof typeof ABILITY; keyLabel: string; label: string }) {
  countRender(`hud.${kind}`);
  const { hud } = useEngine();
  const a = ABILITY[kind];
  const state = useSelector(
    hud,
    (m) => {
      // Battle royale: grenades and shield charges are counted; none left is never ready.
      // Double dash counts its dashes too (2 ready, 1 while the window is open), and one is enough.
      const perk = m?.sim?.perk ?? NO_PERK;
      const charges = kind === "dash" && dashWindowTicks(perk) > 0 ? dashesReady(m?.sim?.dashCd ?? 0, perk) : -1;
      const count = charges >= 0 ? charges : !m?.royale ? -1 : kind === "grenade" ? m.royale.grenades : kind === "shield" ? m.royale.shields : -1;
      return {
        ready: charges >= 0 ? charges > 0 : (!m || a.cd(m) === 0) && count !== 0,
        // Highlighted: the shield bubble up, or Double dash's window open for the second dash.
        active: (kind === "shield" && (m?.me?.shieldHp ?? 0) > 0) || (kind === "dash" && dashTimer(m?.sim?.dashCd ?? 0, perk).window),
        // The grenade slot names the type in hand, with its icon.
        grenade: kind === "grenade" ? (m?.me?.grenade ?? 0) : -1,
        count,
        charges: charges >= 0,
      };
    },
    shallowEqual,
  );
  const shown =
    state.charges
      ? `${label} ×${state.count}`
      : state.count === 0
      ? "None"
      : state.grenade >= 0
        ? `${grenadeView(state.grenade).icon} ${grenadeDef(state.grenade).name}${state.count > 0 ? ` ×${state.count}` : ""}`
        : state.count > 0
          ? `${label} ×${state.count}`
          : label;
  // The sweep and the timer move every tick while cooling down: written here.
  const cd = useRef<HTMLElement>(null);
  const t = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const left = m ? a.cd(m) : 0;
    const height = `${m ? Math.min(1, left / a.total(m)) * 100 : 0}%`;
    const none = (kind === "grenade" && m?.royale?.grenades === 0) || (kind === "shield" && m?.royale?.shields === 0);
    // Double dash's window: the time left to dash again.
    const chain = kind === "dash" && !!m && dashTimer(m.sim?.dashCd ?? 0, m.sim?.perk ?? NO_PERK).window;
    const text = none ? "find some" : chain ? `again ${(left / TICK_RATE).toFixed(1)}s` : left > 0 ? `${(left / TICK_RATE).toFixed(1)}s` : "ready";
    if (cd.current && cd.current.style.height !== height) cd.current.style.height = height;
    if (t.current && t.current.textContent !== text) t.current.textContent = text;
  });
  return (
    <VStack
      xstyle={[shared.hudBox, styles.ability, state.ready && styles.ready, state.active && styles.active]}
      data-testid={`hud-${kind}`}
      data-ready={state.ready ? "" : undefined}
      data-type={state.grenade >= 0 ? GRENADES[state.grenade]?.key : undefined}
      data-count={state.count >= 0 ? state.count : undefined}
      data-window={state.active && kind === "dash" ? "" : undefined}
    >
      <VStack ref={cd} xstyle={styles.cd} />
      <Text xstyle={[styles.front, styles.key]}>{keyLabel}</Text>
      <Text xstyle={[styles.front, styles.label]}>{shown}</Text>
      <Text ref={t} xstyle={[styles.front, styles.t, shared.tabular]}>
        ready
      </Text>
    </VStack>
  );
}

function Sound() {
  countRender("hud.sound");
  const { hud } = useEngine();
  const muted = useSelector(hud, (m) => !!m?.muted);
  return (
    <HStack gap={1.5} align="center" xstyle={[shared.hudBox, styles.sound, muted && styles.muted]} data-testid="hud-sound" data-muted={muted ? "" : undefined}>
      <Text as="span" color="inherit" xstyle={styles.key}>
        M
      </Text>
      <Text as="span" color="inherit">
        Sound {muted ? "off" : "on"}
      </Text>
    </HStack>
  );
}

/**
 * The warmup: the timer to the match start and the loadout picker (the same
 * as the waiting card's, clickable; the number keys and G work too), over the live
 * game: the player keeps moving meanwhile. A pick applies at once.
 */
function Warmup() {
  countRender("hud.warmup");
  const { hud } = useEngine();
  const seconds = useSelector(hud, (m) => m?.warmup ?? null);
  const royale = useSelector(hud, (m) => !!m?.royale);
  if (seconds === null) return null;
  return (
    <VStack gap={1} xstyle={[shared.hudBox, styles.warmup]} data-testid="warmup">
      <Text xstyle={[shared.display, styles.warmupTitle, shared.tabular]} aria-live="polite" data-testid="warmup-timer" data-seconds={seconds}>
        Match starts in{" "}
        <Text as="span" color="inherit" xstyle={styles.warmupNumber}>
          {seconds}
        </Text>
      </Text>
      {royale ? (
        // Battle royale: nothing to pick.
        <Text xstyle={styles.warmupSub}>
          One life. Everyone starts with the Pistol: open the glowing chests with F for guns, grenades, healing, shield
          charges (1-3 or the wheel switch guns, F swaps with one on the floor, 4 bandage, 5 medkit, E uses a shield charge).
          Stay inside the zone. Last one standing wins.
        </Text>
      ) : (
        <>
          <Text xstyle={styles.warmupSub}>Pick your loadout: it's in your hand at once. No shooting until the match starts.</Text>
          <WeaponPicker live />
          <GrenadePicker heading="Your grenade" live />
          <PerkPicker heading="Your perk" live />
        </>
      )}
    </VStack>
  );
}

function Picker() {
  countRender("hud.picker");
  const { hud } = useEngine();
  const warmup = useSelector(hud, (m) => m?.warmup != null);
  const p = useSelector(
    hud,
    (m) => ({
      pick: m?.me?.pick ?? 0,
      weapon: m?.me?.weapon ?? 0,
      grenadePick: m?.me?.grenadePick ?? 0,
      grenade: m?.me?.grenade ?? 0,
      perkPick: m?.me?.perkPick ?? NO_PERK,
      perk: m?.me?.perk ?? NO_PERK,
      canPick: !!m?.canPick,
    }),
    shallowEqual,
  );
  // The warmup panel has the full picker; playing and alive, there is nothing to pick.
  if (warmup || !p.canPick) return null;
  const changed = p.pick !== p.weapon || p.grenadePick !== p.grenade || p.perkPick !== p.perk;
  const hint = changed ? "applies on respawn" : `${WEAPON_KEYS} weapon, G grenade`;
  return (
    <HStack gap={1.5} align="center" xstyle={styles.picker} data-testid="hud-picker">
      {PICKABLE_WEAPONS.map((i) => WEAPONS[i]).map((w, i) => (
        <Text
          key={w.name}
          xstyle={[shared.hudBox, styles.pick, i === p.pick && styles.picked]}
        >
          {i + 1} {w.name}
        </Text>
      ))}
      <Text xstyle={[shared.hudBox, styles.pick, styles.picked]} data-testid="hud-picker-grenade">
        G {grenadeView(p.grenadePick).icon} {grenadeDef(p.grenadePick).name}
      </Text>
      <Text xstyle={[shared.hudBox, styles.pick, styles.pickPerk, styles.picked]} data-testid="hud-picker-perk">
        {perkLabel(p.perkPick) || "No perk"}
      </Text>
      <Text xstyle={styles.hint}>{hint}</Text>
    </HStack>
  );
}

function Debug() {
  countRender("hud.debug");
  const { hud } = useEngine();
  const el = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const text = m?.debug ?? "";
    if (el.current && el.current.textContent !== text) el.current.textContent = text;
  });
  return <VStack as="span" ref={el} xstyle={[styles.debug, shared.tabular]} data-testid="hud-debug" />;
}
