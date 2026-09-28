// Walking around a map (`/maps/<id>`): a top bar in the spectator bar's look
// (spectate/ui/SpectatorBar.tsx) over the real arena, with the map's name,
// the Overview / Free switcher, the key hints and Back to the list. The
// camera and its keys are walk.ts'; Esc here goes back to the list too.

import { Button } from "@astryxdesign/core/Button";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { findMap } from "@bagarre/shared";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { ui } from "../../uiState.ts";
import type { WalkMode } from "../../walk.ts";
import { useEngine, useSelector, useStore } from "../hooks.ts";
import { shared } from "../styles.ts";

const NARROW = "@media (max-width: 760px)";

const MODES: { value: WalkMode; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "free", label: "Free" },
];

const styles = stylex.create({
  bar: {
    position: "fixed",
    top: "12px",
    left: "12px",
    right: "12px",
    zIndex: 20,
    paddingBlock: "8px",
    paddingInline: "12px",
    pointerEvents: "auto",
  },
  title: { minWidth: 0, fontSize: "15px" },
  eyebrow: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--color-text-secondary)",
  },
  name: { fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  hints: { display: { default: "flex", [NARROW]: "none" }, color: "var(--color-text-secondary)", fontSize: "12px" },
  loading: { color: "var(--color-text-secondary)", whiteSpace: "nowrap" },
});

const isEditable = (e: Event) => {
  const t = e.composedPath()[0] ?? e.target;
  return t instanceof HTMLElement && (t.isContentEditable || t.matches("input, textarea, select"));
};

/** The `/maps/$id` route's page. */
export function WalkScreen() {
  const { id } = useParams({ from: "/maps/$id" });
  const { walkUi, setWalkMode, loading } = useEngine();
  const mode = useSelector(walkUi, (s) => s.mode);
  const progress = useStore(loading);
  const router = useRouter();
  const navigate = useNavigate();
  const map = findMap(id);

  const back = () => {
    // Opened from the list: Back is the browser's, so Forward still works.
    if (router.state.location.state.fromMaps) router.history.back();
    else void navigate({ to: "/maps", replace: true });
  };
  const backRef = useRef(back);
  backRef.current = back;

  // Esc goes back to the list, unless a panel (dialog) has it or a text field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape" || e.repeat || ui.getState().panel || isEditable(e)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      backRef.current();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <HStack
      as="header"
      justify="between"
      align="center"
      gap={3}
      wrap="wrap"
      xstyle={[shared.hudPanel, styles.bar]}
      aria-label="Walk around controls"
      data-testid="walk"
      data-mode={mode}
    >
      <HStack gap={2} align="center" xstyle={styles.title}>
        <Text as="span" xstyle={styles.eyebrow}>
          Walking around
        </Text>
        <Text as="span" xstyle={styles.name} data-testid="walk-map">
          {map?.name ?? id}
        </Text>
      </HStack>
      <HStack gap={3} align="center" wrap="wrap">
        {progress !== null ? (
          <Text type="supporting" xstyle={[styles.loading, shared.tabular]}>
            Loading the arena… {Math.round(progress * 100)}%
          </Text>
        ) : (
          <SegmentedControl
            label="Camera"
            size="sm"
            value={mode}
            onChange={(v) => setWalkMode(v as WalkMode)}
            data-testid="walk-mode"
          >
            {MODES.map((m) => (
              <SegmentedControlItem key={m.value} value={m.value} label={m.label} data-testid={`walk-mode-${m.value}`} />
            ))}
          </SegmentedControl>
        )}
        <HStack gap={1} align="center" xstyle={styles.hints} aria-label="Keyboard shortcuts">
          <Kbd keys="W+A+S+D" />
          <Text as="span">pan · drag · wheel to zoom</Text>
          <Kbd keys="2" />
          <Kbd keys="3" />
          <Text as="span">overview, free</Text>
        </HStack>
      </HStack>
      <Button label="Back" variant="secondary" size="sm" onClick={back} data-testid="walk-back" />
    </HStack>
  );
}
