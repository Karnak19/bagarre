// The weapons as toggle buttons (keys 1-7 do the same), for the waiting
// and result cards. Only live while picks are accepted (dead, waiting, or
// between matches).

import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack } from "@astryxdesign/core/Layout";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { WEAPONS } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { countRender } from "../../renders.ts";
import { shallowEqual, useEngine, useSelector } from "../hooks.ts";

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
