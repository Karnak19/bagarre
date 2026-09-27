// The open games list on the menu: public games with a free seat first
// (duels waiting for a second player, free-for-alls waiting or in progress:
// FFA takes players mid-match), then the ones to watch (full, or a duel
// under way). lobby.ts polls them while the menu is up. A click joins
// through the game's page, or watches through its watch page.

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
  watch: { color: "var(--color-text-secondary)", fontWeight: 700 },
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
        Join a game with a free seat, or watch one under way.
      </Text>
      {games.length > 0 && (
        <List density="compact" aria-live="polite" data-testid="open-games-list">
          {games.map((g) => {
            const map = findMap(g.mapId)?.name ?? "";
            const when = age(g.createdAt);
            const ffa = g.mode === "ffa";
            const mode = ffa ? "Free for all" : "Duel";
            const seats = `${g.players}/${g.maxPlayers} players`;
            // A free-for-all takes players mid-match; a duel under way is full.
            const live = g.phase !== "waiting";
            const watching = (g.spectators ?? 0) > 0 ? `${g.spectators} watching` : "";
            const details = [mode, seats, map, live ? "in progress" : when, watching].filter(Boolean).join(" · ");
            const verb = g.joinable ? "Join" : "Watch";
            return (
              <ListItem
                key={g.roomId}
                label={g.hostName || "Someone"}
                description={details}
                endContent={<Text xstyle={g.joinable ? styles.join : styles.watch}>{verb}</Text>}
                aria-label={`${verb} ${g.hostName || "a player"}'s ${mode.toLowerCase()} on ${map}, ${seats}, ${live ? "in progress" : `waiting ${when}`}`}
                data-testid="open-game"
                data-room={g.roomId}
                data-mode={g.mode}
                data-action={g.joinable ? "join" : "watch"}
                xstyle={styles.item}
                onClick={() => {
                  gesture();
                  if (g.joinable) app.joinListed(g.roomId);
                  else app.watchListed(g.roomId);
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
          {error ? "Can't reach the game server right now." : "No games right now. Press Play to open a game others can join."}
        </Text>
      )}
    </VStack>
  );
}
