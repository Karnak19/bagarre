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
  const acc = s.status === "signedIn" ? s.account : null;
  const name = acc?.username ?? guestName;
  switch (s.status) {
    case "error":
      return {
        name,
        line: "Playing as a guest for now: the account server couldn't be reached.",
        chipSub: "Offline",
        needsUsername: false,
      };
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
      if (!acc?.username)
        return { name, line: "Signed in. Pick a username to play under it.", chipSub: "Choose a username", needsUsername: true };
      return {
        name,
        line: "Signed in. Your stats count in every game.",
        chipSub: `${acc.stats.wins} W · ${acc.stats.losses} L · K/D ${kd(acc.stats.kills, acc.stats.deaths)}`,
        needsUsername: false,
      };
  }
}
