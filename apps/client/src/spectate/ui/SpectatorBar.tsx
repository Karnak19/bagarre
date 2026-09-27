// The spectator's top bar: who is being watched (in their colour), the
// camera mode switcher, the key hints, the spectator count, "Join the game"
// when a seat is free, and Leave. It reads the spectator's UI store through
// selectors, so it re-renders only when the fields it shows change (a new
// target, a mode switch, a seat freeing up), never per frame.

import { Button } from "@astryxdesign/core/Button";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack } from "@astryxdesign/core/Layout";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import * as stylex from "@stylexjs/stylex";
import type { Readable } from "../../store.ts";
import { shallowEqual, useSelector } from "../../ui/hooks.ts";
import { shared } from "../../ui/styles.ts";
import { CAMERA_MODES, type CameraMode, type SpectateUiModel } from "../model.ts";

const NARROW = "@media (max-width: 760px)";

const MODE_LABELS: Record<CameraMode, string> = { follow: "Follow", overview: "Overview", free: "Free" };

const HINTS: Record<CameraMode, { keys: string; label: string }[]> = {
  follow: [
    { keys: "Q", label: "" },
    { keys: "E", label: "switch player" },
  ],
  overview: [
    { keys: "Q", label: "" },
    { keys: "E", label: "follow a player" },
  ],
  free: [
    { keys: "W+A+S+D", label: "pan · drag · wheel to zoom" },
  ],
};

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
  watching: { minWidth: 0, fontSize: "15px" },
  eyebrow: {
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--color-text-secondary)",
  },
  name: { fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  dotColor: (color: string) => ({ backgroundColor: color }),
  hints: { display: { default: "flex", [NARROW]: "none" }, color: "var(--color-text-secondary)", fontSize: "12px" },
  count: { whiteSpace: "nowrap" },
  join: { whiteSpace: "nowrap" },
});

export interface SpectatorBarActions {
  setMode(mode: CameraMode): void;
  /** Take the free seat (see docs/spectate.md: the "join" message). */
  join(): void;
  leave(): void;
}

function Watching({ store }: { store: Readable<SpectateUiModel> }) {
  const w = useSelector(store, (s) => ({ mode: s.mode, name: s.watching?.name ?? "", color: s.watching?.color ?? "" }), shallowEqual);
  const label = w.name ? w.name : w.mode === "overview" ? "The whole map" : w.mode === "free" ? "Free camera" : "Nobody yet";
  return (
    <HStack gap={2} align="center" xstyle={styles.watching} data-testid="spectate-watching" data-name={w.name || undefined}>
      <Text as="span" xstyle={styles.eyebrow}>
        {w.name ? "Watching" : "Spectating"}
      </Text>
      {w.name && <HStack as="span" xstyle={[shared.dot, styles.dotColor(w.color)]} aria-hidden="true" />}
      <Text as="span" xstyle={styles.name}>
        {label}
      </Text>
    </HStack>
  );
}

function Hints({ mode }: { mode: CameraMode }) {
  return (
    <HStack gap={1} align="center" xstyle={styles.hints} data-testid="spectate-hints" aria-label="Keyboard shortcuts">
      {HINTS[mode].map((h) => (
        <HStack key={h.keys} as="span" gap={1} align="center">
          <Kbd keys={h.keys} />
          {h.label && <Text as="span">{h.label}</Text>}
        </HStack>
      ))}
      <Kbd keys="1" />
      <Kbd keys="2" />
      <Kbd keys="3" />
      <Text as="span">modes</Text>
    </HStack>
  );
}

export function SpectatorBar({ store, actions }: { store: Readable<SpectateUiModel>; actions: SpectatorBarActions }) {
  const s = useSelector(
    store,
    (m) => ({ mode: m.mode, spectators: m.spectators, canJoin: m.canJoin, players: m.players, maxPlayers: m.maxPlayers }),
    shallowEqual,
  );
  return (
    <HStack
      as="header"
      justify="between"
      align="center"
      gap={3}
      wrap="wrap"
      xstyle={[shared.hudPanel, styles.bar]}
      aria-label="Spectator controls"
      data-testid="spectate-bar"
      data-mode={s.mode}
    >
      <Watching store={store} />
      <HStack gap={3} align="center" wrap="wrap">
        <SegmentedControl
          label="Camera"
          size="sm"
          value={s.mode}
          onChange={(v) => actions.setMode(v as CameraMode)}
          data-testid="spectate-mode"
        >
          {CAMERA_MODES.map((m) => (
            <SegmentedControlItem key={m} value={m} label={MODE_LABELS[m]} data-testid={`spectate-mode-${m}`} />
          ))}
        </SegmentedControl>
        <Hints mode={s.mode} />
      </HStack>
      <HStack gap={2} align="center">
        <Text
          type="supporting"
          color="secondary"
          xstyle={[shared.tabular, styles.count]}
          data-testid="spectate-count"
          data-count={s.spectators}
          aria-label={`${s.spectators} ${s.spectators === 1 ? "spectator" : "spectators"}`}
        >
          {s.spectators} watching · {s.players}/{s.maxPlayers} playing
        </Text>
        {s.canJoin && (
          <Button label="Join the game" size="sm" xstyle={[shared.blueButton, styles.join]} onClick={actions.join} data-testid="spectate-join" />
        )}
        <Button label="Leave" variant="secondary" size="sm" onClick={actions.leave} data-testid="spectate-leave" />
      </HStack>
    </HStack>
  );
}
