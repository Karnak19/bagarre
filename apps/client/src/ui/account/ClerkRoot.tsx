// Clerk and Convex, in React. Its own chunk (Shell.tsx loads it lazily, and
// only with VITE_CLERK_PUBLISHABLE_KEY set): guests without keys never
// download Clerk. It renders nothing of its own; it feeds the account store
// (auth.ts), which the menu, the account panel and net.ts' joins read:
//
// - <ClerkProvider> with the bundled clerk-js and @clerk/ui (no CDN script);
//   sign-in happens in Clerk's modal and applies to the next game, so Clerk
//   never navigates (routerPush / routerReplace go nowhere);
// - <ConvexProviderWithClerk>: Convex gets the Clerk token itself, and
//   `users.me` / `users.claimUsername` run through convex/react;
// - Clerk's <UserButton> is portalled into the account panel's slot.

import { Clerk } from "@clerk/clerk-js";
import { ClerkFailed, ClerkProvider, UNSAFE_PortalProvider, UserButton, useAuth, useClerk } from "@clerk/react";
import { ui as clerkUi } from "@clerk/ui";
import { ConvexReactClient, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { makeFunctionReference } from "convex/server";
import { Component, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CONVEX_URL, PUBLISHABLE_KEY, account, type ClaimResult, type Profile } from "../../auth.ts";
import { useStore } from "../hooks.ts";

// Typed references to packages/backend/convex/users.ts. (Importing
// @bagarre/backend/api here would drag the server-side Convex files, which
// use Node types, into the client type-check.)
const meQuery = makeFunctionReference<"query", Record<string, never>, Profile | null>("users:me");
const claimMutation = makeFunctionReference<
  "mutation",
  { username: string },
  { ok: true; username: string } | { ok: false; reason: "invalid" | "taken"; message: string }
>("users:claimUsername");

const convex = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;
const stay = async () => {};

/** Clerk's components in the game's colours (they sit over the same dark panels). */
const appearance = {
  variables: {
    colorPrimary: "#4ab8ff",
    colorBackground: "#15181f",
    colorForeground: "#f2f2f2",
    colorMutedForeground: "rgba(242, 242, 242, 0.72)",
    colorInput: "rgba(0, 0, 0, 0.35)",
    colorInputForeground: "#f2f2f2",
    colorNeutral: "#f2f2f2",
    borderRadius: "8px",
  },
};

export default function ClerkRoot() {
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY!}
      Clerk={Clerk}
      ui={clerkUi}
      routerPush={stay}
      routerReplace={stay}
      appearance={appearance}
    >
      <ClerkFailed>
        <Report failed />
      </ClerkFailed>
      <Session />
      {convex ? (
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <ProfileBoundary>
            <ConvexProfile />
          </ProfileBoundary>
        </ConvexProviderWithClerk>
      ) : (
        <NoConvex />
      )}
      <UserButtonPortal />
    </ClerkProvider>
  );
}

function Report({ failed }: { failed: boolean }) {
  useEffect(() => {
    if (failed) {
      console.error("[auth] Clerk failed to load");
      account.patch({ status: "error" });
    }
  }, [failed]);
  return null;
}

/** Clerk's session: signed in or out, and the join token for the game server. */
function Session() {
  const clerk = useClerk();
  const { isLoaded, sessionId } = useAuth();

  useEffect(() => {
    account.connect({
      /**
       * A Clerk token Convex (and so the game server) accepts: `aud: "convex"`.
       * With Clerk's Convex integration the session token already has it;
       * otherwise it comes from the "convex" JWT template (same logic as
       * convex/react-clerk).
       */
      async getToken(skipCache) {
        const session = clerk.session;
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
      },
      openSignIn() {
        // Email and password flows finish in the modal, with no reload; the
        // next join reads the new session's token. OAuth providers leave the
        // page and come back here.
        clerk.openSignIn({ forceRedirectUrl: location.href, signUpForceRedirectUrl: location.href });
      },
    });
  }, [clerk]);

  useEffect(() => {
    if (!isLoaded) return;
    if (sessionId) account.patch({ status: "signedIn", profile: null, profileLoaded: false, backendError: "" });
    else account.patch({ status: "signedOut", profile: null, profileLoaded: false, backendError: "" });
  }, [isLoaded, sessionId]);

  return null;
}

/** `users.me` and `users.claimUsername`, with the Clerk token Convex was given. */
function ConvexProfile() {
  const { isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(meQuery, isAuthenticated ? {} : "skip");
  const claim = useMutation(claimMutation);

  useEffect(() => {
    account.connect({
      async claimUsername(username): Promise<ClaimResult> {
        try {
          return await claim({ username });
        } catch (err) {
          return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }, [claim]);

  useEffect(() => {
    if (!isSignedIn || isLoading) return;
    if (!isAuthenticated) account.patch({ backendError: "The profile server didn't accept your session." });
    else if (me !== undefined) account.patch({ profile: me, profileLoaded: true, backendError: "" });
  }, [isSignedIn, isLoading, isAuthenticated, me]);

  return null;
}

function NoConvex() {
  const { isSignedIn } = useAuth();
  useEffect(() => {
    if (isSignedIn) account.patch({ backendError: "Profiles aren't configured (VITE_CONVEX_URL is missing)." });
  }, [isSignedIn]);
  return null;
}

/** A failing `users.me` (Convex refused, network) becomes the panel's error line, not a crash. */
class ProfileBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    account.patch({ backendError: err instanceof Error ? err.message : String(err) });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Clerk's user button (avatar, manage account, sign out), rendered into the
 * account panel's slot. The panel is a native modal <dialog>, which makes the
 * rest of the page inert: Clerk's popover and modals are portalled inside it.
 */
function UserButtonPortal() {
  const slot = useStore(account.userButtonSlot);
  const { isSignedIn } = useAuth();
  if (!slot || !isSignedIn) return null;
  return createPortal(
    <UNSAFE_PortalProvider getContainer={() => slot.closest("dialog") ?? document.body}>
      <UserButton afterSwitchSessionUrl={location.href} />
    </UNSAFE_PortalProvider>,
    slot,
  );
}
