// The app's flow, with no DOM in it: which screen is up, joining and leaving
// rooms, and the per-game flags (paused, rematch pressed, opponent left,
// scoreboard held). The React views (ui/) read `getState()` / `gameView()`
// and call the actions; they never touch the network or the rooms
// themselves. The routes belong to TanStack Router (routes/): the route
// lifecycle calls `routeMenu()` / `routeGame()`, and this store moves between
// pages through the `Navigator` it is given (router.tsx).
//
//   menu ──Play / Private / a listed game──▶ joining ──▶ game ──Leave / Main menu / Back──▶ menu
//     ▲                                        │         (waiting ⇄ playing ⇄ ended are the server's
//     └──────── Cancel / Back to menu ◀────────┴─ notice  phases; the Esc menu goes on top of any)
//
// Opening `/game/<code>` directly (or coming back to it with Forward) starts
// at `joining` for that room.
//
// Pages and joins:
// - `/` entered (boot, Back, Main menu): `routeMenu()` leaves any room.
// - `/game/<code>` entered or its code changed: `routeGame(code)` joins that
//   room, unless it is the one we are already in.
// - Play / Private game run on `/`; once the room is joined the store pushes
//   its page (`nav.toGame`), whose `routeGame` is then a no-op.

import type { Phase } from "@bagarre/shared";
import { guestName } from "./auth.ts";
import type { Match } from "./match.ts";
import { JoinError, Net, joinGame, type JoinRequest, type Snapshot } from "./net.ts";

/** How the flow moves between pages (implemented on TanStack Router in router.tsx). */
export interface Navigator {
  /** Pushes `/game/<code>` (a new history entry: Back returns to the menu). */
  toGame(code: string): void;
  /** Back to `/`: `history.back()` if this page was reached from the menu, else a replace. */
  toMenu(): void;
  /** The current page is a game page. */
  onGamePage(): boolean;
  /** The shareable link to a game. */
  inviteUrl(code: string): string;
}

/** Room ids are Colyseus' 9-character ids; anything else can't be a game. */
export const GAME_CODE = /^[A-Za-z0-9_-]{1,32}$/;

export type Screen = "menu" | "joining" | "game" | "notice";

/** The card shown over a game: none while playing. */
export type GameCard = "none" | "loading" | "waiting" | "pause" | "result";

export interface Notice {
  title: string;
  body: string;
  /** What "Try again" would do (null: no retry, only "Back to menu"). */
  retry: JoinRequest | null;
}

export interface AppState {
  screen: Screen;
  /** Title and line of the joining card. */
  joining: { title: string; sub: string };
  notice: Notice | null;
  /** The Esc menu is open (the match goes on underneath). */
  paused: boolean;
  /** Rematch pressed on the result card; cleared when the next match starts. */
  staying: boolean;
  /** The room went back to waiting after a match: the opponent left. */
  opponentLeft: boolean;
  /** Tab held: the scoreboard is up. */
  scoreboardHeld: boolean;
  /** The current game's room id ("" when not in one), its invite link, and whether we created it private. */
  roomId: string;
  inviteUrl: string;
  isPrivate: boolean;
}

/** What the game's cards need each frame, from the latest snapshot. */
export interface GameView {
  card: GameCard;
  phase: Phase;
  snapshot: Snapshot | null;
  you: string;
  /** performance.now() when the match ended (the rematch countdown). */
  endedAt: number;
  pick: number;
  canPick: boolean;
}

/** The parts of the 3D side the flow drives. */
export interface Engine {
  /** Resolves once models and props are loaded and the scene exists. */
  ready: Promise<unknown>;
  /** The menu is up: show the attract scene. */
  enterMenu(): void;
  /** A room was joined: stop the attract scene and make the match. */
  createMatch(net: Net): Match;
}

export interface AppConfig {
  serverUrl: string;
  lagMs: number;
  /** The dev `?map=` choice, passed to every join. */
  mapParam: string | null;
  nav: Navigator;
}

const initialState: AppState = {
  screen: "menu",
  joining: { title: "", sub: "" },
  notice: null,
  paused: false,
  staying: false,
  opponentLeft: false,
  scoreboardHeld: false,
  roomId: "",
  inviteUrl: "",
  isPrivate: false,
};

function joinLabels(req: JoinRequest): { title: string; sub: string } {
  if (req.kind === "quick") return { title: "Finding a game…", sub: "Joining an open game, or opening a new one." };
  if (req.kind === "private") return { title: "Creating your private game…", sub: "You'll get a link to send a friend." };
  return { title: "Joining the game…", sub: `Game ${req.roomId}` };
}

export class App {
  private state: AppState = initialState;
  private listeners = new Set<(s: AppState) => void>();
  private current: Match | null = null;
  /** Bumped by every join and every cancel: a join that resolves late with an old number is dropped. */
  private joinToken = 0;
  private lastPhase: Phase | "" = "";

  constructor(
    private engine: Engine,
    private config: AppConfig,
  ) {}

  // --- State ---------------------------------------------------------------------

  getState(): AppState {
    return this.state;
  }

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /** The game being played, or null. */
  get match(): Match | null {
    return this.current;
  }

