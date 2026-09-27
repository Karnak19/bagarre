// The menu screen (the landing page, `/`): title, Play (quick match),
// private game, the open games list, the account chip and the How to play /
// Settings / Account panels. The live 3D scene behind it is attract.ts.

import {
  DASH,
  GRENADE,
  KILLS_TO_WIN,
  MAPS,
  SHIELD,
  WEAPONS,
  mapById,
} from "@bagarre/shared";
import type { AccountUi } from "./accountUi.ts";
import type { Lobby, LobbyState } from "./lobby.ts";
import { Panels, button, el, icon, kbd, settingsForm } from "./ui.ts";

const WEAPON_ROLES = ["All-rounder", "Close range", "Long range", "Mid range, fast"];

function age(createdAt: number): string {
  const s = Math.max(0, (Date.now() - createdAt) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
}

/** Keys and what they do, for the How to play panel. */
function controls(): HTMLElement {
  const rows: [(string | HTMLElement)[], string][] = [
    [[kbd("W"), kbd("A"), kbd("S"), kbd("D"), " or arrows"], "Move, relative to the screen"],
    [["Mouse"], "Aim"],
    [["Left button"], "Fire (hold)"],
    [[kbd("R")], "Reload (also automatic when empty)"],
    [[kbd("Space")], "Dash"],
    [[kbd("Q")], "Grenade, thrown at the cursor"],
    [[kbd("E")], "Shield"],
    [[kbd("1"), "–", kbd("4")], "Pick a weapon, while dead or between matches"],
    [[kbd("Tab")], "Scoreboard (hold)"],
    [[kbd("M")], "Mute or unmute"],
    [[kbd("Esc")], "Match menu: settings, leave"],
  ];
  const dl = el("dl", "keys");
  for (const [keys, what] of rows) {
    const dt = el("dt");
    dt.append(...keys);
    dl.append(dt, el("dd", "", what));
  }
  return dl;
}

function howToPlay(): HTMLElement {
  const root = el("div", "howto");

  const rules = el("p", "howto-lead");
  rules.textContent = `A 1v1 duel. First to ${KILLS_TO_WIN} kills wins, and the next match starts a few seconds later on another map.`;

  const keysHead = el("h3", "", "Controls");
  const azerty = el("p", "howto-note");
  azerty.append(
    "Keys are read by where they sit on the keyboard, not by their label. On AZERTY you move with ",
    kbd("Z"),
    kbd("Q"),
    kbd("S"),
    kbd("D"),
    " and throw grenades with ",
    kbd("A"),
    ".",
  );

  const wHead = el("h3", "", "Weapons");
  const wNote = el("p", "howto-note", "Your pick goes in your hand on your next spawn.");
  const wList = el("ul", "weapons");
  WEAPONS.forEach((w, i) => {
    const li = el("li");
    const name = el("span", "w-name");
    name.append(kbd(String(i + 1)), w.name);
    const dmg = w.pellets > 1 ? `${w.pellets} × ${w.damage}` : String(w.damage);
    const stats = el("span", "w-stats", `${dmg} dmg · ${w.range} m · ${w.magazine} rounds`);
    li.append(name, el("span", "w-role", WEAPON_ROLES[i] ?? ""), stats);
    wList.append(li);
  });

  const aHead = el("h3", "", "Abilities");
  const aList = el("ul", "abilities");
  const abilities: [HTMLElement, string, string][] = [
    [kbd("Space"), "Dash", `a ${DASH.distance} m burst where you're heading. No invulnerability: get out of the bullet's path. ${DASH.cooldown} s cooldown.`],
    [kbd("Q"), "Grenade", `lobbed up to ${GRENADE.range} m, over cover. It blows ${GRENADE.fuse} s after landing: leave the red circle. Hurts you too. ${GRENADE.cooldown} s cooldown.`],
    [kbd("E"), "Shield", `soaks ${SHIELD.absorb} damage for ${SHIELD.duration} s. ${SHIELD.cooldown} s cooldown.`],
  ];
  for (const [key, name, line] of abilities) {
    const li = el("li");
    const b = el("strong", "", name);
    li.append(key, b, " ", line);
    aList.append(li);
  }

  root.append(rules, keysHead, controls(), azerty, wHead, wList, wNote, aHead, aList);
  return root;
}

export interface MenuActions {
  quickMatch: () => void;
  privateGame: () => void;
  join: (roomId: string) => void;
  /** Any click on a menu button: audio may start from here (autoplay rules). */
  gesture: () => void;
}

export class Menu {
  readonly root = el("div", "screen menu");
  readonly panels: Panels;
  private play: HTMLButtonElement;
  private loading = el("p", "menu-loading");
  private gamesList = el("ul", "games-list");
  private gamesState = el("p", "games-state");
  private settings = settingsForm();

  constructor(
    lobby: Lobby,
    account: AccountUi,
    private actions: MenuActions,
    panels: Panels,
  ) {
    this.panels = panels;
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Main menu");

    // --- Left: title and the actions.
    const main = el("div", "menu-main");
    const brand = el("header", "brand");
    const title = el("h1", "title");
    title.textContent = "Bagarre";
    title.setAttribute("aria-label", "Bagarre");
    const tagline = el("p", "tagline", `Isometric 1v1 duels. First to ${KILLS_TO_WIN} kills.`);
    brand.append(title, tagline);

    this.play = button("", "btn btn-play", () => {
      actions.gesture();
      actions.quickMatch();
    });
    const playLabel = el("span", "btn-play-label", "Play");
    const playSub = el("span", "btn-play-sub", "Quick match");
    this.play.append(playLabel, playSub);
    this.play.setAttribute("aria-label", "Play: quick match");

    const priv = button("", "btn btn-wide", () => {
      actions.gesture();
      actions.privateGame();
    });
    priv.innerHTML = `${icon("lock")}<span class="btn-col"><span>Private game</span><span class="btn-sub">Play a friend with a link</span></span>`;

    const links = el("div", "menu-links");
    const openPanel = (name: string) => () => {
      actions.gesture();
      this.panels.open(name);
    };
    const howBtn = button("How to play", "btn btn-quiet", openPanel("howto"));
    const setBtn = button("Settings", "btn btn-quiet", openPanel("settings"));
    howBtn.setAttribute("aria-haspopup", "dialog");
    setBtn.setAttribute("aria-haspopup", "dialog");
    links.append(howBtn, setBtn);

    const actionsBox = el("div", "menu-actions");
    actionsBox.append(this.play, priv, links, this.loading);

    const touch = el("p", "touch-note");
    touch.innerHTML = `${icon("keyboard", 20)}<span>Bagarre is played with a keyboard and a mouse. Have a look around here, then come back on a computer to play.</span>`;
    touch.hidden = !Menu.isTouchOrSmall();

    const maps = el("p", "maps-row");
    const count = el("strong", "", `${MAPS.length} maps`);
    maps.append(count, " ", MAPS.map((m) => m.name).join(" · "));

    main.append(brand, touch, actionsBox, maps);

    // --- Right: account and open games.
    const side = el("aside", "menu-side");
    account.chip.addEventListener("click", () => {
      actions.gesture();
      this.panels.open("account");
    });
    const games = el("section", "games");
    games.setAttribute("aria-labelledby", "games-title");
    const gamesHead = el("h2", "games-title", "Open games");
    gamesHead.id = "games-title";
    const gamesHint = el("p", "games-hint", "Players waiting for an opponent. Pick one to join.");
    this.gamesList.setAttribute("aria-live", "polite");
    games.append(gamesHead, gamesHint, this.gamesList, this.gamesState);
    side.append(account.chip, games);

    this.root.append(main, side);
    document.body.append(this.root);

    this.panels.define("howto", { title: "How to play", body: howToPlay() });
    this.panels.define("settings", { title: "Settings", body: this.settings.root, onOpen: () => this.settings.refresh() });
    this.panels.define("account", { title: "Account", body: account.panel, focus: () => account.focusTarget });

    addEventListener("resize", () => (touch.hidden = !Menu.isTouchOrSmall()));
    lobby.subscribe((s) => this.renderGames(s));
    this.renderGames(lobby.getState());
  }

  /** A phone or tablet (no fine pointer), or a window too small to play in. */
  static isTouchOrSmall(): boolean {
    const coarse = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
    return coarse || innerWidth < 760 || innerHeight < 480;
  }

  get shown() {
    return !this.root.hidden;
  }

  show(focusPlay = false) {
    this.root.hidden = false;
    if (focusPlay) this.play.focus({ preventScroll: true });
  }

  hide() {
    this.root.hidden = true;
    if (this.panels.current) this.panels.close();
  }

  /** Asset loading progress under Play (null: done). */
  setLoading(fraction: number | null) {
    this.loading.hidden = fraction === null;
    if (fraction !== null) this.loading.textContent = `Loading the arena… ${Math.round(fraction * 100)}%`;
  }

  private renderGames({ games, error: err, loaded }: LobbyState) {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.room : undefined;
    this.gamesList.replaceChildren(
      ...games.map((g) => {
        const li = el("li");
        const b = button("", "game-item", () => {
          this.actions.gesture();
          this.actions.join(g.roomId);
        });
        b.dataset.room = g.roomId;
        const host = el("span", "game-host", g.hostName || "Someone");
        const meta = el("span", "game-meta", `${mapById(g.mapId).name} · ${age(g.createdAt)}`);
        const col = el("span", "game-col");
        col.append(host, meta);
        const join = el("span", "game-join", "Join");
        b.append(col, join);
        b.setAttribute("aria-label", `Join ${g.hostName || "a player"} on ${mapById(g.mapId).name}, waiting ${age(g.createdAt)}`);
        li.append(b);
        return li;
      }),
    );
    if (focused) this.gamesList.querySelector<HTMLElement>(`[data-room="${CSS.escape(focused)}"]`)?.focus();
    this.gamesState.hidden = games.length > 0 || !loaded;
    this.gamesState.classList.toggle("is-error", !!err);
    this.gamesState.textContent = err
      ? "Can't reach the game server right now."
      : "No one is waiting right now. Press Play to open a game others can join.";
  }
}
