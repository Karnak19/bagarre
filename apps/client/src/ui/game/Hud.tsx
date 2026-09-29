// The in-game HUD: both players' HP, the score, the status line, the map
// card, the weapon and ammo, the ability cooldowns, the sound toggle, the
// weapon picker line and the netcode debug line. In a free-for-all the score
// and the opponent's bar give way to the rank panel, the kill feed and the
// minimap (HudFfa.tsx); in a team deathmatch to the team score (HudTeam.tsx),
// the same kill feed and minimap, in team colours.
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
  DASH_COOLDOWN_TICKS,
  GRENADES,
  KILLS_TO_WIN,
  MAX_HP,
  SHIELD_COOLDOWN_TICKS,
  STUN_TICKS,
  TICK_RATE,
  WEAPONS,
  grenadeCooldownTicks,
  grenadeDef,
  ticks,
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
import { TeamPanel } from "./HudTeam.tsx";
import { GRENADE_ICONS, GrenadePicker, WeaponPicker } from "./WeaponPicker.tsx";

const styles = stylex.create({
  root: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 10 },
  top: { position: "absolute", top: "16px", left: "16px", right: "16px" },
  panel: {
    backgroundColor: "var(--bagarre-hud-panel)",
    borderRadius: "var(--radius-element)",
    paddingBlock: "8px",
    paddingInline: "10px",
  },
  player: { width: "min(320px, 38vw)" },
  right: { textAlign: "end" },
  absent: { opacity: 0.35 },
  name: { fontSize: "13px", fontWeight: 600, marginBlockEnd: "6px", opacity: 0.9 },
  hp: { height: "10px", borderRadius: "5px", overflow: "hidden", backgroundColor: "rgba(255, 255, 255, 0.12)" },
  hpRight: { transform: "scaleX(-1)" },
  // Scaled, not resized: the HP change animates on the compositor.
  hpFill: { height: "100%", width: "100%", transformOrigin: "left center", transition: "transform 120ms linear" },
  score: { paddingInline: "16px", fontSize: "22px", fontWeight: 700, whiteSpace: "nowrap" },
  status: {
    position: "absolute",
    top: "80px",
    left: "50%",
    transform: "translateX(-50%)",
    paddingBlock: "6px",
    paddingInline: "14px",
    fontSize: "14px",
    borderRadius: "6px",
    backgroundColor: "var(--bagarre-hud-panel)",
  },
  mapCard: {
    position: "absolute",
    top: "22%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    maxWidth: "min(520px, calc(100vw - 32px))",
    textAlign: "center",
    padding: "12px 24px",
    borderRadius: "10px",
    backgroundColor: "var(--bagarre-hud-panel)",
    animationName: {
      default: stylex.keyframes({ from: { opacity: 0, transform: "translate(-50%, -50%) translateY(-6px)" } }),
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "0.3s",
    animationTimingFunction: "ease",
    animationFillMode: "backwards",
  },
  mapTitle: { fontSize: "26px", fontWeight: 800, letterSpacing: "0.02em" },
  mapSub: { marginBlockStart: "4px", fontSize: "14px", opacity: 0.8 },
  debug: { position: "absolute", bottom: "10px", left: "12px", fontSize: "12px", opacity: 0.6 },
  watchers: { position: "absolute", bottom: "32px", left: "12px", fontSize: "12px", opacity: 0.7 },
  bottom: { position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)" },
  weapon: { minWidth: "130px", paddingInline: "12px" },
  wname: { fontSize: "13px", fontWeight: 600, opacity: 0.85 },
  ammo: { fontSize: "22px", fontWeight: 700 },
  reload: { height: "4px", marginBlockStart: "4px", borderRadius: "2px", overflow: "hidden", backgroundColor: "rgba(255, 255, 255, 0.12)" },
  reloadFill: { height: "100%", width: 0, backgroundColor: "var(--bagarre-gold)" },
  ability: { position: "relative", width: "76px", textAlign: "center", overflow: "hidden", paddingInline: "12px" },
  sound: { width: "56px" },
  muted: { opacity: 0.55 },
  ready: { boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.45)" },
  active: { boxShadow: "inset 0 0 0 2px #9fe6ff" },
  cd: { position: "absolute", left: 0, right: 0, bottom: 0, height: 0, backgroundColor: "rgba(0, 0, 0, 0.55)" },
  front: { position: "relative" },
  key: { fontSize: "11px", opacity: 0.7 },
  label: { fontSize: "13px", fontWeight: 600 },
  t: { fontSize: "12px", minHeight: "15px" },
  picker: { position: "absolute", bottom: "96px", left: "50%", transform: "translateX(-50%)", fontSize: "12px" },
  pick: { paddingBlock: "4px", paddingInline: "8px", borderRadius: "5px", opacity: 0.55 },
  picked: { opacity: 1, boxShadow: "inset 0 0 0 1px #fff" },
  lockedPick: { opacity: 0.35 },
  lockedPicked: { opacity: 0.7 },
  hint: { opacity: 0.75, marginInlineStart: "4px" },
  warmup: {
    position: "absolute",
    bottom: "96px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(560px, calc(100vw - 32px))",
    paddingBlock: "12px",
    paddingInline: "14px",
    pointerEvents: "auto",
  },
  warmupTitle: { fontSize: "26px", lineHeight: 1, color: "var(--bagarre-sand)" },
  warmupNumber: { color: "var(--bagarre-gold)" },
  warmupSub: { fontSize: "13px", opacity: 0.8 },
  stunned: {
    position: "absolute",
    bottom: "172px",
    left: "50%",
    transform: "translateX(-50%)",
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
  const layout = useSelector(hud, (m) => (m?.team ? "team" : m?.ffa ? "ffa" : "duel"));
  const big = layout !== "duel";
  return (
    <VStack xstyle={styles.root} data-testid="hud" aria-hidden="false">
      {big ? (
        <HStack justify="between" align="start" gap={4} xstyle={styles.top}>
          <PlayerBar mine />
          <VStack gap={2} align="end">
            {layout === "team" ? <TeamPanel /> : <FfaPanel />}
            <KillFeed />
          </VStack>
        </HStack>
      ) : (
        <HStack justify="between" align="center" gap={4} xstyle={styles.top}>
          <PlayerBar mine />
          <Score />
          <PlayerBar mine={false} />
        </HStack>
      )}
      {big && <MinimapBox />}
      <Status />
      <MapCard />
      <Warmup />
      <Picker />
      <HStack gap={2} align="stretch" xstyle={styles.bottom}>
        <Weapon />
        <Ability kind="dash" keyLabel="Space" label="Dash" />
        <Ability kind="grenade" keyLabel="Q" label="Grenade" />
        <Ability kind="shield" keyLabel="E" label="Shield" />
        <Sound />
      </HStack>
      <Stunned />
      <Watchers />
      <Debug />
      <FlashScreen />
    </VStack>
  );
}

/**
 * Stunned by a stun grenade: a small badge over the ability bar with the
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
    <VStack xstyle={[styles.panel, styles.stunned]} data-testid="hud-stunned" role="status" aria-label="Stunned: slowed, no dash">
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

/** How many are watching, small in the corner: players see they have an audience. Nothing when nobody is. */
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

function PlayerBar({ mine }: { mine: boolean }) {
  countRender(mine ? "hud.me" : "hud.opponent");
  const { hud } = useEngine();
  const p = useSelector(
    hud,
    (m) => {
      const v = mine ? m?.me : m?.opponent;
      return { name: v?.name ?? "", hp: v?.hp ?? 0, slot: v ? paintOf(v) : null, present: !!v, away: !!v && !v.connected };
    },
    shallowEqual,
  );
  const name = p.name ? (mine ? `${p.name} (you)` : p.name) : mine ? "You" : "Opponent";
  // The opponent's connection dropped: the server keeps their seat for a while.
  const label = p.away ? `${name} · reconnecting…` : name;
  return (
    <VStack
      xstyle={[styles.panel, styles.player, !mine && styles.right, (!p.present || p.away) && styles.absent]}
      data-away={p.away || undefined}
      data-testid={mine ? "hud-me" : "hud-opponent"}
    >
      <Text xstyle={styles.name} color="inherit">
        {label}
      </Text>
      <VStack xstyle={[styles.hp, !mine && styles.hpRight]} role="meter" aria-label={`${name} health`} aria-valuemin={0} aria-valuemax={MAX_HP} aria-valuenow={p.hp}>
        <VStack xstyle={[styles.hpFill, slotFill(p.slot)]} style={{ transform: `scaleX(${p.hp / MAX_HP})` }} />
      </VStack>
    </VStack>
  );
}

function Score() {
  countRender("hud.score");
  const { hud } = useEngine();
  const score = useSelector(hud, (m) => `${m?.me?.kills ?? 0} - ${m?.opponent?.kills ?? 0}`);
  return (
    <Text xstyle={[styles.panel, styles.score, shared.tabular]} aria-label={`Score, first to ${KILLS_TO_WIN}: ${score}`} data-testid="hud-score">
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
    <Text xstyle={styles.status} data-testid="hud-status">
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
    <VStack ref={el} xstyle={styles.mapCard} data-testid="hud-map">
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
        ammo: s ? (s.reloadTicks > 0 ? "Reloading" : `${s.ammo} / ${def.magazine}`) : "",
      };
    },
    shallowEqual,
  );
  const fill = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const s = m?.sim;
    const def = weaponDef(m?.me?.weapon ?? 0);
    const frac = s && s.reloadTicks > 0 ? 1 - s.reloadTicks / ticks(def.reloadTime) : 0;
    const width = `${frac * 100}%`;
    if (fill.current && fill.current.style.width !== width) fill.current.style.width = width;
  });
  return (
    <VStack xstyle={[styles.panel, styles.weapon]} data-testid="hud-weapon">
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

const ABILITY: Record<"dash" | "grenade" | "shield", { cd: (m: HudModel) => number; total: (m: HudModel) => number }> = {
  dash: { cd: (m) => m.sim?.dashCd ?? 0, total: () => DASH_COOLDOWN_TICKS },
  // Each grenade type has its own cooldown: the sweep is out of the one in hand's.
  grenade: { cd: (m) => m.sim?.grenadeCd ?? 0, total: (m) => grenadeCooldownTicks(m.me?.grenade ?? 0) },
  shield: { cd: (m) => m.sim?.shieldCd ?? 0, total: () => SHIELD_COOLDOWN_TICKS },
};

function Ability({ kind, keyLabel, label }: { kind: keyof typeof ABILITY; keyLabel: string; label: string }) {
  countRender(`hud.${kind}`);
  const { hud } = useEngine();
  const a = ABILITY[kind];
  const state = useSelector(
    hud,
    (m) => ({
      ready: !m || a.cd(m) === 0,
      active: kind === "shield" && (m?.me?.shieldHp ?? 0) > 0,
      // The grenade slot names the type in hand, with its icon.
      grenade: kind === "grenade" ? (m?.me?.grenade ?? 0) : -1,
    }),
    shallowEqual,
  );
  const shown = state.grenade >= 0 ? `${GRENADE_ICONS[state.grenade] ?? ""} ${grenadeDef(state.grenade).name}` : label;
  // The sweep and the timer move every tick while cooling down: written here.
  const cd = useRef<HTMLElement>(null);
  const t = useRef<HTMLElement>(null);
  useStoreEffect(hud, (m) => {
    const left = m ? a.cd(m) : 0;
    const height = `${m ? Math.min(1, left / a.total(m)) * 100 : 0}%`;
    const text = left > 0 ? `${(left / TICK_RATE).toFixed(1)}s` : "ready";
    if (cd.current && cd.current.style.height !== height) cd.current.style.height = height;
    if (t.current && t.current.textContent !== text) t.current.textContent = text;
  });
  return (
    <VStack
      xstyle={[styles.panel, styles.ability, state.ready && styles.ready, state.active && styles.active]}
      data-testid={`hud-${kind}`}
      data-ready={state.ready ? "" : undefined}
      data-type={state.grenade >= 0 ? GRENADES[state.grenade]?.key : undefined}
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
    <VStack xstyle={[styles.panel, styles.ability, styles.sound, muted && styles.muted]} data-testid="hud-sound">
      <Text xstyle={styles.key}>M</Text>
      <Text xstyle={styles.label}>Sound</Text>
      <Text xstyle={styles.t}>{muted ? "off" : "on"}</Text>
    </VStack>
  );
}

/**
 * The warmup: the timer to the match start and the loadout picker (the same
 * as the waiting card's, clickable; keys 1-7 and G work too), over the live
 * game: the player keeps moving meanwhile. A pick applies at once.
 */
function Warmup() {
  countRender("hud.warmup");
  const { hud } = useEngine();
  const seconds = useSelector(hud, (m) => m?.warmup ?? null);
  if (seconds === null) return null;
  return (
    <VStack gap={1} xstyle={[styles.panel, styles.warmup]} data-testid="warmup">
      <Text xstyle={[shared.display, styles.warmupTitle, shared.tabular]} aria-live="polite" data-testid="warmup-timer" data-seconds={seconds}>
        Match starts in{" "}
        <Text as="span" color="inherit" xstyle={styles.warmupNumber}>
          {seconds}
        </Text>
      </Text>
      <Text xstyle={styles.warmupSub}>Pick your loadout: it's in your hand at once. No shooting until the match starts.</Text>
      <WeaponPicker live />
      <GrenadePicker heading="Your grenade" live />
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
      canPick: !!m?.canPick,
    }),
    shallowEqual,
  );
  // The warmup panel has the full picker.
  if (warmup) return null;
  const changed = p.pick !== p.weapon || p.grenadePick !== p.grenade;
  const hint = p.canPick ? (changed ? "applies on respawn" : "1-7 weapon, G grenade") : "pick while dead";
  return (
    <HStack gap={1.5} align="center" xstyle={styles.picker} data-testid="hud-picker">
      {WEAPONS.map((w, i) => (
        <Text
          key={w.name}
          xstyle={[
            styles.panel,
            styles.pick,
            !p.canPick && styles.lockedPick,
            i === p.pick && styles.picked,
            i === p.pick && !p.canPick && styles.lockedPicked,
          ]}
        >
          {i + 1} {w.name}
        </Text>
      ))}
      <Text xstyle={[styles.panel, styles.pick, styles.picked, !p.canPick && styles.lockedPicked]} data-testid="hud-picker-grenade">
        G {GRENADE_ICONS[p.grenadePick]} {grenadeDef(p.grenadePick).name}
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