  /**
   * Call once per frame while in a game: follows the server's phase (opponent
   * left, rematch flag) and returns what the cards should show.
   */
  gameView(): GameView | null {
    const m = this.current;
    if (!m || this.state.screen !== "game") return null;
    const snapshot = m.latest;
    const phase: Phase = snapshot?.phase ?? "waiting";
    if (phase !== this.lastPhase) {
      const was = this.lastPhase;
      this.lastPhase = phase;
      if (phase === "waiting" && (was === "playing" || was === "ended")) this.set({ opponentLeft: true });
      if (phase === "playing" && (this.state.opponentLeft || this.state.staying)) this.set({ opponentLeft: false, staying: false });
    }
    let card: GameCard = "none";
    if (this.state.paused) card = "pause";
    else if (!snapshot) card = "loading";
    else if (phase === "waiting") card = "waiting";
    else if (phase === "ended") card = "result";
    if (card !== "none" && this.state.scoreboardHeld) this.set({ scoreboardHeld: false });
    const me = m.me;
    return { card, phase, snapshot, you: m.net.sessionId, endedAt: m.endedAt, pick: me?.pick ?? 0, canPick: m.canPick };
  }

  // --- Actions -----------------------------------------------------------------------

  /** Route lifecycle: `/` was entered. Leaves whatever game was up. */
  routeMenu() {
    if (this.state.screen !== "menu") this.showMenu();
    else this.engine.enterMenu();
  }

  /** Route lifecycle: `/game/<code>` was entered (or its code changed). */
  routeGame(code: string) {
    if (!GAME_CODE.test(code)) {
      this.joinToken++;
      this.leaveRoom();
      this.showNotice({
        title: "This game doesn't exist anymore",
        body: "That link isn't a game link. Start a new game from the menu.",
        retry: null,
      });
      return;
    }
    if (this.current?.net.roomId === code) return;
    void this.join({ kind: "id", roomId: code });
  }

  quickMatch() {
    void this.join({ kind: "quick" });
  }

  privateGame() {
    void this.join({ kind: "private" });
  }

  /** A game from the open games list: its page, whose route then joins it. */
  joinListed(roomId: string) {
    this.config.nav.toGame(roomId);
  }

  retry() {
    const req = this.state.notice?.retry;
    if (req) void this.join(req);
  }

  /** Cancel, Leave match, Main menu, Back to menu: leave whatever is going on and go to `/`. */
  leave() {
    if (this.config.nav.onGamePage()) this.config.nav.toMenu();
    else this.showMenu();
  }

  setPaused(paused: boolean) {
    if (this.state.screen !== "game" || paused === this.state.paused) return;
    this.set({ paused, scoreboardHeld: false });
  }

  togglePause() {
    this.setPaused(!this.state.paused);
  }

  rematch() {
    if (this.state.screen === "game") this.set({ staying: true });
  }

  pick(weapon: number) {
    this.current?.pick(weapon);
  }

  holdScoreboard(held: boolean) {
    if (held === this.state.scoreboardHeld) return;
    if (held && (this.state.screen !== "game" || this.state.paused)) return;
    this.set({ scoreboardHeld: held });
  }

  // --- Internals ---------------------------------------------------------------------

  private leaveRoom() {
    const m = this.current;
    this.current = null;
    this.lastPhase = "";
    if (m) {
      m.dispose();
      void m.net.leave();
    }
  }

  private showMenu() {
    this.joinToken++;
    this.leaveRoom();
    this.set({ ...initialState, screen: "menu" });
    this.engine.enterMenu();
  }

  private showNotice(notice: Notice) {
    this.set({ ...initialState, screen: "notice", notice });
  }

  private async join(req: JoinRequest) {
    this.leaveRoom();
    const token = ++this.joinToken;
    this.set({ ...initialState, screen: "joining", joining: joinLabels(req) });
    const options: Record<string, unknown> = { guestName };
    if (this.config.mapParam) options.map = this.config.mapParam;
    try {
      const [room] = await Promise.all([joinGame(this.config.serverUrl, req, options), this.engine.ready]);
      if (token !== this.joinToken) {
        // Cancelled (or replaced by another join) meanwhile: leave at once.
        await new Net(room, 0).leave();
        return;
      }
      const net = new Net(room, this.config.lagMs);
      net.onClosed = () => {
        if (this.current?.net !== net) return;
        this.leaveRoom();
        this.showNotice({ title: "Connection lost", body: "The game server closed the connection.", retry: null });
      };
      this.current = this.engine.createMatch(net);
      this.set({
        screen: "game",
        roomId: room.roomId,
        inviteUrl: this.config.nav.inviteUrl(room.roomId),
        isPrivate: req.kind === "private",
      });
      // Play / Private game joined from the menu: now the game has a page.
      if (req.kind !== "id") this.config.nav.toGame(room.roomId);
    } catch (err) {
      if (token !== this.joinToken) return;
      const e = err instanceof JoinError ? err : new JoinError("error", String(err));
      console.warn("[join]", e.reason, e.message);
      if (e.reason === "full")
        this.showNotice({ title: "This game is full", body: "Both seats are taken. Join another game from the menu, or start your own.", retry: null });
      else if (e.reason === "gone")
        this.showNotice({ title: "This game doesn't exist anymore", body: "Everyone left, or the link is wrong. Start a new game from the menu.", retry: null });
      else if (e.reason === "unreachable")
        this.showNotice({ title: "Can't reach the game server", body: `Nothing answered at ${this.config.serverUrl}. Check your connection and try again.`, retry: req });
      else this.showNotice({ title: "Couldn't join the game", body: e.message, retry: req });
    }
  }
}
