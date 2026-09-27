// Account state for the client: a plain store, with no Clerk or Convex code
// in it. Clerk (identity) and Convex (the profile) run in React, in
// ui/account/ClerkRoot.tsx, which is its own lazily loaded chunk: it feeds
// this store through `connect()` and `patch()`. Without
// VITE_CLERK_PUBLISHABLE_KEY that chunk is never loaded, so guests without
// keys never download Clerk, and the game runs in guest mode only.
//
// The game server never trusts a name from the client: net.ts only forwards
// the Clerk token (`getJoinToken`), the server verifies it and looks the
// username up in Convex itself.

import { Store, type Readable } from "./store.ts";

export const PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim() || undefined;
export const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim() || undefined;

export interface Profile {
  username: string;
  createdAt: number;
  stats: { kills: number; deaths: number; wins: number; losses: number; matches: number };
}

export type ClaimResult =
  | { ok: true; username: string }
  | { ok: false; reason: "invalid" | "taken" | "error"; message: string };

export type AccountStatus =
  /** No Clerk key in this build: guests only. */
  | "disabled"
  | "loading"
  /** Clerk failed to load (network, bad key). */
  | "error"
  | "signedOut"
  | "signedIn";

export interface AccountState {
  status: AccountStatus;
  /** Signed in and Convex has answered `users.me` with our token. */
  profileLoaded: boolean;
  profile: Profile | null;
  /** Convex refused or never got a token for this signed-in user. */
  backendError: string;
  /** The name the server gave us in the current room ("Guest-4821", or the username). */
  playingAs: string;
  /** One-off message, e.g. "your session couldn't be verified, playing as a guest". */
  notice: string;
}

/** What the Clerk side (ClerkRoot.tsx) lends to the rest of the app once it has loaded. */
export interface ClerkBridge {
  /** A Clerk token Convex and the game server accept, or undefined. */
  getToken(skipCache: boolean): Promise<string | undefined>;
  openSignIn(): void;
  claimUsername(username: string): Promise<ClaimResult>;
}

const GUEST_KEY = "bagarre.guestName";

/**
 * This browser's guest name, `Guest-` and four digits, drawn once and kept.
 * The menu shows it, and joins ask the server for it (the server only takes
 * names in this format, and draws another if the opponent has the same one).
 */
function loadGuestName(): string {
  try {
    const saved = localStorage.getItem(GUEST_KEY);
    if (saved && /^Guest-\d{4}$/.test(saved)) return saved;
  } catch {
    // Storage blocked: a new name per visit.
  }
  const name = `Guest-${1000 + Math.floor(Math.random() * 9000)}`;
  try {
    localStorage.setItem(GUEST_KEY, name);
  } catch {
    // Ignore.
  }
  return name;
}

export const guestName = loadGuestName();

class Account implements Readable<AccountState> {
  private store = new Store<AccountState>({
    status: PUBLISHABLE_KEY ? "loading" : "disabled",
    profileLoaded: false,
    profile: null,
    backendError: "",
    playingAs: guestName,
    notice: "",
  });
  private bridge: Partial<ClerkBridge> = {};
  private resolveReady: () => void = () => {};
  /** Resolves once Clerk has loaded (or failed, or isn't configured). */
  readonly ready: Promise<void> = PUBLISHABLE_KEY
    ? new Promise((r) => (this.resolveReady = r))
    : Promise.resolve();
  /**
   * Where the account panel wants Clerk's user button: ClerkRoot portals it
   * into this element (the Clerk tree isn't an ancestor of the panel).
   */
  readonly userButtonSlot = new Store<HTMLElement | null>(null);

  getState = () => this.store.getState();
  subscribe = (fn: () => void) => this.store.subscribe(fn);

  get state(): AccountState {
    return this.store.getState();
  }

  /** From ClerkRoot: the account state as Clerk and Convex see it. */
  patch(p: Partial<AccountState>) {
    this.store.patch(p);
    if (this.state.status !== "loading") this.resolveReady();
  }

  /** From ClerkRoot, once Clerk (token, sign-in) and Convex (username claim) are up. */
  connect(part: Partial<ClerkBridge>) {
    this.bridge = { ...this.bridge, ...part };
  }

  /**
   * The token to join a room with, or undefined to join as a guest. Waits a
   * little for Clerk so a signed-in player isn't joined as a guest by accident.
   */
  async getJoinToken(): Promise<string | undefined> {
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, 5000))]);
    if (this.state.status !== "signedIn" || !this.bridge.getToken) return undefined;
    const token = await this.bridge.getToken(true);
    if (!token) this.setNotice("Couldn't get a game token from your session, playing as a guest.");
    return token;
  }

  openSignIn() {
    this.bridge.openSignIn?.();
  }

  async claimUsername(username: string): Promise<ClaimResult> {
    if (!this.bridge.claimUsername) return { ok: false, reason: "error", message: "Profiles aren't configured." };
    return this.bridge.claimUsername(username);
  }

  /** The name the menu shows: the username when signed in with one, else this browser's guest name. */
  get displayName(): string {
    return this.state.profile?.username ?? guestName;
  }

  setPlayingAs(name: string) {
    if (name !== this.state.playingAs) this.store.patch({ playingAs: name });
  }

  setNotice(notice: string) {
    this.store.patch({ notice });
  }
}

export const account = new Account();
