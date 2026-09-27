// StyleX styles shared by several views. Values are theme tokens
// (`var(--color-*)`, `var(--spacing-*)`, and the game's own `--bagarre-*`
// from ui/theme/bagarre.source.ts); raw px only for structural sizes.

import * as stylex from "@stylexjs/stylex";

export const shared = stylex.create({
  /** The Black Ops One stencil: the title, panel titles and a few short labels. */
  display: {
    fontFamily: "var(--bagarre-font-display)",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
  },
  /** Small caps label over a group of fields ("Invite link", "Your weapon"). */
  eyebrow: {
    display: "block",
    marginBlockStart: "18px",
    marginBlockEnd: "var(--spacing-2)",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--color-text-secondary)",
  },
  tabular: { fontVariantNumeric: "tabular-nums" },
  /** A translucent HUD-like panel. */
  hudPanel: {
    backgroundColor: "var(--bagarre-hud-panel)",
    borderRadius: "var(--radius-element)",
  },
  /** Player colour dot. */
  dot: {
    flexShrink: 0,
    width: "10px",
    height: "10px",
    borderRadius: "var(--radius-full)",
  },
  dotOpen: {
    boxShadow: "inset 0 0 0 2px rgba(255, 255, 255, 0.3)",
  },
  p0: { backgroundColor: "var(--bagarre-p0)" },
  p1: { backgroundColor: "var(--bagarre-p1)" },
  /** The blue call-to-action (Copy invite link, Sign in, Save). */
  blueButton: {
    backgroundColor: {
      default: "var(--bagarre-p1)",
      ":hover": { default: null, "@media (hover: hover)": "var(--bagarre-p1-hover)" },
    },
    color: "var(--bagarre-on-p1)",
  },
});

/** The dot colour for a player slot. */
export const slotDot = (slot: number) => (slot === 1 ? shared.p1 : slot === 0 ? shared.p0 : null);
