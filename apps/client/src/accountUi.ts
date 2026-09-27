// The account, on the menu: a chip with your name (it opens the account
// panel) and the panel itself: Clerk sign-in and user button, the username
// form, and your stats from Convex `users.me`. In game only the HUD's name
// label is left.

import { USERNAME_MAX, USERNAME_MIN, usernameError } from "@bagarre/backend/username";
import { account, guestName, type AccountState } from "./auth.ts";
import "./account.css";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const kd = (kills: number, deaths: number) => (deaths === 0 ? kills.toFixed(0) : (kills / deaths).toFixed(2));

export class AccountUi {
  /** The menu chip: name and a one-line summary. Clicking it opens the panel. */
  readonly chip = el("button", "acc-chip");
  /** The account panel's body. */
  readonly panel = el("div", "acc-panel");
  /** Signed in with no username yet: main.ts opens the panel so the form is in view. */
  onNeedsUsername: () => void = () => {};

  private chipName = el("span", "acc-chip-name");
  private chipSub = el("span", "acc-chip-sub");
  private who = el("div", "acc-who");
  private whoName = el("div", "acc-name");
  private whoLine = el("div", "acc-line");
  private userBox = el("div", "acc-user");
  private actions = el("div", "acc-actions");
  private signIn = el("button", "btn btn-blue", "Sign in");
  private rename = el("button", "btn btn-quiet", "Change username");
  private stats = el("dl", "acc-stats");
  private form = el("form", "acc-form");
  private formLabel = el("label", "", "Choose your username");
  private input = el("input");
  private submit = el("button", "btn btn-blue", "Save");
  private error = el("div", "acc-error");
  private notice = el("div", "acc-notice");
  private noticeText = el("span");

  private userButtonMounted = false;
  private renaming = false;
  private saving = false;
  private askedForUsername = false;
  private last: AccountState = account.state;

