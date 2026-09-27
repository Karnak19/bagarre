// The How to play panel: the rules, the keys, the weapons and the abilities,
// all read from the shared balance tables so it never drifts from the game.

import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { DASH, GRENADE, KILLS_TO_WIN, SHIELD, TEAM_KILLS_TO_WIN, TEAM_SIZE, TEAM_TIME_LIMIT, WEAPONS } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { shared } from "../styles.ts";

const WEAPON_ROLES = [
  "All-rounder",
  "Close range",
  "Long range",
  "Mid range, fast",
  "Six heavy, precise shots",
  "Three rounds per click",
  "Long range, semi-auto",
];

const k = (keys: string) => <Kbd keys={keys} />;

const CONTROLS: [ReactNode, string][] = [
  [<>{k("W")}{k("A")}{k("S")}{k("D")} or arrows</>, "Move, relative to the screen"],
  ["Mouse", "Aim"],
  ["Left button", "Fire (hold)"],
  [k("R"), "Reload (also automatic when empty)"],
  [k("Space"), "Dash"],
  [k("Q"), "Grenade, thrown at the cursor"],
  [k("E"), "Shield"],
  [<>{k("1")}–{k("4")}</>, "Pick a weapon, while dead or between matches"],
  [k("Tab"), "Scoreboard (hold)"],
  [k("M"), "Mute or unmute"],
  [k("Esc"), "Match menu: settings, leave"],
];

const styles = stylex.create({
  section: {
    marginBlockStart: "var(--spacing-5)",
    marginBlockEnd: "var(--spacing-2)",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--color-text-secondary)",
  },
  keys: { gridTemplateColumns: "max-content 1fr", alignItems: "center" },
  keyCell: { whiteSpace: "nowrap", color: "var(--color-text-secondary)" },
  note: { maxWidth: "62ch", marginBlockStart: "var(--spacing-3)" },
});

function Section({ children }: { children: string }) {
  return (
    <Heading level={3} xstyle={styles.section}>
      {children}
    </Heading>
  );
}

export function HowToPlay() {
  return (
    <VStack gap={0} data-testid="howto">
      <Text>
        A 1v1 duel. First to {KILLS_TO_WIN} kills wins, and the next match starts a few seconds later on another map.
      </Text>
      <Text>
        Team deathmatch: red against blue, up to {TEAM_SIZE}v{TEAM_SIZE}. The first team to {TEAM_KILLS_TO_WIN} kills wins, or
        the team ahead after {TEAM_TIME_LIMIT / 60} minutes. Your bullets and grenades never hurt a teammate, nor you.
      </Text>

      <Section>Controls</Section>
      <Grid columnGap={5} rowGap={2} xstyle={styles.keys}>
        {CONTROLS.flatMap(([keys, what]) => [
          <HStack key={`k-${what}`} as="span" gap={0.5} align="center" xstyle={styles.keyCell}>
            {keys}
          </HStack>,
          <Text key={what}>{what}</Text>,
        ])}
      </Grid>
      <Text type="supporting" color="secondary" xstyle={styles.note}>
        Keys are read by where they sit on the keyboard, not by their label. On AZERTY you move with {k("Z")}
        {k("Q")}
        {k("S")}
        {k("D")} and throw grenades with {k("A")}.
      </Text>

      <Section>Weapons</Section>
      <List density="compact">
        {WEAPONS.map((w, i) => (
          <ListItem
            key={w.name}
            startContent={k(String(i + 1))}
            label={w.name}
            description={WEAPON_ROLES[i]}
            endContent={
              <Text type="supporting" color="secondary" xstyle={shared.tabular}>
                {w.pellets > 1 || w.burst ? `${w.burst ?? w.pellets} × ${w.damage}` : w.damage} dmg · {w.range} m · {w.magazine} rounds
              </Text>
            }
          />
        ))}
      </List>
      <Text type="supporting" color="secondary">
        Your pick goes in your hand on your next spawn.
      </Text>

      <Section>Abilities</Section>
      <List density="compact">
        <ListItem
          startContent={k("Space")}
          label="Dash"
          description={`A ${DASH.distance} m burst where you're heading. No invulnerability: get out of the bullet's path. ${DASH.cooldown} s cooldown.`}
        />
        <ListItem
          startContent={k("Q")}
          label="Grenade"
          description={`Lobbed up to ${GRENADE.range} m, over cover. It blows ${GRENADE.fuse} s after landing: leave the red circle. Hurts you too. ${GRENADE.cooldown} s cooldown.`}
        />
        <ListItem
          startContent={k("E")}
          label="Shield"
          description={`Soaks ${SHIELD.absorb} damage for ${SHIELD.duration} s. ${SHIELD.cooldown} s cooldown.`}
        />
      </List>
    </VStack>
  );
}
