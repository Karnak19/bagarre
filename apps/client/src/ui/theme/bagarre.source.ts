/**
 * The Bagarre theme: the game's own palette on top of Astryx's neutral theme.
 *
 * Dark only (the UI always sits over the 3D scene): dark translucent panels
 * like the HUD's, the two player colours (orange for slot 0, which is also
 * the accent, blue for slot 1), a gold highlight for the leader and focus,
 * and the Black Ops One stencil for display text. Body text stays on the
 * system stack.
 *
 * Source of truth for the look. After editing, rebuild the static CSS and
 * module next to this file:
 *
 *   bun run theme:build        (astryx theme build src/ui/theme/bagarre.source.ts -o src/ui/theme/bagarre.css)
 *
 * The build writes bagarre.css / bagarre.js / bagarre.d.ts, which main.tsx
 * imports. Game-specific values the Astryx token set has no name for live in
 * `localTokens` (`--bagarre-*`), read from StyleX as `var(--bagarre-...)`.
 */

import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

const P0 = "#ff6b4a";
const P1 = "#4ab8ff";
const TEXT = "#f2f2f2";
const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const bagarreTheme = defineTheme({
  name: "bagarre",
  extends: neutralTheme,

  color: { accent: P0, neutralStyle: "cool", contrast: "standard" },

  typography: {
    scale: { base: 15, ratio: 1.2 },
    body: { family: "system-ui", fallbacks: SYSTEM },
    heading: { family: "system-ui", fallbacks: SYSTEM, weight: "bold", weights: { 1: "bold", 2: "bold" } },
    code: { family: "ui-monospace", fallbacks: '"SF Mono", Monaco, Consolas, monospace' },
  },

  // 8 px controls and 12 px panels, like the pre-Astryx UI.
  radius: { base: 4, multiplier: 1 },
  motion: { fast: 120, medium: 220, slow: 700, ratio: 0.75, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },

  // The UI is dark in both modes: Theme is mounted with mode="dark", and the
  // light values match so nothing flips if a light mode ever gets forced.
  tokens: {
    "--color-accent": P0,
    "--color-accent-muted": "rgba(255, 107, 74, 0.18)",
    "--color-on-accent": "#210c05",
    "--color-text-accent": "#ff9a80",
    "--color-icon-accent": P0,

    "--color-background-body": "#1a1d24",
    "--color-background-surface": "rgba(14, 16, 22, 0.96)",
    "--color-background-card": "rgba(12, 14, 20, 0.86)",
    "--color-background-popover": "rgba(18, 20, 28, 0.98)",
    "--color-background-muted": "rgba(255, 255, 255, 0.06)",
    "--color-overlay": "rgba(6, 7, 10, 0.6)",
    "--color-overlay-hover": "rgba(255, 255, 255, 0.08)",
    "--color-overlay-pressed": "rgba(255, 255, 255, 0.14)",
    "--color-neutral": "rgba(255, 255, 255, 0.1)",

    "--color-text-primary": TEXT,
    "--color-text-secondary": "rgba(242, 242, 242, 0.72)",
    "--color-text-disabled": "rgba(242, 242, 242, 0.42)",
    "--color-icon-primary": TEXT,
    "--color-icon-secondary": "rgba(242, 242, 242, 0.72)",
    "--color-on-dark": "#ffffff",

    "--color-border": "rgba(255, 255, 255, 0.12)",
    "--color-border-emphasized": "rgba(255, 255, 255, 0.24)",
    "--color-track": "rgba(255, 255, 255, 0.14)",
    "--color-skeleton": "rgba(255, 255, 255, 0.12)",
    "--color-shadow": "rgba(0, 0, 0, 0.55)",

    "--color-error": "#ff7a66",
    "--color-error-muted": "rgba(255, 107, 74, 0.16)",
    "--color-warning": "#ffd24a",
    "--color-warning-muted": "rgba(255, 210, 74, 0.14)",
    "--color-on-warning": "#211800",
    "--color-text-yellow": "#ffe3a0",
    "--color-text-blue": "#9fd8ff",
    "--color-background-blue": "rgba(74, 184, 255, 0.18)",

    "--focus-outline-color": "#ffd24a",
    "--focus-outline-offset": "2px",
    "--shadow-high": "0 28px 60px -24px rgba(0, 0, 0, 0.8)",
    "--shadow-med": "0 24px 56px -24px rgba(0, 0, 0, 0.85)",
  },

  localTokens: {
    /** Player colours, by slot (the same values as scene.ts' PLAYER_COLORS). */
    "--bagarre-p0": P0,
    "--bagarre-p0-hover": "#ff8a6e",
    "--bagarre-p1": P1,
    "--bagarre-p1-hover": "#7ccbff",
    "--bagarre-on-p1": "#08151f",
    /** The leader on the scoreboard, and the title's face. */
    "--bagarre-gold": "#ffd24a",
    "--bagarre-sand": "#ffd98a",
    /** The HUD's panels: lighter than the cards, the scene shows through. */
    "--bagarre-hud-panel": "rgba(12, 14, 20, 0.6)",
    "--bagarre-hud-panel-hover": "rgba(24, 27, 36, 0.78)",
    /** The stencil display face (loaded by global.css). */
    "--bagarre-font-display": `"Black Ops One", ${SYSTEM}`,
  },

  components: {
    button: {
      base: { fontWeight: "var(--font-weight-semibold)" },
      "variant:secondary": { backgroundColor: "rgba(255, 255, 255, 0.1)", color: TEXT },
      "variant:ghost": { color: "rgba(242, 242, 242, 0.72)" },
      "variant:destructive": {
        backgroundColor: "transparent",
        color: "#ffab98",
        boxShadow: "inset 0 0 0 1px rgba(255, 107, 74, 0.45)",
      },
    },
    dialog: { base: { backgroundColor: "rgba(14, 16, 22, 0.96)" } },
    // Panel titles in the stencil, like the menu's headings.
    "dialog-header": {
      base: {
        "--font-family-heading": "var(--bagarre-font-display)",
        "--text-heading-2-weight": "400",
        "--text-heading-2-size": "26px",
        textTransform: "uppercase",
        letterSpacing: "0.02em",
      },
    },
    // The weapon picker: quiet tiles, the pick ringed in white (like the HUD's).
    "toggle-button": {
      base: { backgroundColor: "rgba(255, 255, 255, 0.07)", color: "rgba(242, 242, 242, 0.72)", fontSize: "13px" },
      // Written as a prop value: the bare `isPressed` state key builds to
      // [data-is-pressed="isPressed"] in Astryx 0.6.3, which never matches.
      "isPressed:true": {
        backgroundColor: "rgba(255, 255, 255, 0.18)",
        color: TEXT,
        boxShadow: "inset 0 0 0 1px #ffffff",
      },
    },
    kbd: { base: { backgroundColor: "rgba(255, 255, 255, 0.14)", color: TEXT } },
  },
});
