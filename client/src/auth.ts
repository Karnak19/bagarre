// Account state for the client: Clerk (identity) and Convex (profile).
//
// Everything here is optional. Without VITE_CLERK_PUBLISHABLE_KEY the game
// runs in guest mode only and the widget says sign-in isn't configured. Clerk
// is loaded with a dynamic import, so guests without keys never download it.
//
// The game server never trusts a name from the client: net.ts only forwards
// the Clerk token (`getJoinToken`), the server verifies it and looks the
// username up in Convex itself.

import type { Clerk } from "@clerk/clerk-js";
import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const PUBLISHABLE_KEY = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim();
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim();

export interface Profile {
  username: string;
  createdAt: number;
  stats: { kills: number; deaths: number; wins: number; losses: number; matches: number };
}

export type ClaimResult =
  | { ok: true; username: string }
  | { ok: false; reason: "invalid" | "taken" | "error"; message: string };

// Typed references to convex/users.ts. (Importing convex/_generated/api here
// would drag the server-side Convex files, which use Node types, into the
// client type-check.)
const meQuery = makeFunctionReference<"query", Record<string, never>, Profile | null>("users:me");
const claimMutation = makeFunctionReference<
  "mutation",
  { username: string },
  { ok: true; username: string } | { ok: false; reason: "invalid" | "taken"; message: string }
>("users:claimUsername");

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

type Listener = (s: AccountState) => void;

class Account {
  state: AccountState = {
    status: PUBLISHABLE_KEY ? "loading" : "disabled",
    profileLoaded: false,
    profile: null,
    backendError: "",
    playingAs: "",
    notice: "",
  };
  clerk: Clerk | null = null;
  private convex: ConvexClient | null = CONVEX_URL ? new ConvexClient(CONVEX_URL) : null;
  private listeners = new Set<Listener>();
  private unsubscribeMe: (() => void) | null = null;
  private sessionId: string | null = null;
  /** Resolves once Clerk has loaded (or failed, or isn't configured). */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = PUBLISHABLE_KEY ? this.loadClerk(PUBLISHABLE_KEY) : Promise.resolve();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AccountState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private async loadClerk(key: string) {
    try {
      // clerk-js v6 ships without its UI: the sign-in modal and user button
      // come from @clerk/ui, bundled here (lazily, like clerk-js itself).
      const [{ Clerk }, { ui }] = await Promise.all([import("@clerk/clerk-js"), import("@clerk/ui")]);
      const clerk = new Clerk(key);
      await clerk.load({ ui });
      this.clerk = clerk;
      clerk.addListener(() => this.onClerkChange());
      this.onClerkChange();
    } catch (err) {
      console.error("[auth] Clerk failed to load", err);
      this.set({ status: "error" });
    }
  }

  private onClerkChange() {
    const session = this.clerk?.session ?? null;
    const id = session?.id ?? null;
    if (id === this.sessionId && this.state.status !== "loading") return;
    this.sessionId = id;
    this.unsubscribeMe?.();
    this.unsubscribeMe = null;
    if (!id) {
      this.convex?.client.clearAuth();
      this.set({ status: "signedOut", profile: null, profileLoaded: false, backendError: "" });
      return;
    }
    this.set({ status: "signedIn", profile: null, profileLoaded: false, backendError: "" });
    const convex = this.convex;
    if (!convex) {
      this.set({ backendError: "Profiles aren't configured (VITE_CONVEX_URL is missing)." });
      return;
    }
    convex.setAuth(
      async () => (await this.convexToken()) ?? null,
      (isAuthenticated) => {
        if (!isAuthenticated) {
          this.set({ backendError: "The profile server didn't accept your session." });
          return;
        }
        // (Re)subscribe now that the token is in, so the first answer is ours.
        this.unsubscribeMe?.();
        this.unsubscribeMe = convex.onUpdate(
          meQuery,
          {},
          (profile) => this.set({ profile, profileLoaded: true, backendError: "" }),
          (err) => this.set({ backendError: err.message }),
        );
      },
    );
  }

  /**
   * A Clerk token Convex accepts: `aud: "convex"`. With Clerk's Convex
   * integration the session token already has it; otherwise it comes from
   * the "convex" JWT template (same logic as convex/react-clerk).
   */
  private async convexToken(skipCache = false): Promise<string | undefined> {
    const session = this.clerk?.session;
    if (!session) return undefined;
    try {
      const aud = session.lastActiveToken?.jwt?.claims?.aud;
      const native = aud === "convex" || (Array.isArray(aud) && aud.includes("convex"));
      const token = native
        ? await session.getToken({ skipCache })
        : await session.getToken({ template: "convex", skipCache });
      return token ?? undefined;
    } catch (err) {
      console.warn("[auth] could not get a Convex token from Clerk", err);
      return undefined;
    }
  }

  /**
   * The token to join a room with, or undefined to join as a guest. Waits a
   * little for Clerk so a signed-in player isn't joined as a guest by accident.
   */
  async getJoinToken(): Promise<string | undefined> {
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, 5000))]);
    if (this.state.status !== "signedIn") return undefined;
    const token = await this.convexToken(true);
    if (!token) this.set({ notice: "Couldn't get a game token from your session, playing as a guest." });
    return token;
  }

  openSignIn() {
    // Coming back from the sign-in reloads the page, so the next join uses the account.
    this.clerk?.openSignIn({ forceRedirectUrl: location.href, signUpForceRedirectUrl: location.href });
  }

  mountUserButton(el: HTMLDivElement) {
    this.clerk?.mountUserButton(el, { afterSwitchSessionUrl: location.href });
  }

  unmountUserButton(el: HTMLDivElement) {
    this.clerk?.unmountUserButton(el);
  }

  async claimUsername(username: string): Promise<ClaimResult> {
    if (!this.convex) return { ok: false, reason: "error", message: "Profiles aren't configured." };
    try {
      return await this.convex.mutation(claimMutation, { username });
    } catch (err) {
      return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  setPlayingAs(name: string) {
    if (name !== this.state.playingAs) this.set({ playingAs: name });
  }

  setNotice(notice: string) {
    this.set({ notice });
  }
}

export const account = new Account();
