// The leaderboard panel, from the menu: the top accounts by wins (GET
// /leaderboard on the game server), read each time the panel opens. Your own
// row is highlighted when you are on it.

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { account, type LeaderboardEntry } from "../../auth.ts";
import { kd } from "../account/describe.ts";
import { useSelector } from "../hooks.ts";
import { shared } from "../styles.ts";

const styles = stylex.create({
  table: { borderCollapse: "separate", borderSpacing: "0 4px", fontSize: "14px", tableLayout: "auto", fontVariantNumeric: "tabular-nums" },
  th: {
    paddingBlock: "2px",
    paddingInline: "10px",
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--color-text-secondary)",
    textAlign: "end",
    whiteSpace: "nowrap",
    maxWidth: "none",
    overflow: "visible",
    borderBottomWidth: 0,
    backgroundColor: "transparent",
  },
  thStart: { textAlign: "start" },
  thPlayer: { textAlign: "start", width: "40%" },
  cell: {
    padding: "9px 10px",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    textAlign: "end",
    whiteSpace: "nowrap",
    borderBottomWidth: 0,
  },
  rank: { textAlign: "start", fontWeight: 800, color: "var(--color-text-secondary)", borderStartStartRadius: "8px", borderEndStartRadius: "8px" },
  rankFirst: { color: "var(--bagarre-gold)" },
  player: { textAlign: "start", fontWeight: 600, maxWidth: "none", overflow: "hidden", textOverflow: "ellipsis" },
  last: { borderStartEndRadius: "8px", borderEndEndRadius: "8px" },
  you: { backgroundColor: "rgba(255, 255, 255, 0.1)" },
});

type Load = { state: "loading" } | { state: "error" } | { state: "ok"; entries: LeaderboardEntry[] };

export function Leaderboard() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const me = useSelector(account, (s) => (s.status === "signedIn" ? (s.account?.username ?? null) : null));

  useEffect(() => {
    let live = true;
    account
      .leaderboard()
      .then((entries) => live && setLoad({ state: "ok", entries }))
      .catch(() => live && setLoad({ state: "error" }));
    return () => {
      live = false;
    };
  }, [attempt]);

  if (load.state === "loading")
    return (
      <VStack align="center" data-testid="leaderboard" data-state="loading">
        <Spinner />
      </VStack>
    );
  if (load.state === "error")
    return (
      <VStack data-testid="leaderboard" data-state="error">
        <EmptyState
          title="The leaderboard couldn't load"
          description="The game server didn't answer."
          isCompact
          actions={
            <Button
              label="Try again"
              onClick={() => {
                setLoad({ state: "loading" });
                setAttempt((n) => n + 1);
              }}
            />
          }
        />
      </VStack>
    );
  if (load.entries.length === 0)
    return (
      <VStack data-testid="leaderboard" data-state="empty">
        <EmptyState title="Nobody on the board yet" description="Sign in, pick a username and win a match to be the first." isCompact />
      </VStack>
    );

  return (
    <VStack gap={3} data-testid="leaderboard" data-state="ok">
      <Text color="secondary">The top players by wins. Stats count for signed-in players with a username.</Text>
      <Table density="compact" dividers="none" textOverflow="truncate" xstyle={styles.table}>
        <TableHeader>
          <TableRow isHeaderRow>
            <TableHeaderCell scope="col" xstyle={[styles.th, styles.thStart]}>
              #
            </TableHeaderCell>
            <TableHeaderCell scope="col" xstyle={[styles.th, styles.thPlayer]}>
              Player
            </TableHeaderCell>
            <TableHeaderCell scope="col" xstyle={styles.th}>
              Wins
            </TableHeaderCell>
            <TableHeaderCell scope="col" xstyle={styles.th}>
              K/D
            </TableHeaderCell>
            <TableHeaderCell scope="col" xstyle={styles.th}>
              Kills
            </TableHeaderCell>
            <TableHeaderCell scope="col" xstyle={styles.th}>
              Matches
            </TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {load.entries.map((e) => {
            const you = me !== null && e.username.toLowerCase() === me.toLowerCase();
            const tone = you && styles.you;
            return (
              <TableRow key={e.username} data-testid="leaderboard-row" data-username={e.username} data-you={you ? "true" : "false"}>
                <TableCell xstyle={[styles.cell, styles.rank, e.rank === 1 && styles.rankFirst, tone]}>{e.rank}</TableCell>
                <TableHeaderCell scope="row" xstyle={[styles.cell, styles.player, tone]}>
                  {e.username}
                </TableHeaderCell>
                <TableCell xstyle={[styles.cell, shared.tabular, tone]}>{e.wins}</TableCell>
                <TableCell xstyle={[styles.cell, tone]}>{kd(e.kills, e.deaths)}</TableCell>
                <TableCell xstyle={[styles.cell, tone]}>{e.kills}</TableCell>
                <TableCell xstyle={[styles.cell, styles.last, tone]}>{e.matches}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </VStack>
  );
}
