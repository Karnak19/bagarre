// Account state for the client: a plain store (getState / subscribe, like
// the other flow stores), read by the menu's account chip, the account panel
// and net.ts' joins.
//
// Accounts live on the game server itself (@colyseus/auth plus the game's
// own routes, see @bagarre/shared's accounts.ts). One long-lived
// `@colyseus/sdk` Client, pointed at the same server as the rooms, does all
// of it: `client.auth.*` signs up, in and out and keeps the session token in
// localStorage ("colyseus-auth-token"), and `client.http` calls the game's
// routes with that token as a Bearer header.
//
// The game server never trusts a name from the client: net.ts only forwards
// the token (`getJoinToken`), the server checks it and reads the username
// itself. A bad or expired token joins as a guest.

import { Client } from "@colyseus/sdk";
import {
  ACCOUNT_ROUTE,
  AUTH_PROVIDERS_ROUTE,
  LEADERBOARD_ROUTE,
  PASSWORD_MIN,
  RESET_PASSWORD_ROUTE,
  USERNAME_ROUTE,
  type Account,
  type AuthProviders,
  type ClaimResult,
  type LeaderboardEntry,
  type ResetPasswordResult,
} from "@bagarre/shared";
import { resolveServerUrl } from "./config.ts";
import { Store, type Readable } from "./store.ts";

export type { Account, LeaderboardEntry };

/** A username claim, or why it didn't go through (`error`: the server couldn't be asked). */
export type ClaimOutcome = ClaimResult | { ok: false; reason: "error"; message: string };

export type AccountStatus =
  /** A stored session is being checked with the server. */
  | "loading"
  /** A session is stored, but the server couldn't be reached to check it. */
  | "error"
  | "signedOut"
  | "signedIn";

export interface AccountState {
  status: AccountStatus;
  /** The signed-in account, fresh from GET /account (null unless `signedIn`). */
  account: Account | null;
  /** The sign-in providers the server offers besides email and password. */
  providers: AuthProviders;
  /** The name the server gave us in the current room ("Guest-4821", or the username). */
  playingAs: string;
  /** One-off message, e.g. "your session expired, sign in again". */
  notice: string;
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

/** Emails are compared lowercased and trimmed (the server does the same). */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const UNREACHABLE = "Couldn't reach the game server. Check your connection and try again.";

interface HttpError {
  code?: unknown;
  status?: number;
  message?: string;
  data?: { error?: unknown; code?: unknown; message?: unknown };
}

/** The HTTP status of an SDK error (a ServerError's `code`), or undefined when the request never got an answer. */
function statusOf(err: unknown): number | undefined {
  const e = err as HttpError;
  if (typeof e?.status === "number") return e.status;
  return typeof e?.code === "number" && e.code >= 100 && e.code < 600 ? e.code : undefined;
}

/**
 * A sentence for an error from sign up / sign in. @colyseus/auth answers
 * with a code (`email_already_in_use`, `invalid_credentials`...), which the
 * SDK puts in the error's message (and `data.error`); validation failures may
 * wrap it in a longer message.
 */
export function authErrorMessage(err: unknown): string {
  if (statusOf(err) === undefined) return UNREACHABLE;
  const e = err as HttpError;
  const text = [e?.message, e?.data?.error, e?.data?.code, e?.data?.message].filter((v) => typeof v === "string").join(" ");
  if (text.includes("email_already_in_use")) return "An account already uses this email. Sign in instead?";
  if (text.includes("invalid_credentials")) return "Wrong email or password.";
  if (text.includes("email_malformed")) return "That doesn't look like an email address.";
  if (text.includes("password_too_short")) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (text.includes("banned")) return "This account is banned.";
  return `Something went wrong${e?.message ? `: ${e.message}` : ""}.`;
}

/** Checks the form before asking the server. Returns an error message, or null. */
export function credentialsError(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+$/.test(normalizeEmail(email))) return "Enter your email address.";
  if (password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  return null;
}

class AccountStore implements Readable<AccountState> {
  /** The one SDK client for accounts. Rooms get their own (net.ts), with this one's token. */
  readonly client = new Client(resolveServerUrl());
  private store = new Store<AccountState>({
    status: this.client.auth.token ? "loading" : "signedOut",
    account: null,
    providers: { discord: false },
    playingAs: guestName,
    notice: "",
  });
  /** Bumped by every refresh and sign-out, so a late answer never overwrites a newer state. */
  private generation = 0;
  /** The first check of a stored session; joins wait a little for it. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.refresh();
    void this.client.http
      .get(AUTH_PROVIDERS_ROUTE)
      .then((res) => this.store.patch({ providers: { discord: (res.data as AuthProviders | undefined)?.discord === true } }))
      .catch(() => {
        // Unreachable: email and password only, which will say so when used.
      });
  }

  getState = () => this.store.getState();
  subscribe = (fn: () => void) => this.store.subscribe(fn);

  get state(): AccountState {
    return this.store.getState();
  }

  get token(): string | undefined {
    return this.client.auth.token || undefined;
  }

  /**
   * Reads the account again (GET /account): after signing in, after a match
   * (fresh stats), when the panel opens. A refused token signs out; an
   * unreachable server keeps the session (status `error`).
   */
  async refresh(): Promise<void> {
    const gen = ++this.generation;
    if (!this.token) {
      this.store.patch({ status: "signedOut", account: null });
      return;
    }
    if (this.state.status !== "signedIn") this.store.patch({ status: "loading" });
    try {
      const res = await this.client.http.get(ACCOUNT_ROUTE);
      if (gen !== this.generation) return;
      const found = (res.data as { account?: Account } | undefined)?.account;
      if (!found) throw new Error("no account in the answer");
      this.store.patch({ status: "signedIn", account: found });
    } catch (err) {
      if (gen !== this.generation) return;
      if (statusOf(err) === 401) {
        void this.client.auth.signOut();
        this.store.patch({ status: "signedOut", account: null, notice: "Your session has expired. Sign in again." });
      } else {
        console.warn("[auth] couldn't load the account", err);
        this.store.patch({ status: this.state.status === "signedIn" ? "signedIn" : "error" });
      }
    }
  }

