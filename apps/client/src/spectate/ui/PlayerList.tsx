// The spectator's player list: everyone in the game in scoreboard order,
// with their colour, K/D, alive or dead, and a "reconnecting" mark while the
// server holds their seat. A click follows that player. It re-renders when a
// row changes (a kill, a death, a switch), not per frame.

import { List, ListItem } from "@astryxdesign/core/List";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import * as stylex from "@stylexjs/stylex";
import type { Readable } from "../../store.ts";
import { jsonEqual, useSelector } from "../../ui/hooks.ts";
import { shared } from "../../ui/styles.ts";
import type { SpectateRow, SpectateUiModel } from "../model.ts";

const NARROW = "@media (max-width: 760px)";

const styles = stylex.create({
  box: {
    position: "fixed",
    top: { default: "76px", [NARROW]: "auto" },
    bottom: { default: "auto", [NARROW]: "12px" },
    right: "12px",
    zIndex: 20,
    width: "min(260px, calc(100vw - 24px))",
    padding: "8px",
    pointerEvents: "auto",
  },
  title: {
    marginInline: "6px",
    marginBlockEnd: "4px",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--color-text-secondary)",
  },
  item: { borderRadius: "var(--radius-element)" },
  followed: { backgroundColor: "rgba(255, 255, 255, 0.1)" },
  dead: { opacity: 0.55 },
  dotColor: (color: string) => ({ backgroundColor: color }),
  kd: { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  gold: { color: "var(--bagarre-gold)", fontWeight: 800 },
});

function status(r: SpectateRow): { variant: "success" | "warning" | "neutral"; label: string } {
  if (!r.connected) return { variant: "warning", label: "Reconnecting" };
  return r.alive ? { variant: "success", label: "Alive" } : { variant: "neutral", label: "Dead" };
}

function Row({ row, onFollow }: { row: SpectateRow; onFollow: (id: string) => void }) {
  const st = status(row);
  return (
    <ListItem
      label={row.name}
      description={
        <HStack as="span" gap={1} align="center">
          <StatusDot variant={st.variant} label={st.label} isPulsing={!row.connected} />
          <Text as="span" type="supporting" color="secondary">
            {st.label}
            {row.followed ? " · watching" : ""}
          </Text>
        </HStack>
      }
      startContent={<HStack as="span" xstyle={[shared.dot, styles.dotColor(row.color)]} aria-hidden="true" />}
      endContent={
        <Text as="span" xstyle={[styles.kd, row.leader && styles.gold]} aria-label={`${row.kills} kills, ${row.deaths} deaths`}>
          {row.kills} / {row.deaths}
        </Text>
      }
      isSelected={row.followed}
      aria-label={`Follow ${row.name}`}
      onClick={() => onFollow(row.id)}
      xstyle={[styles.item, row.followed && styles.followed, !row.alive && styles.dead]}
      data-testid="spectate-player"
      data-id={row.id}
      data-followed={row.followed ? "" : undefined}
      data-alive={row.alive ? "" : undefined}
      data-connected={row.connected ? "" : undefined}
      data-leader={row.leader ? "" : undefined}
    />
  );
}

export function PlayerList({ store, onFollow }: { store: Readable<SpectateUiModel>; onFollow: (id: string) => void }) {
  const rows = useSelector(store, (s) => s.rows, jsonEqual);
  return (
    <VStack as="section" aria-labelledby="spectate-players-title" xstyle={[shared.hudPanel, styles.box]} data-testid="spectate-players">
      <Text as="h2" id="spectate-players-title" xstyle={styles.title}>
        Players · K / D
      </Text>
      {rows.length > 0 ? (
        <List density="compact">
          {rows.map((r) => (
            <Row key={r.id} row={r} onFollow={onFollow} />
          ))}
        </List>
      ) : (
        <Text type="supporting" color="secondary" xstyle={styles.title} data-testid="spectate-players-empty">
          Nobody is playing yet.
        </Text>
      )}
    </VStack>
  );
}
