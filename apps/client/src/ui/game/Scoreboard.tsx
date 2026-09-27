// The scoreboard: held open with Tab in a match (TabScoreboard), and part of
// the match result card. Its model is scoreboard.ts' pure scoreboardModel();
// the Tab layer re-renders only when that model changes (a kill, a ping
// sample, the clock's seconds), not every frame.

import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { KILLS_TO_WIN } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { countRender } from "../../renders.ts";
import { COLUMNS, scoreboardModel, type ScoreboardModel, type ScoreboardRow } from "../../scoreboard.ts";
import { jsonEqual, useEngine, useSelector } from "../hooks.ts";
import { shared, slotDot } from "../styles.ts";

const NARROW = "@media (max-width: 640px)";

const styles = stylex.create({
  board: {
    width: "min(760px, 100%)",
    padding: "16px 20px 12px",
    borderRadius: "var(--radius-container)",
    backgroundColor: "var(--color-background-card)",
    boxShadow: "var(--shadow-med)",
    fontVariantNumeric: "tabular-nums",
  },
  flat: { padding: 0, backgroundColor: "transparent", boxShadow: "none", width: "100%" },
  head: { marginBlockEnd: "var(--spacing-2)" },
  baseline: { alignItems: "baseline" },
  map: { fontSize: "22px" },
  score: { fontSize: "22px", fontWeight: 800 },
  time: { minWidth: "3.5ch", textAlign: "end" },
  // Auto layout: header labels size their columns (Astryx header cells always truncate).
  table: { borderCollapse: "separate", borderSpacing: "0 4px", fontSize: "14px", tableLayout: "auto" },
  th: {
    paddingBlock: "2px",
    paddingInline: "10px",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "rgba(242, 242, 242, 0.5)",
    textAlign: "end",
    whiteSpace: "nowrap",
    // Astryx header cells always truncate (maxWidth 0); these labels are short, let them size the column.
    maxWidth: "none",
    overflow: "visible",
    borderBottomWidth: 0,
    backgroundColor: "transparent",
  },
  thPlayer: { textAlign: "start", width: "40%" },
  thPlace: { textAlign: "start", width: "1%" },
  place: { textAlign: "start", fontWeight: 800, color: "var(--color-text-secondary)" },
  placeFirst: { color: "var(--bagarre-gold)" },
  away: { marginInlineStart: "var(--spacing-2)", color: "var(--color-text-yellow)", fontSize: "12px", fontWeight: 600 },
  sudden: { color: "var(--bagarre-gold)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" },
  cell: {
    padding: { default: "10px", [NARROW]: "8px 6px" },
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    textAlign: "end",
    whiteSpace: "nowrap",
    borderBottomWidth: 0,
  },
  playerCell: { maxWidth: "none", overflow: "visible", textAlign: "start", fontWeight: 600 },
  first: { borderStartStartRadius: "8px", borderEndStartRadius: "8px" },
  last: { borderStartEndRadius: "8px", borderEndEndRadius: "8px" },
  you: { backgroundColor: "rgba(255, 255, 255, 0.09)" },
  leader: { backgroundColor: "rgba(255, 210, 74, 0.13)" },
  empty: { backgroundColor: "rgba(255, 255, 255, 0.025)", color: "rgba(242, 242, 242, 0.5)" },
  kills: { fontWeight: 800, fontSize: "16px" },
  gold: { color: "var(--bagarre-gold)" },
  dot: { display: "inline-block", marginInlineEnd: "9px" },
  name: { fontWeight: 700 },
  tag: {
    display: { default: "inline", [NARROW]: "none" },
    marginInlineStart: "var(--spacing-2)",
    padding: "2px 6px",
    borderRadius: "4px",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    color: "var(--color-text-secondary)",
    fontSize: "11px",
    fontWeight: 700,
  },
  long: { display: { default: "inline", [NARROW]: "none" }, font: "inherit", letterSpacing: "inherit", color: "inherit" },
  short: { display: { default: "none", [NARROW]: "inline" }, textDecoration: "none" },
  hideNarrow: { display: { default: "table-cell", [NARROW]: "none" } },
  layer: {
    position: "fixed",
    inset: 0,
    zIndex: 30,
    display: "grid",
    placeItems: "start center",
    padding: "max(96px, 14vh) 16px 16px",
    pointerEvents: "none",
  },
});