  /** Creates an account and signs in with it. Resolves with an error message, or null. */
  async signUp(email: string, password: string): Promise<string | null> {
    const invalid = credentialsError(email, password);
    if (invalid) return invalid;
    try {
      await this.client.auth.registerWithEmailAndPassword(normalizeEmail(email), password);
    } catch (err) {
      return authErrorMessage(err);
    }
    this.store.patch({ notice: "" });
    await this.refresh();
    return null;
  }

  /** Resolves with an error message, or null once signed in. */
  async signIn(email: string, password: string): Promise<string | null> {
    if (!normalizeEmail(email)) return "Enter your email address.";
    if (!password) return "Enter your password.";
    try {
      await this.client.auth.signInWithEmailAndPassword(normalizeEmail(email), password);
    } catch (err) {
      return authErrorMessage(err);
    }
    this.store.patch({ notice: "" });
    await this.refresh();
    return null;
  }

  /** Discord, in a popup. Resolves with an error message, or null (signed in, or the popup was closed). */
  async signInWithDiscord(): Promise<string | null> {
    try {
      await this.client.auth.signInWithProvider("discord");
    } catch (err) {
      if (err === "cancelled") return null;
      return authErrorMessage(err);
    }
    this.store.patch({ notice: "" });
    await this.refresh();
    return null;
  }

  /** Asks for a reset link. The server always says yes (it never tells whether an email has an account). */
  async forgotPassword(email: string): Promise<string | null> {
    if (!/^[^\s@]+@[^\s@]+$/.test(normalizeEmail(email))) return "Enter your email address.";
    try {
      await this.client.auth.sendPasswordResetEmail(normalizeEmail(email));
      return null;
    } catch (err) {
      return statusOf(err) === undefined ? UNREACHABLE : authErrorMessage(err);
    }
  }

  /** Sets a new password from the emailed link's token. */
  async resetPassword(token: string, password: string): Promise<ResetPasswordResult> {
    if (password.length < PASSWORD_MIN) return { ok: false, message: `Passwords need at least ${PASSWORD_MIN} characters.` };
    try {
      const res = await this.client.http.post(RESET_PASSWORD_ROUTE, { body: { token, password } });
      return res.data as ResetPasswordResult;
    } catch (err) {
      return { ok: false, message: statusOf(err) === undefined ? UNREACHABLE : authErrorMessage(err) };
    }
  }

  async signOut(): Promise<void> {
    this.generation++;
    await this.client.auth.signOut();
    this.store.patch({ status: "signedOut", account: null, notice: "" });
  }

  async claimUsername(username: string): Promise<ClaimOutcome> {
    if (!this.token) return { ok: false, reason: "error", message: "Sign in first." };
    try {
      const res = await this.client.http.post(USERNAME_ROUTE, { body: { username } });
      const result = res.data as ClaimResult;
      const current = this.state.account;
      if (result.ok && current) {
        // A refresh() already in flight would reset the username to its stale null.
        this.generation++;
        this.store.patch({ account: { ...current, username: result.username } });
      }
      return result;
    } catch (err) {
      if (statusOf(err) === 401) void this.refresh();
      return { ok: false, reason: "error", message: statusOf(err) === undefined ? UNREACHABLE : authErrorMessage(err) };
    }
  }

  /** The top accounts by wins. */
  async leaderboard(): Promise<LeaderboardEntry[]> {
    const res = await this.client.http.get(LEADERBOARD_ROUTE);
    const entries = (res.data as { entries?: LeaderboardEntry[] } | undefined)?.entries;
    return Array.isArray(entries) ? entries : [];
  }

  /**
   * The token to join a room with, or undefined to join as a guest. Waits a
   * little for the first session check, so a signed-in player isn't joined as
   * a guest by accident. Read on every join: signing in or out from the menu
   * applies to the next game.
   */
  async getJoinToken(): Promise<string | undefined> {
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, 5000))]);
    const { status } = this.state;
    return status === "signedOut" ? undefined : this.token;
  }

  /** The name the menu shows: the username when signed in with one, else this browser's guest name. */
  get displayName(): string {
    return (this.state.status === "signedIn" && this.state.account?.username) || guestName;
  }

  /**
   * What the server made of us in a room: our name, and whether it saw an
   * account with a username. Signed in with one, but seen as a guest: say so.
   */
  setPlayingAs(name: string, asAccount?: boolean) {
    if (name !== this.state.playingAs) {
      this.store.patch({ playingAs: name });
      if (asAccount === false && this.state.status === "signedIn" && this.state.account?.username)
        this.setNotice("Your session couldn't be verified, so you're playing as a guest.");
    }
  }

  setNotice(notice: string) {
    this.store.patch({ notice });
  }
}

export const account = new AccountStore();