  constructor() {
    this.chip.type = "button";
    this.chip.setAttribute("aria-haspopup", "dialog");
    const avatar = el("span", "acc-chip-avatar");
    avatar.setAttribute("aria-hidden", "true");
    avatar.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4 20.5c.8-4 4-6 8-6s7.2 2 8 6" fill="currentColor"/></svg>`;
    const text = el("span", "acc-chip-text");
    text.append(this.chipName, this.chipSub);
    this.chip.append(avatar, text);

    this.whoName.id = "acc-panel-name";
    const whoText = el("div");
    whoText.append(this.whoName, this.whoLine);
    this.who.append(whoText, this.userBox);

    this.signIn.type = "button";
    this.rename.type = "button";
    this.actions.append(this.signIn, this.rename);

    this.form.noValidate = true;
    this.input.id = "acc-username";
    this.input.name = "username";
    this.input.autocomplete = "username";
    this.input.spellcheck = false;
    this.input.minLength = USERNAME_MIN;
    this.input.maxLength = USERNAME_MAX;
    this.input.placeholder = `${USERNAME_MIN}-${USERNAME_MAX} letters, digits or _`;
    this.input.setAttribute("aria-describedby", "acc-username-error");
    this.formLabel.htmlFor = "acc-username";
    this.submit.type = "submit";
    this.error.id = "acc-username-error";
    this.error.setAttribute("role", "alert");
    const field = el("div", "acc-field");
    field.append(this.input, this.submit);
    this.form.append(this.formLabel, field, this.error);

    const dismiss = el("button", "acc-dismiss");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    this.notice.setAttribute("role", "status");
    this.notice.append(this.noticeText, dismiss);

    this.panel.append(this.who, this.notice, this.stats, this.form, this.actions);

    this.input.addEventListener("input", () => {
      const v = this.input.value.trim();
      this.error.textContent = v ? (usernameError(v) ?? "") : "";
    });
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.save();
    });
    this.signIn.addEventListener("click", () => account.openSignIn());
    this.rename.addEventListener("click", () => {
      this.renaming = !this.renaming;
      this.render(this.last);
    });
    dismiss.addEventListener("click", () => account.setNotice(""));

    account.subscribe((s) => this.render(s));
  }

  private async save() {
    if (this.saving) return;
    const name = this.input.value.trim();
    const invalid = usernameError(name);
    if (invalid) {
      this.error.textContent = invalid;
      this.input.focus();
      return;
    }
    this.saving = true;
    this.submit.disabled = true;
    this.error.textContent = "";
    const res = await account.claimUsername(name);
    this.saving = false;
    this.submit.disabled = false;
    if (!res.ok) {
      this.error.textContent = res.message;
      this.input.focus();
      return;
    }
    this.renaming = false;
    this.render(this.last);
    this.rename.focus();
  }

  /**
   * Dev-only: shows the username form without an account, so the headless
   * check can type in it. Saving then fails with "Profiles aren't configured"
   * or a Convex auth error, which is fine for that check.
   */
  forceUsernameForm() {
    this.renaming = true;
    this.render(this.last);
  }

  private render(s: AccountState) {
    this.last = s;
    const signedIn = s.status === "signedIn";
    const profile = signedIn ? s.profile : null;
    const name = profile?.username ?? guestName;
    let line = "";
    let chipSub = "Guest";
    let showForm = false;
    this.signIn.hidden = s.status !== "signedOut";
    this.rename.hidden = true;

    switch (s.status) {
      case "disabled":
        line = "Playing as a guest. Sign-in isn't set up on this server.";
        break;
      case "error":
        line = "Playing as a guest. Sign-in couldn't load.";
        break;
      case "loading":
        line = "Playing as a guest.";
        chipSub = "Checking sign-in…";
        break;
      case "signedOut":
        line = "Playing as a guest. Sign in to keep a username and your stats.";
        chipSub = "Guest · Sign in";
        break;
      case "signedIn":
        if (s.backendError) {
          line = `Signed in, but your profile didn't load: ${s.backendError}`;
          chipSub = "Signed in";
        } else if (!s.profileLoaded) {
          line = "Signed in. Loading your profile…";
          chipSub = "Signed in";
        } else if (!profile) {
          line = "Signed in. Pick a username to play under it.";
          chipSub = "Choose a username";
          showForm = true;
        } else {
          const st = profile.stats;
          line = "Signed in. Your stats count in every game.";
          chipSub = `${st.wins} W · ${st.losses} L · K/D ${kd(st.kills, st.deaths)}`;
          this.rename.hidden = false;
          this.rename.textContent = this.renaming ? "Cancel" : "Change username";
          showForm = this.renaming;
        }
        break;
    }
    // The dev-forced form (see forceUsernameForm) shows whatever the state.
    if (this.renaming && !profile) showForm = true;

    this.chipName.textContent = name;
    this.chipSub.textContent = chipSub;
    this.chip.setAttribute("aria-label", `Account: ${name}, ${chipSub}`);
    this.whoName.textContent = name;
    this.whoLine.textContent = line;

    this.stats.hidden = !profile;
    if (profile) {
      const st = profile.stats;
      const items: [string, string][] = [
        ["Wins", String(st.wins)],
        ["Losses", String(st.losses)],
        ["Kills", String(st.kills)],
        ["K/D", kd(st.kills, st.deaths)],
        ["Matches", String(st.matches)],
      ];
      this.stats.replaceChildren(
        ...items.map(([k, v]) => {
          const d = el("div", "acc-stat");
          d.append(el("dd", "", v), el("dt", "", k));
          return d;
        }),
      );
    }

    // Clerk's user button (avatar, manage account, sign out).
    this.userBox.hidden = !signedIn;
    if (signedIn && !this.userButtonMounted) {
      account.mountUserButton(this.userBox);
      this.userButtonMounted = true;
    } else if (!signedIn && this.userButtonMounted) {
      account.unmountUserButton(this.userBox);
      this.userButtonMounted = false;
    }

    const formWasHidden = this.form.hidden;
    this.form.hidden = !showForm;
    if (showForm && formWasHidden) {
      this.formLabel.textContent = profile ? "New username" : "Choose your username";
      this.input.value = profile?.username ?? "";
      this.error.textContent = "";
    }

    this.notice.hidden = !s.notice;
    this.noticeText.textContent = s.notice;

    // Signed in for the first time: bring the form into view once.
    if (signedIn && s.profileLoaded && !profile && !s.backendError && !this.askedForUsername) {
      this.askedForUsername = true;
      this.onNeedsUsername();
    }
  }

  /** Focus target when the panel opens: the username field if it's showing. */
  get focusTarget(): HTMLElement | null {
    return this.form.hidden ? null : this.input;
  }
}