function Row({ row, you, placed, testId }: { row: ScoreboardRow | null; you?: boolean; placed: boolean; testId: string }) {
  const tone = !row ? styles.empty : row.leader ? styles.leader : you ? styles.you : null;
  const values = row ? [String(row.kills), String(row.deaths), String(row.damage), row.accuracy, row.weapon, row.ping] : COLUMNS.map(() => "");
  return (
    <TableRow
      data-testid={testId}
      data-place={placed && row ? row.place : undefined}
      data-you={row?.you ? "" : undefined}
      data-leader={row?.leader ? "" : undefined}
      data-empty={row ? undefined : ""}
    >
      {placed && (
        <TableCell xstyle={[styles.cell, styles.first, tone, styles.place, row?.place === 1 && styles.placeFirst]}>
          {row?.placeLabel ?? ""}
        </TableCell>
      )}
      <TableHeaderCell scope="row" xstyle={[styles.cell, styles.playerCell, placed ? null : styles.first, tone]}>
        <HStack as="span" xstyle={[shared.dot, styles.dot, row ? slotDot(row.slot) : shared.dotOpen]} aria-hidden="true" />
        <Text as="span" xstyle={row ? styles.name : null}>
          {row ? (row.you ? `${row.name} (you)` : row.name) : "Open seat"}
        </Text>
        {row && <Text as="span" xstyle={styles.tag}>{row.account ? "Account" : "Guest"}</Text>}
        {placed && row?.away && (
          <Text as="span" xstyle={styles.away}>
            reconnecting…
          </Text>
        )}
      </TableHeaderCell>
      {COLUMNS.map((c, j) => (
        <TableCell
          key={c.key}
          xstyle={[
            styles.cell,
            j === COLUMNS.length - 1 && styles.last,
            tone,
            c.key === "kills" && styles.kills,
            c.key === "kills" && row?.leader && styles.gold,
            c.key === "weapon" && styles.hideNarrow,
          ]}
        >
          {values[j]}
        </TableCell>
      ))}
    </TableRow>
  );
}

export function Scoreboard({
  model,
  label = "Scoreboard",
  flat = false,
  rowTestId = "scoreboard-row",
}: {
  model: ScoreboardModel;
  label?: string;
  flat?: boolean;
  /** The result card's placement table marks its rows `placement-row`. */
  rowTestId?: string;
}) {
  countRender("scoreboard");
  // A free-for-all: a place column, and the clock counts down instead of the duel score.
  const ffa = model.mode === "ffa";
  return (
    <VStack as="section" aria-label={label} xstyle={[styles.board, flat && styles.flat]} data-testid="scoreboard">
      <HStack justify="between" align="end" gap={3} xstyle={styles.head}>
        <HStack gap={3} xstyle={styles.baseline}>
          <Text xstyle={[shared.display, styles.map]} data-testid="scoreboard-map">
            {model.mapName}
          </Text>
          <Text type="supporting" color="secondary">
            First to {ffa ? model.killsToWin : KILLS_TO_WIN}
          </Text>
        </HStack>
        {ffa ? (
          <HStack gap={3} xstyle={styles.baseline}>
            {model.suddenDeath ? (
              <Text xstyle={styles.sudden} data-testid="scoreboard-time">
                Sudden death
              </Text>
            ) : (
              model.timeLeft && (
                <Text xstyle={[styles.score, styles.time]} aria-label="Time left" data-testid="scoreboard-time">
                  {model.timeLeft}
                </Text>
              )
            )}
          </HStack>
        ) : (
          <HStack gap={3} xstyle={styles.baseline}>
            <Text xstyle={styles.score} data-testid="scoreboard-score">
              {model.score[0]} – {model.score[1]}
            </Text>
            <Text color="secondary" xstyle={styles.time} aria-label="Match time">
              {model.time}
            </Text>
          </HStack>
        )}
      </HStack>
      <Table density="compact" dividers="none" textOverflow="wrap" xstyle={styles.table}>
        <TableHeader>
          <TableRow isHeaderRow>
            {ffa && (
              <TableHeaderCell scope="col" xstyle={[styles.th, styles.thPlace]}>
                Place
              </TableHeaderCell>
            )}
            <TableHeaderCell scope="col" xstyle={[styles.th, styles.thPlayer]}>
              Player
            </TableHeaderCell>
            {COLUMNS.map((c) => (
              <TableHeaderCell key={c.key} scope="col" xstyle={[styles.th, c.key === "weapon" && styles.hideNarrow]}>
                <Text as="span" color="inherit" xstyle={styles.long}>
                  {c.label}
                </Text>
                <abbr title={c.label} {...stylex.props(styles.short)}>
                  {c.short}
                </abbr>
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {model.rows.map((r) => (
            <Row key={r.id} row={r} you={r.you} placed={ffa} testId={rowTestId} />
          ))}
          {/* An empty seat while waiting for an opponent. */}
          {!ffa && model.rows.length < 2 && <Row row={null} placed={false} testId={rowTestId} />}
        </TableBody>
      </Table>
    </VStack>
  );
}

/** The Tab scoreboard: up while Tab is held in a match with nothing else open. */
export function TabScoreboard() {
  const { app, view } = useEngine();
  const held = useSelector(app, (s) => s.screen === "game" && s.scoreboardHeld);
  const free = useSelector(view, (v) => v?.card === "none");
  if (!held || !free) return null;
  return <LiveBoard />;
}

function LiveBoard() {
  const { view } = useEngine();
  const model = useSelector(view, (v) => scoreboardModel(v?.snapshot ?? null, v?.you ?? ""), jsonEqual);
  return (
    <VStack role="dialog" aria-label="Scoreboard" xstyle={styles.layer} data-testid="scoreboard-layer">
      <Scoreboard model={model} />
    </VStack>
  );
}
