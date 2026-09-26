import { KILLS_TO_WIN, MAX_HP, type PlayerView } from "@bagarre/shared";
import { PLAYER_CSS_COLORS } from "./scene.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface HudModel {
  status: string;
  me: PlayerView | null;
  opponent: PlayerView | null;
  banner: { title: string; sub: string } | null;
  debug: string;
}

export class Hud {
  private me = $("#hud-me");
  private opp = $("#hud-opp");
  private score = $("#hud-score");
  private status = $("#hud-status");
  private banner = $("#hud-banner");
  private debug = $("#hud-debug");

  private setBar(el: HTMLElement, p: PlayerView | null) {
    el.classList.toggle("absent", !p);
    const fill = el.querySelector<HTMLElement>(".fill")!;
    fill.style.width = `${p ? (100 * p.hp) / MAX_HP : 0}%`;
    if (p) el.style.setProperty("--color", PLAYER_CSS_COLORS[p.slot] ?? "#888");
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
    if (this.debug.textContent !== m.debug) this.debug.textContent = m.debug;
  }
}
