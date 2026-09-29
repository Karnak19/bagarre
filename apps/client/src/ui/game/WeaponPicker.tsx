// The loadout: the weapons as toggle buttons (keys 1-7 do the same) and the
// grenade types (G cycles them), for the waiting and result cards. Only live
// while picks are accepted (dead, waiting, or between matches).

import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack } from "@astryxdesign/core/Layout";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Text } from "@astryxdesign/core/Text";
import { GRENADES, WEAPONS } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { countRender } from "../../renders.ts";
import { shallowEqual, useEngine, useSelector } from "../hooks.ts";
import { shared } from "../styles.ts";

/** One glyph per grenade type (GRENADES index), in the picker and the HUD. */
export const GRENADE_ICONS = ["💥", "💨", "⚡", "✴️"];

const styles = stylex.create({
  // Wraps: the seven weapons sit on two rows in the card.
  group: { display: "flex", flexWrap: "wrap", gap: "6px", width: "100%" },
});

export function WeaponPicker() {
  countRender("weaponPicker");
  const { app, view, gesture } = useEngine();
  const { pick, canPick } = useSelector(view, (v) => ({ pick: v?.pick ?? 0, canPick: !!v?.canPick }), shallowEqual);
  return (
    <ToggleButtonGroup
      type="single"
      label="Weapon for your next spawn"
      value={String(pick)}
      onChange={(v) => {
        if (v === null) return;
        gesture();
        app.pick(Number(v));
      }}
      isDisabled={!canPick}
      xstyle={styles.group}
      data-testid="weapon-picker"
    >
      {WEAPONS.map((w, i) => (
        <ToggleButton key={w.name} value={String(i)} label={w.name} data-testid={`pick-${i + 1}`}>
          <HStack as="span" gap={1.5} align="center">
            <Kbd keys={String(i + 1)} />
            {w.name}
          </HStack>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** The grenade types, next to the weapons: same rules (G cycles them), put in hand on the next spawn. */
export function GrenadePicker({ heading }: { heading: string }) {
  countRender("grenadePicker");
  const { app, view, gesture } = useEngine();
  const { pick, canPick } = useSelector(view, (v) => ({ pick: v?.grenadePick ?? 0, canPick: !!v?.canPick }), shallowEqual);
  return (
    <>
      <HStack gap={1.5} align="center">
        <Text as="p" xstyle={shared.eyebrow}>
          {heading}
        </Text>
        <Kbd keys="G" />
      </HStack>
      <ToggleButtonGroup
        type="single"
        label="Grenade for your next spawn"
        value={String(pick)}
        onChange={(v) => {
          if (v === null) return;
          gesture();
          app.pickGrenade(Number(v));
        }}
        isDisabled={!canPick}
        xstyle={styles.group}
        data-testid="grenade-picker"
      >
        {GRENADES.map((g, i) => (
          <ToggleButton key={g.key} value={String(i)} label={g.name} data-testid={`grenade-pick-${g.key}`}>
            <HStack as="span" gap={1.5} align="center">
              <Text as="span" aria-hidden>
                {GRENADE_ICONS[i]}
              </Text>
              {g.name}
            </HStack>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </>
  );
}
