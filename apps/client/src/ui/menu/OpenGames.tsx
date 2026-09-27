// The open games list on the menu: public games with a free seat, duels
// waiting for a second player and free-for-alls (waiting, or in progress:
// FFA takes players mid-match). lobby.ts polls them while the menu is up. A
// click joins through the game's page.

import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { findMap } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { useEngine, useStore } from "../hooks.ts";
import { shared } from "../styles.ts";

function age(createdAt: number): string {
  const s = Math.max(0, (Date.now() - createdAt) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`;
}

const styles = stylex.create({
  box: {
    padding: "14px 14px 12px",
    borderRadius: "10px",
    backgroundColor: "var(--bagarre-hud-panel)",
  },
  title: { fontSize: "18px", letterSpacing: "0.03em", marginInline: "2px" },
  hint: { marginInline: "2px", marginBlockEnd: "var(--spacing-1)" },
  item: {
    borderRadius: "var(--radius-element)",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  join: { color: "var(--color-text-blue)", fontWeight: 700 },
  state: { marginInline: "2px" },
  error: { color: "#ffab98" },
});

export function OpenGames() {
  const { app, lobby, gesture } = useEngine();
  const { games, error, loaded } = useStore(lobby);

  return (
    <VStack as="section" gap={1} aria-labelledby="games-title" xstyle={styles.box} data-testid="open-games">
      <Heading level={2} id="games-title" xstyle={[shared.display, styles.title]}>
        Open games
      </Heading>
      <Text type="supporting" color="secondary" xstyle={styles.hint}>
        Games with a free seat. Pick one to join.
      </Text>
      {games.length > 0 && (
        <List density="compact" aria-live="polite" data-testid="open-games-list">
          {games.map((g) => {
            const map = findMap(g.mapId)?.name ?? "";
            const when = age(g.createdAt);
            const ffa = g.mode === "ffa";
            const mode = ffa ? "Free for all" : "Duel";
            const seats = `${g.players}/${g.maxPlayers} players`;
            // A free-for-all takes players mid-match.
            const live = ffa && g.phase !== "waiting";
            const details = [mode, seats, map, live ? "in progress" : when].filter(Boolean).join(" · ");
            return (
              <ListItem
                key={g.roomId}
                label={g.hostName || "Someone"}
                description={details}
                endContent={<Text xstyle={styles.join}>Join</Text>}
                aria-label={`Join ${g.hostName || "a player"}'s ${mode.toLowerCase()} on ${map}, ${seats}, ${live ? "in progress" : `waiting ${when}`}`}
                data-testid="open-game"
                data-room={g.roomId}
                data-mode={g.mode}
                xstyle={styles.item}
                onClick={() => {
                  gesture();
                  app.joinListed(g.roomId);
                }}
              />
            );
          })}
        </List>
      )}
      {games.length === 0 && loaded && (
        <Text
          type="supporting"
          color={error ? undefined : "secondary"}
          xstyle={[styles.state, error && styles.error]}
          data-testid="open-games-empty"
        >
          {error ? "Can't reach the game server right now." : "No one is waiting right now. Press Play to open a game others can join."}
        </Text>
      )}
    </VStack>
  );
}
