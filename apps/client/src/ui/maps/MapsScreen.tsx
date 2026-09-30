// The Maps page (`/maps`): every map, duel maps first, then the free for all
// maps, then the battle royale maps, each on a card with its plan (MapPlan.tsx), its size, the modes it
// is played in, the weapons it favours and a "Walk around" button that opens
// `/maps/<id>` (WalkScreen.tsx). It scrolls over the menu's attract scene.

import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { FFA_MAPS, MAPS, ROYALE_MAPS, type MapDef, type WeaponTag } from "@bagarre/shared";
import { useNavigate, useRouter } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { isFfa, isRoyale } from "../../minimap.ts";
import { useEngine, useSelector } from "../hooks.ts";
import { shared } from "../styles.ts";
import { MapPlan } from "./MapPlan.tsx";

const PHONE = "@media (max-width: 760px)";

/** How the Maps page names a map's favoured weapons (shared's WeaponTag). */
const WEAPON_LABELS: Record<WeaponTag, string> = { rifle: "Rifle", shotgun: "Shotgun", sniper: "Sniper", smg: "SMG" };

const styles = stylex.create({
  screen: {
    position: "fixed",
    inset: 0,
    zIndex: 20,
    overflowY: "auto",
    padding: {
      default: "clamp(24px, 5vh, 48px) clamp(24px, 4vw, 64px) clamp(20px, 4vh, 40px)",
      [PHONE]: "20px 16px 24px",
    },
    backgroundImage: "linear-gradient(180deg, rgba(10, 11, 16, 0.78) 0%, rgba(10, 11, 16, 0.7) 50%, rgba(10, 11, 16, 0.85) 100%)",
  },
  inner: { width: "100%", maxWidth: "1180px", marginInline: "auto" },
  title: { margin: 0, fontSize: { default: "44px", [PHONE]: "34px" }, lineHeight: 1, color: "var(--bagarre-sand)" },
  intro: { maxWidth: "60ch" },
  section: {
    marginBlockStart: "var(--spacing-3)",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--color-text-secondary)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))",
    gap: "var(--spacing-4)",
  },
  card: {
    display: "grid",
    gridTemplateColumns: { default: "150px minmax(0, 1fr)", [PHONE]: "112px minmax(0, 1fr)" },
    gap: "var(--spacing-4)",
    alignItems: "start",
    padding: "var(--spacing-4)",
  },
  name: { margin: 0, fontSize: "22px", lineHeight: 1.1 },
  blurb: { color: "var(--color-text-secondary)" },
  meta: { fontSize: "13px" },
  metaLabel: { color: "var(--color-text-secondary)" },
  walk: { alignSelf: "start", marginBlockStart: "var(--spacing-1)" },
});


/** The `/maps` route's page, while the flow is on the menu screen. */
export function MapsScreen() {
  const { app } = useEngine();
  const onMenu = useSelector(app, (s) => s.screen === "menu");
  return onMenu ? <Maps /> : null;
}

function Maps() {
  const router = useRouter();
  const navigate = useNavigate();
  const back = () => {
    // Opened from the menu: Back is the browser's, so Forward still works.
    if (router.state.location.state.fromMenu) router.history.back();
    else void navigate({ to: "/", replace: true });
  };
  return (
    <VStack as="main" aria-label="Maps" data-testid="maps" xstyle={styles.screen}>
      <VStack gap={4} xstyle={styles.inner}>
        <VStack as="header" gap={3} align="start">
          <Button label="Back" variant="ghost" size="sm" onClick={back} data-testid="maps-back" />
          <Heading level={1} xstyle={[shared.display, styles.title]}>
            Maps
          </Heading>
          <Text color="secondary" xstyle={styles.intro}>
            {MAPS.length} maps for duels, {FFA_MAPS.length} bigger ones for the free for all and team deathmatch, and
            bigger still for the battle royale. Walk around any of them before you play: no game, no
            opponent, just the map.
          </Text>
        </VStack>

        <Heading level={2} xstyle={styles.section}>
          Duel
        </Heading>
        <VStack as="ul" xstyle={styles.grid} aria-label="Duel maps">
          {MAPS.map((m) => (
            <MapCard key={m.id} map={m} />
          ))}
        </VStack>

        <Heading level={2} xstyle={styles.section}>
          Free for all and teams
        </Heading>
        <VStack as="ul" xstyle={styles.grid} aria-label="Free for all maps">
          {FFA_MAPS.map((m) => (
            <MapCard key={m.id} map={m} />
          ))}
        </VStack>

        <Heading level={2} xstyle={styles.section}>
          Battle royale
        </Heading>
        <VStack as="ul" xstyle={styles.grid} aria-label="Battle royale maps">
          {ROYALE_MAPS.map((m) => (
            <MapCard key={m.id} map={m} />
          ))}
        </VStack>
      </VStack>
    </VStack>
  );
}

function MapCard({ map }: { map: MapDef }) {
  const navigate = useNavigate();
  const ffa = isFfa(map) ? map : null;
  const royale = isRoyale(map) ? map : null;
  const players = ffa?.players ?? royale?.players;
  return (
    <VStack as="li" xstyle={[shared.hudPanel, styles.card]} data-testid={`map-card-${map.id}`} aria-label={map.name}>
      <MapPlan map={map} />
      <VStack gap={2} align="start">
        <Heading level={3} xstyle={[shared.display, styles.name]}>
          {map.name}
        </Heading>
        <Text xstyle={styles.blurb}>{map.blurb}</Text>
        <Text xstyle={[styles.meta, shared.tabular]} data-testid={`map-size-${map.id}`}>
          <Text as="span" xstyle={styles.metaLabel}>
            Size{" "}
          </Text>
          {map.halfX * 2} × {map.halfZ * 2} m
          {players && (
            <>
              {" · "}
              {players.min} to {players.max} players
            </>
          )}
        </Text>
        <HStack gap={1} wrap="wrap" aria-label="Modes">
          {royale ? (
            <Token label="Royale" size="sm" color="purple" data-testid={`map-royale-${map.id}`} />
          ) : (
            <Token label={ffa ? "Free for all" : "Duel"} size="sm" color={ffa ? "blue" : "orange"} />
          )}
          {ffa?.teams && <Token label="Teams" size="sm" color="red" data-testid={`map-teams-${map.id}`} />}
        </HStack>
        <HStack gap={1} wrap="wrap" align="center" aria-label="Favoured weapons">
          <Text as="span" xstyle={[styles.meta, styles.metaLabel]}>
            Favours
          </Text>
          {map.favours.map((w) => (
            <Token key={w} label={WEAPON_LABELS[w]} size="sm" color="gray" />
          ))}
        </HStack>
        <Button
          label="Walk around"
          variant="secondary"
          size="sm"
          xstyle={styles.walk}
          data-testid={`walk-${map.id}`}
          onClick={() => void navigate({ to: "/maps/$id", params: { id: map.id }, state: { fromMaps: true } })}
        />
      </VStack>
    </VStack>
  );
}
