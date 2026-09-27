// The account widget in the bottom-right corner, and the "choose your
// username" form. Loaded as its own module entry from index.html.

import { USERNAME_MAX, USERNAME_MIN, usernameError } from "@bagarre/backend/username";
import { account, type AccountState } from "./auth.ts";
import "./account.css";

const root = document.createElement("div");
root.id = "account";
root.innerHTML = `
  <div class="acc-row">
    <span class="acc-line"></span>
    <button type="button" class="acc-signin" hidden>Sign in</button>
    <button type="button" class="acc-rename" hidden title="Change your username">Rename</button>
    <div class="acc-user" hidden></div>
  </div>
  <form class="acc-form" hidden novalidate>
    <label for="acc-name">Choose your username</label>
    <div class="acc-field">
      <input id="acc-name" name="username" autocomplete="username" spellcheck="false"
        minlength="${USERNAME_MIN}" maxlength="${USERNAME_MAX}" placeholder="${USERNAME_MIN}-${USERNAME_MAX} letters, digits or _" />
      <button type="submit">Save</button>
    </div>
    <div class="acc-error" role="alert"></div>
  </form>
  <div class="acc-hint" hidden>
    <span class="acc-hint-text"></span>
    <button type="button" class="acc-reload">Reload</button>
  </div>
  <div class="acc-notice" hidden role="status">
    <span class="acc-notice-text"></span>
    <button type="button" class="acc-dismiss" aria-label="Dismiss">×</button>
  </div>
`;
document.body.appendChild(root);

const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const line = $(".acc-line");
const signIn = $<HTMLButtonElement>(".acc-signin");
const rename = $<HTMLButtonElement>(".acc-rename");
const userBox = $<HTMLDivElement>(".acc-user");
const form = $<HTMLFormElement>(".acc-form");
const input = $<HTMLInputElement>("#acc-name");
const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
const error = $(".acc-error");
const hint = $(".acc-hint");
const hintText = $(".acc-hint-text");
const notice = $(".acc-notice");
const noticeText = $(".acc-notice-text");

// input.ts listens for keys on `window`. Keys typed in our form, or in Clerk's
// modal (mounted elsewhere in <body>), stop at `document` so they don't move
// the player, fire abilities, or get their Space swallowed.
const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.matches("input, textarea, select"));
for (const type of ["keydown", "keyup"] as const) {
  document.addEventListener(type, (e) => {
    // composedPath()[0]: the real target, even inside a shadow root.
    if (isEditable(e.composedPath()[0] ?? e.target)) e.stopPropagation();
  });
}

let userButtonMounted = false;
let renaming = false;
let saving = false;
let lastState: AccountState = account.state;

function setLine(parts: (string | { strong: string })[], title = "") {
  line.replaceChildren(
    ...parts.map((p) => {
      if (typeof p === "string") return document.createTextNode(p);
      const b = document.createElement("strong");
      b.textContent = p.strong;
      return b;
    }),
  );
  line.title = title;
}

function render(s: AccountState) {
  lastState = s;
  const guestName = s.playingAs || "…";
  let showForm = false;
  let hintMsg = "";
  signIn.hidden = true;
  rename.hidden = true;
  root.dataset.status = s.status;

  switch (s.status) {
    case "disabled":
      setLine(["Playing as ", { strong: guestName }, " · Sign-in not configured"], "VITE_CLERK_PUBLISHABLE_KEY is not set");
      break;
    case "error":
      setLine(["Playing as ", { strong: guestName }, " · Sign-in unavailable"], "Clerk failed to load");
      break;
    case "loading":
      setLine(["Playing as ", { strong: guestName }]);
      break;
    case "signedOut":
      setLine(["Playing as ", { strong: guestName }, " · "]);
      signIn.hidden = false;
      break;
    case "signedIn":
      if (s.backendError) {
        setLine(["Signed in · ", s.backendError]);
      } else if (!s.profileLoaded) {
        setLine(["Signed in · loading profile…"]);
      } else if (!s.profile) {
        setLine(["Playing as ", { strong: guestName }]);
        showForm = true;
      } else {
        setLine([{ strong: s.profile.username }], `${s.profile.stats.wins} wins, ${s.profile.stats.kills} kills`);
        rename.hidden = false;
        showForm = renaming;
        if (s.playingAs && s.playingAs !== s.profile.username) hintMsg = `Reload to play as ${s.profile.username}.`;
      }
      break;
  }

  // Clerk's user button (avatar, manage account, sign out).
  const wantUserButton = s.status === "signedIn";
  userBox.hidden = !wantUserButton;
  if (wantUserButton && !userButtonMounted) {
    account.mountUserButton(userBox);
    userButtonMounted = true;
  } else if (!wantUserButton && userButtonMounted) {
    account.unmountUserButton(userBox);
    userButtonMounted = false;
  }

  const formWasHidden = form.hidden;
  form.hidden = !showForm;
  if (showForm && formWasHidden) {
    form.querySelector("label")!.textContent = s.profile ? "New username" : "Choose your username";
    input.value = s.profile?.username ?? "";
    error.textContent = "";
    input.focus();
  }

  hint.hidden = !hintMsg;
  hintText.textContent = hintMsg;
  notice.hidden = !s.notice;
  noticeText.textContent = s.notice;
}

input.addEventListener("input", () => {
  const v = input.value.trim();
  error.textContent = v ? (usernameError(v) ?? "") : "";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (saving) return;
  const name = input.value.trim();
  const invalid = usernameError(name);
  if (invalid) {
    error.textContent = invalid;
    return;
  }
  saving = true;
  submit.disabled = true;
  error.textContent = "";
  const res = await account.claimUsername(name);
  saving = false;
  submit.disabled = false;
  if (!res.ok) {
    error.textContent = res.message;
    input.focus();
    return;
  }
  renaming = false;
  input.blur();
  render(lastState);
});

signIn.addEventListener("click", () => account.openSignIn());
rename.addEventListener("click", () => {
  renaming = !renaming;
  render(lastState);
});
$(".acc-reload").addEventListener("click", () => location.reload());
$(".acc-dismiss").addEventListener("click", () => account.setNotice(""));

account.subscribe(render);
