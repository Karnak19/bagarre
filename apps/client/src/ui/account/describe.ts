// What the account chip and panel say for a given account state.

import { guestName, type AccountState } from "../../auth.ts";

export const kd = (kills: number, deaths: number) => (deaths === 0 ? kills.toFixed(0) : (kills / deaths).toFixed(2));

export interface AccountSummary {
  name: string;
  /** The panel's line under the name. */
  line: string;
  /** The chip's second line. */
  chipSub: string;
  /** Signed in with no username yet: the username form shows by itself. */
  needsUsername: boolean;
}

export function describeAccount(s: AccountState): AccountSummary {
  const profile = s.status === "signedIn" ? s.profile : null;
  const name = profile?.username ?? guestName;
  switch (s.status) {
    case "disabled":
      return { name, line: "Playing as a guest. Sign-in isn't set up on this server.", chipSub: "Guest", needsUsername: false };
    case "error":
      return { name, line: "Playing as a guest. Sign-in couldn't load.", chipSub: "Guest", needsUsername: false };
    case "loading":
      return { name, line: "Playing as a guest.", chipSub: "Checking sign-in…", needsUsername: false };
    case "signedOut":
      return {
        name,
        line: "Playing as a guest. Sign in to keep a username and your stats.",
        chipSub: "Guest · Sign in",
        needsUsername: false,
      };
    case "signedIn":
      if (s.backendError)
        return { name, line: `Signed in, but your profile didn't load: ${s.backendError}`, chipSub: "Signed in", needsUsername: false };
      if (!s.profileLoaded) return { name, line: "Signed in. Loading your profile…", chipSub: "Signed in", needsUsername: false };
      if (!profile)
        return { name, line: "Signed in. Pick a username to play under it.", chipSub: "Choose a username", needsUsername: true };
      return {
        name,
        line: "Signed in. Your stats count in every game.",
        chipSub: `${profile.stats.wins} W · ${profile.stats.losses} L · K/D ${kd(profile.stats.kills, profile.stats.deaths)}`,
        needsUsername: false,
      };
  }
}
