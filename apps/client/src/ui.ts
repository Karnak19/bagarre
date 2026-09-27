// Small DOM helpers shared by the menu and the in-game overlays: element
// builders, the icon set, the panel (dialog) layer, the settings form and
// the weapon picker.

import { WEAPONS } from "@bagarre/shared";
import { getMasterVolume, isMuted, setMasterVolume, setMuted } from "./audio.ts";

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export function button(label: string, cls = "btn", onClick?: () => void): HTMLButtonElement {
  const b = el("button", cls, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

/** Sets text only when it changed (overlays update every frame). */
export function setText(e: HTMLElement, text: string) {
  if (e.textContent !== text) e.textContent = text;
}

/** A keycap, like the HUD's key labels. */
export function kbd(label: string): HTMLElement {
  return el("kbd", "", label);
}

/** Line icons, 24 x 24, 2 px stroke. */
export const ICONS = {
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  keyboard: `<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/>`,
  lock: `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
  users: `<circle cx="9" cy="9" r="3.5"/><path d="M2.5 19.5c.6-3.3 3.2-5 6.5-5s5.9 1.7 6.5 5"/><circle cx="17" cy="8" r="2.5"/><path d="M17.5 13.5c2.3.3 3.7 1.8 4 4"/>`,
  volume: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>`,
  refresh: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>`,
} as const;

export function icon(name: keyof typeof ICONS, size = 18): string {
  return `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

// --- Panels --------------------------------------------------------------------

export interface PanelDef {
  title: string;
  body: HTMLElement;
  /** Where focus goes when the panel opens (default: the close button). */
  focus?: () => HTMLElement | null;
  /** Called each time the panel opens (to refresh its content). */
  onOpen?: () => void;
}

/**
 * The dialog layer: one panel at a time over the menu or the game, with a
 * scrim. Esc and the close button close it, and focus goes back to what
 * opened it. Everything behind it is `inert` meanwhile, so Tab stays in the
 * panel. It sits below Clerk's modal (see menu.css), which can open from the
 * account panel.
 */
export class Panels {
  readonly layer = el("div", "panel-layer");
  private box = el("section", "panel");
  private heading = el("h2", "panel-title");
  private content = el("div", "panel-body");
  private defs = new Map<string, PanelDef>();
  private openName: string | null = null;
  private returnFocus: HTMLElement | null = null;
  /** Elements made inert while a panel is open. */
  background: HTMLElement[] = [];
  onChange: () => void = () => {};

  constructor() {
    this.layer.hidden = true;
    this.box.setAttribute("role", "dialog");
    this.box.setAttribute("aria-modal", "true");
    this.heading.id = "panel-title";
    this.box.setAttribute("aria-labelledby", "panel-title");
    const close = button("", "icon-btn panel-close", () => this.close());
    close.innerHTML = icon("close", 20);
    close.setAttribute("aria-label", "Close");
    const head = el("header", "panel-head");
    head.append(this.heading, close);
    this.box.append(head, this.content);
    this.layer.append(this.box);
    // A click on the scrim (outside the panel) closes it too.
    this.layer.addEventListener("pointerdown", (e) => {
      if (e.target === this.layer) this.close();
    });
    document.body.append(this.layer);
  }

  define(name: string, def: PanelDef) {
    this.defs.set(name, def);
  }

  get current(): string | null {
    return this.openName;
  }

  open(name: string) {
    const def = this.defs.get(name);
    if (!def) return;
    if (!this.openName) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.openName = name;
    this.box.dataset.panel = name;
    this.heading.textContent = def.title;
    this.content.replaceChildren(def.body);
    def.onOpen?.();
    this.layer.hidden = false;
    for (const b of this.background) b.inert = true;
    const target = def.focus?.() ?? this.box.querySelector<HTMLElement>(".panel-close");
    target?.focus();
    this.onChange();
  }

  /** Closes the open panel. Returns false if none was open. */
  close(): boolean {
    if (!this.openName) return false;
    this.openName = null;
    this.layer.hidden = true;
    for (const b of this.background) b.inert = false;
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected && !back.closest("[hidden]")) back.focus();
    this.onChange();
    return true;
  }
}

// --- Settings ------------------------------------------------------------------

/** Master volume and mute, on the audio.ts API (both are remembered). `refresh()` re-reads them (M toggles mute in game). */
export function settingsForm(): { root: HTMLElement; refresh: () => void } {
  const root = el("div", "settings");
  const volRow = el("div", "setting");
  const volLabel = el("label", "setting-label", "Master volume");
  volLabel.htmlFor = "set-volume";
  const volOut = el("output", "setting-value");
  volOut.htmlFor.add("set-volume");
  const vol = el("input", "range");
  vol.type = "range";
  vol.id = "set-volume";
  vol.min = "0";
  vol.max = "100";
  vol.step = "5";
  const volHead = el("div", "setting-head");
  volHead.append(volLabel, volOut);
  volRow.append(volHead, vol);

  const muteRow = el("label", "setting setting-toggle");
  const mute = el("input", "switch");
  mute.type = "checkbox";
  mute.id = "set-mute";
  const muteText = el("span", "setting-label", "Mute all sound");
  const muteHint = el("span", "setting-hint");
  muteHint.append("In a match, ", kbd("M"), " toggles it too.");
  const muteCol = el("span", "setting-col");
  muteCol.append(muteText, muteHint);
  muteRow.append(muteCol, mute);

  root.append(volRow, muteRow);

  const refresh = () => {
    const v = Math.round(getMasterVolume() * 100);
    vol.value = String(v);
    volOut.value = `${v}%`;
    vol.style.setProperty("--fill", `${v}%`);
    mute.checked = isMuted();
    root.classList.toggle("is-muted", isMuted());
  };
  vol.addEventListener("input", () => {
    setMasterVolume(Number(vol.value) / 100);
    // Turning the volume up is a clear wish to hear something.
    if (isMuted() && Number(vol.value) > 0) setMuted(false);
    refresh();
  });
  mute.addEventListener("change", () => {
    setMuted(mute.checked);
    refresh();
  });
  refresh();
  return { root, refresh };
}

// --- Weapon picker -------------------------------------------------------------

/** The four weapons as toggle buttons (keys 1-4 do the same), for the waiting and result cards. */
export function weaponPicker(onPick: (weapon: number) => void): { root: HTMLElement; update: (pick: number, enabled: boolean) => void } {
  const root = el("div", "picker");
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Weapon for your next spawn");
  const buttons = WEAPONS.map((w, i) => {
    const b = button("", "pick-btn", () => onPick(i));
    b.append(kbd(String(i + 1)), el("span", "", w.name));
    root.append(b);
    return b;
  });
  let key = "";
  return {
    root,
    update(pick, enabled) {
      const k = `${pick}|${enabled}`;
      if (k === key) return;
      key = k;
      buttons.forEach((b, i) => {
        b.setAttribute("aria-pressed", String(i === pick));
        b.disabled = !enabled;
      });
    },
  };
}
