import {
  DASH_COOLDOWN_TICKS,
  GRENADE_COOLDOWN_TICKS,
  KILLS_TO_WIN,
  MAX_HP,
  SHIELD_COOLDOWN_TICKS,
  TICK_RATE,
  WEAPONS,
  ticks,
  weaponDef,
  type PlayerSim,
  type PlayerView,
} from "@bagarre/shared";
import { PLAYER_CSS_COLORS } from "./scene.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface HudModel {
  status: string;
  me: PlayerView | null;
  opponent: PlayerView | null;
  /** Predicted local state (cooldowns, ammo), fresher than `me`. */
  sim: PlayerSim | null;
  /** Weapon picks are accepted right now (dead or between matches). */
  canPick: boolean;
  banner: { title: string; sub: string } | null;
  /** The map's name and blurb, for a few seconds at match start. */
  mapCard: { title: string; sub: string; opacity: number } | null;
  debug: string;
  /** Sound muted (M toggles). */
  muted: boolean;
}

export class Hud {
  private me = $("#hud-me");
  private opp = $("#hud-opp");
  private score = $("#hud-score");
  private status = $("#hud-status");
  private banner = $("#hud-banner");
  private mapCard = $("#hud-map");
  private debug = $("#hud-debug");
  private weapon = $("#hud-weapon");
  private picker = $("#hud-picker");
  private abilities = {
    dash: $("#ab-dash"),
    grenade: $("#ab-grenade"),
    shield: $("#ab-shield"),
  };
  private pickerKey = "";
  /** Mute toggle tile, built here so it sits right after the abilities. */
  private sound = (() => {
    const el = document.createElement("div");
    el.className = "ability sound";
    el.innerHTML = `<div class="key">M</div><div class="label">Sound</div><div class="t"></div>`;
    $("#hud-bottom").append(el);
    return el;
  })();

  private setBar(el: HTMLElement, p: PlayerView | null) {
    el.classList.toggle("absent", !p);
    const mine = el === this.me;
    const label = p?.name ? (mine ? `${p.name} (you)` : p.name) : mine ? "You" : "Opponent";
    const nameEl = el.querySelector<HTMLElement>(".name")!;
    if (nameEl.textContent !== label) nameEl.textContent = label;
    const fill = el.querySelector<HTMLElement>(".fill")!;
    fill.style.width = `${p ? (100 * p.hp) / MAX_HP : 0}%`;
    if (p) el.style.setProperty("--color", PLAYER_CSS_COLORS[p.slot] ?? "#888");
  }

  private setAbility(el: HTMLElement, cd: number, total: number, active = false) {
    const frac = Math.min(1, cd / total);
    el.querySelector<HTMLElement>(".cd")!.style.height = `${frac * 100}%`;
    const t = el.querySelector<HTMLElement>(".t")!;
    const text = cd > 0 ? `${(cd / TICK_RATE).toFixed(1)}s` : "ready";
    if (t.textContent !== text) t.textContent = text;
    el.classList.toggle("ready", cd === 0);
    el.classList.toggle("active", active);
  }

  update(m: HudModel) {
    this.setBar(this.me, m.me);
    this.setBar(this.opp, m.opponent);
    this.score.textContent = `${m.me?.kills ?? 0} - ${m.opponent?.kills ?? 0}`;
    this.score.title = `First to ${KILLS_TO_WIN}`;
    if (this.status.textContent !== m.status) this.status.textContent = m.status;
    this.banner.hidden = !m.banner;
    if (m.banner) {
      this.banner.querySelector(".title")!.textContent = m.banner.title;
      this.banner.querySelector(".sub")!.textContent = m.banner.sub;
    }
    this.mapCard.hidden = !m.mapCard;
    if (m.mapCard) {
      const title = this.mapCard.querySelector(".title")!;
      const sub = this.mapCard.querySelector(".sub")!;
      if (title.textContent !== m.mapCard.title) title.textContent = m.mapCard.title;
      if (sub.textContent !== m.mapCard.sub) sub.textContent = m.mapCard.sub;
      this.mapCard.style.opacity = String(m.mapCard.opacity);
    }
    if (this.debug.textContent !== m.debug) this.debug.textContent = m.debug;

    // Weapon, ammo, reload.
    const w = weaponDef(m.me?.weapon ?? 0);
    this.weapon.querySelector(".wname")!.textContent = w.name;
    const s = m.sim;
    const ammo = s ? (s.reloadTicks > 0 ? "Reloading" : `${s.ammo} / ${w.magazine}`) : "";
    const ammoEl = this.weapon.querySelector(".ammo")!;
    if (ammoEl.textContent !== ammo) ammoEl.textContent = ammo;
    const reloadFrac = s && s.reloadTicks > 0 ? 1 - s.reloadTicks / ticks(w.reloadTime) : 0;
    this.weapon.querySelector<HTMLElement>(".reload .fill")!.style.width = `${reloadFrac * 100}%`;

    // Ability cooldowns (predicted, so they react the moment you press).
    this.setAbility(this.abilities.dash, s?.dashCd ?? 0, DASH_COOLDOWN_TICKS);
    this.setAbility(this.abilities.grenade, s?.grenadeCd ?? 0, GRENADE_COOLDOWN_TICKS);
    this.setAbility(this.abilities.shield, s?.shieldCd ?? 0, SHIELD_COOLDOWN_TICKS, (m.me?.shieldHp ?? 0) > 0);

    const soundText = m.muted ? "off" : "on";
    const soundT = this.sound.querySelector(".t")!;
    if (soundT.textContent !== soundText) soundT.textContent = soundText;
    this.sound.classList.toggle("muted", m.muted);

    // Weapon picker: current pick highlighted; only live while dead / between matches.
    const pick = m.me?.pick ?? 0;
    const key = `${pick}|${m.canPick}|${m.me?.weapon}`;
    if (key !== this.pickerKey) {
      this.pickerKey = key;
      const items = WEAPONS.map(
        (wd, i) => `<span class="w${i === pick ? " picked" : ""}">${i + 1} ${wd.name}</span>`,
      ).join("");
      const hint = m.canPick
        ? pick !== m.me?.weapon
          ? "applies on respawn"
          : "press 1-4 to pick"
        : "pick while dead";
      this.picker.innerHTML = `${items}<span class="hint">${hint}</span>`;
      this.picker.classList.toggle("locked", !m.canPick);
    }
  }
}
