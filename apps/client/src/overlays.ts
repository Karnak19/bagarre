// In-game cards over the live scene, one at a time: joining, waiting for an
// opponent (with the invite link), the Esc menu, the match result, and the
// "this game is full / gone" notices. Plus the Tab scoreboard. While any card
// is up the game's input is off (main.ts), the match itself keeps running.

import { MATCH_END_DELAY, type PlayerView } from "@bagarre/shared";
import type { AppState, GameView, Notice } from "./app.ts";
import { PLAYER_CSS_COLORS } from "./scene.ts";
import { Scoreboard, scoreboardModel } from "./scoreboard.ts";
import { button, el, icon, kbd, setText, weaponPicker } from "./ui.ts";

/** The card on screen (the DOM's, not the flow's: see GameView.card in app.ts). */
export type Card = "none" | "joining" | "waiting" | "pause" | "result" | "notice";

export interface OverlayActions {
  /** Cancel, Leave match, Main menu, Back to menu. */
  leave: () => void;
  retry: () => void;
  resume: () => void;
  settings: () => void;
  rematch: () => void;
  pick: (weapon: number) => void;
}

async function copyText(text: string, fallbackInput: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallbackInput.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

export class Overlays {
  readonly root = el("div", "overlay-layer");
  card: Card = "none";
  private cards = new Map<Card, HTMLElement>();

  // Joining.
  private joinTitle = el("h2", "card-title");
  private joinSub = el("p", "card-sub");

  // Waiting.
  private waitTitle = el("h2", "card-title");
  private waitSub = el("p", "card-sub");
  private waitPlayers = el("ul", "seats");
  private inviteInput = el("input", "invite-url");
  private copyBtn: HTMLButtonElement;
  private waitPicker: ReturnType<typeof weaponPicker>;
  private seatKey = "";

  // Pause.
  private resumeBtn: HTMLButtonElement;

  // Result.
  private resultTitle = el("h2", "card-title result-title");
  private resultSub = el("p", "card-sub");
  private rematchBtn: HTMLButtonElement;
  private resultPicker: ReturnType<typeof weaponPicker>;
  private resultBoard = new Scoreboard("Match result");
  private resultFull = el("div", "result-full");

  // Notice.
  private noticeTitle = el("h2", "card-title");
  private noticeBody = el("p", "card-sub");
  private noticeActions = el("div", "card-actions");

  // Tab scoreboard.
  readonly board = new Scoreboard();
  private boardLayer = el("div", "scoreboard-layer");

  private shownNotice: Notice | null = null;

  constructor(private actions: OverlayActions) {
    this.root.hidden = true;

    // --- Joining
    {
      const c = this.makeCard("joining");
      const spin = el("div", "spinner");
      spin.setAttribute("aria-hidden", "true");
      c.append(spin, this.joinTitle, this.joinSub, this.row(button("Cancel", "btn", () => actions.leave())));
      c.setAttribute("aria-live", "polite");
    }

    // --- Waiting
    {
      const c = this.makeCard("waiting");
      const spin = el("div", "spinner");
      spin.setAttribute("aria-hidden", "true");
      const head = el("div", "card-head");
      const headText = el("div");
      headText.append(this.waitTitle, this.waitSub);
      head.append(spin, headText);
      this.waitTitle.setAttribute("aria-live", "polite");

      const inviteLabel = el("label", "field-label", "Invite link");
      inviteLabel.htmlFor = "invite-url";
      this.inviteInput.id = "invite-url";
      this.inviteInput.readOnly = true;
      this.inviteInput.addEventListener("focus", () => this.inviteInput.select());
      this.copyBtn = button("", "btn btn-blue btn-copy", () => void this.copyInvite());
      this.setCopyLabel(false);
      const invite = el("div", "invite");
      invite.append(this.inviteInput, this.copyBtn);

      const pickLabel = el("p", "field-label", "Your weapon");
      this.waitPicker = weaponPicker((w) => actions.pick(w));

      const seatsLabel = el("p", "field-label", "Players");
      c.append(
        head,
        seatsLabel,
        this.waitPlayers,
        inviteLabel,
        invite,
        pickLabel,
        this.waitPicker.root,
        this.row(button("Cancel", "btn", () => actions.leave())),
      );
    }

    // --- Pause (Esc)
    {
      const c = this.makeCard("pause");
      const title = el("h2", "card-title", "Match menu");
      const note = el("p", "card-sub");
      note.innerHTML = `${icon("users", 16)}<span>This is multiplayer: there's no pause. The match keeps running while this is open.</span>`;
      note.classList.add("card-warn");
      this.resumeBtn = button("Resume", "btn btn-primary", () => actions.resume());
      const settings = button("Settings", "btn", () => actions.settings());
      settings.setAttribute("aria-haspopup", "dialog");
      const leave = button("Leave match", "btn btn-danger", () => actions.leave());
      const list = el("div", "card-stack");
      list.append(this.resumeBtn, settings, leave);
      const hint = el("p", "card-hint");
      hint.append(kbd("Esc"), " goes back to the game.");
      c.append(title, note, list, hint);
    }

    // --- Result
    {
      const c = this.makeCard("result");
      c.classList.add("card-wide");
      this.rematchBtn = button("Rematch", "btn btn-primary", () => actions.rematch());
      const menuBtn = button("Main menu", "btn", () => actions.leave());
      this.resultPicker = weaponPicker((w) => actions.pick(w));
      const pickLabel = el("p", "field-label", "Weapon for the next match");
      this.resultFull.append(this.resultBoard.root, pickLabel, this.resultPicker.root);
      const acts = this.row(this.rematchBtn, menuBtn);
      c.append(this.resultTitle, this.resultSub, this.resultFull, acts);
    }

    // --- Notice
    {
      const c = this.makeCard("notice");
      c.append(this.noticeTitle, this.noticeBody, this.noticeActions);
    }

    this.boardLayer.hidden = true;
    this.boardLayer.setAttribute("role", "dialog");
    this.boardLayer.setAttribute("aria-label", "Scoreboard");
    this.boardLayer.append(this.board.root);

    document.body.append(this.root, this.boardLayer);
  }

  private makeCard(name: Card): HTMLElement {
    const c = el("section", `card card-${name}`);
    c.hidden = true;
    c.setAttribute("role", "dialog");
    c.setAttribute("aria-modal", "true");
    this.cards.set(name, c);
    this.root.append(c);
    return c;
  }

  private row(...children: HTMLElement[]) {
    const r = el("div", "card-actions");
    r.append(...children);
    return r;
  }

  private setCopyLabel(copied: boolean) {
    this.copyBtn.innerHTML = copied ? `${icon("check", 16)}<span>Copied</span>` : `${icon("copy", 16)}<span>Copy invite link</span>`;
  }

  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private async copyInvite() {
    const ok = await copyText(this.inviteInput.value, this.inviteInput);
    this.setCopyLabel(ok);
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.setCopyLabel(false), 2000);
  }

  /** Shows one card (or none). Focus moves into a card when it appears, and leaves it when the card goes. */
  private show(card: Card, focus?: HTMLElement | null) {
    if (this.card === card) return;
    const had = this.card !== "none";
    for (const [name, c] of this.cards) c.hidden = name !== card;
    this.card = card;
    this.root.hidden = card === "none";
    this.root.dataset.card = card;
    if (card === "none") {
      // Nothing focused while playing: Space and Enter must not press a stale button.
      if (had && document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement))
        document.activeElement.blur();
      return;
    }
    const target = focus ?? this.cards.get(card)?.querySelector<HTMLElement>("button:not([disabled])");
    target?.focus({ preventScroll: true });
  }

  private hide() {
    this.show("none");
  }

  private showJoining(title: string, sub: string) {
    setText(this.joinTitle, title);
    setText(this.joinSub, sub);
    this.show("joining");
  }

  private showPause() {
    this.show("pause", this.resumeBtn);
  }

  /** Draws whatever the app state says: call on every state change and every frame in a game. */
  render(s: AppState, v: GameView | null) {
    if (s.screen === "joining") this.showJoining(s.joining.title, s.joining.sub);
    else if (s.screen === "notice" && s.notice) this.showNotice(s.notice);
    else if (s.screen === "game" && v) {
      if (v.card === "pause") this.showPause();
      else if (v.card === "loading") this.showJoining("Joining the game…", "");
      else if (v.card === "waiting") this.showWaiting(s, v);
      else if (v.card === "result") this.showResult(s, v);
      else this.hide();
    } else this.hide();
    const board = s.screen === "game" && !!v && v.card === "none" && s.scoreboardHeld;
    if (board && v) this.board.update(scoreboardModel(v.snapshot, v.you));
    if (this.boardLayer.hidden === board) this.boardLayer.hidden = !board;
  }

  private showNotice(n: Notice) {
    if (this.shownNotice !== n) {
      this.shownNotice = n;
      this.noticeTitle.textContent = n.title;
      this.noticeBody.textContent = n.body;
      const back = button("Back to menu", n.retry ? "btn" : "btn btn-primary", () => this.actions.leave());
      const retry = n.retry ? [button("Try again", "btn btn-primary", () => this.actions.retry())] : [];
      this.noticeActions.replaceChildren(...retry, back);
      this.card = "none"; // refocus on the new buttons
    }
    this.show("notice");
  }

  private showWaiting(s: AppState, v: GameView) {
    if (s.opponentLeft) {
      setText(this.waitTitle, "Your opponent left");
      setText(this.waitSub, s.isPrivate ? "Waiting for someone to join with the link…" : "Looking for a new opponent…");
    } else if (s.isPrivate) {
      setText(this.waitTitle, "Waiting for your friend…");
      setText(this.waitSub, "Send them the link. The match starts as soon as they join.");
    } else {
      setText(this.waitTitle, "Looking for an opponent…");
      setText(this.waitSub, "Anyone can join from the menu's open games, or send a friend the link.");
    }
    if (this.inviteInput.value !== s.inviteUrl) this.inviteInput.value = s.inviteUrl;

    const players: PlayerView[] = [];
    v.snapshot?.players.forEach((p) => players.push(p));
    players.sort((a, b) => a.slot - b.slot);
    const me = v.snapshot?.players.get(v.you);
    const key = players.map((p) => `${p.slot}:${p.name}:${p === me}`).join("|");
    if (key !== this.seatKey) {
      this.seatKey = key;
      const seats = players.map((p) => {
        const li = el("li", "seat");
        const dot = el("span", "seat-dot");
        dot.style.background = PLAYER_CSS_COLORS[p.slot] ?? "#888";
        li.append(dot, el("span", "seat-name", p === me ? `${p.name} (you)` : p.name));
        return li;
      });
      while (seats.length < 2) {
        const li = el("li", "seat seat-open");
        li.append(el("span", "seat-dot"), el("span", "seat-name", "Open seat"));
        seats.push(li);
      }
      this.waitPlayers.replaceChildren(...seats);
    }
    this.waitPicker.update(v.pick, v.canPick);
    this.show("waiting");
  }

  private showResult(s: AppState, v: GameView) {
    const snap = v.snapshot;
    if (!snap) return;
    const won = snap.winner === v.you;
    const card = this.cards.get("result")!;
    setText(this.resultTitle, won ? "You win!" : "You lose");
    card.classList.toggle("is-win", won);
    const left = Math.max(0, Math.ceil(MATCH_END_DELAY - (performance.now() - v.endedAt) / 1000));
    setText(
      this.resultSub,
      s.staying ? `Rematch in ${left} s, same game, next map.` : `Next match in ${left} s. Stay for a rematch, or head back to the menu.`,
    );
    this.resultBoard.update(scoreboardModel(snap, v.you));
    this.resultPicker.update(v.pick, v.canPick);
    this.rematchBtn.disabled = s.staying;
    setText(this.rematchBtn, s.staying ? "Staying" : "Rematch");
    card.classList.toggle("is-staying", s.staying);
    this.show("result", this.rematchBtn);
  }

  get boardOpen() {
    return !this.boardLayer.hidden;
  }
}
