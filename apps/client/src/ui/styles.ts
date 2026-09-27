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
  p2: { backgroundColor: "var(--bagarre-p2)" },
  p3: { backgroundColor: "var(--bagarre-p3)" },
  p4: { backgroundColor: "var(--bagarre-p4)" },
  p5: { backgroundColor: "var(--bagarre-p5)" },
  pNone: { backgroundColor: "var(--color-text-disabled)" },
  t0: { color: "var(--bagarre-p0)" },
  t1: { color: "var(--bagarre-p1)" },
  t2: { color: "var(--bagarre-p2)" },
  t3: { color: "var(--bagarre-p3)" },
  t4: { color: "var(--bagarre-p4)" },
  t5: { color: "var(--bagarre-p5)" },
  /** The blue call-to-action (Copy invite link, Sign in, Save). */
  blueButton: {
    backgroundColor: {
      default: "var(--bagarre-p1)",
      ":hover": { default: null, "@media (hover: hover)": "var(--bagarre-p1-hover)" },
    },
    color: "var(--bagarre-on-p1)",
  },
});

const FILLS = [shared.p0, shared.p1, shared.p2, shared.p3, shared.p4, shared.p5];
const TEXTS = [shared.t0, shared.t1, shared.t2, shared.t3, shared.t4, shared.t5];

/** The background (dot, bar) colour for a player slot, 0..5 (null: no seat). */
export const slotDot = (slot: number | null) => (slot === null ? null : (FILLS[slot] ?? null));

/** Like slotDot, but a grey fill for no seat (an empty HP bar). */
export const slotFill = (slot: number | null) => (slot === null ? shared.pNone : (FILLS[slot] ?? shared.pNone));

/** The text colour for a player slot (a name in the kill feed or a table). */
export const slotText = (slot: number) => TEXTS[slot] ?? null;
