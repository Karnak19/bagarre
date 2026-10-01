// The loadout: the weapons as toggle buttons (the number keys do the same), the
// grenade types (G cycles them) and the perk (or none), for the waiting and result cards and the
// warmup panel. Only live while picks are accepted (dead, waiting, warmup, or
// between matches). `live`: the warmup's, over the running game, which hands
// the keyboard back to the game after a click (Space must dash, not press
// the button again).

import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack } from "@astryxdesign/core/Layout";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";
import { Text } from "@astryxdesign/core/Text";
import { GRENADES, NO_PERK, PERKS, WEAPONS } from "@bagarre/shared";
import * as stylex from "@stylexjs/stylex";
import { GRENADE_VIEW, PERK_VIEW, PICKABLE_WEAPONS } from "../../items.ts";
import { countRender } from "../../renders.ts";
import { shallowEqual, useEngine, useSelector } from "../hooks.ts";
import { shared } from "../styles.ts";

const styles = stylex.create({
  // Wraps: the seven weapons sit on two rows in the card.
  group: { display: "flex", flexWrap: "wrap", gap: "6px", width: "100%" },
});

/** After a click on a picker over the running game: the keyboard goes back to the game. */
function releaseFocus() {
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
}

export function WeaponPicker({ live = false }: { live?: boolean }) {
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
        if (live) releaseFocus();
      }}
      isDisabled={!canPick}
      xstyle={styles.group}
      data-testid="weapon-picker"
    >
      {PICKABLE_WEAPONS.map((i) => [WEAPONS[i], i] as const).map(([w, i]) => (
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
export function GrenadePicker({ heading, live = false }: { heading: string; live?: boolean }) {
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
          if (live) releaseFocus();
        }}
        isDisabled={!canPick}
        xstyle={styles.group}
        data-testid="grenade-picker"
      >
        {GRENADES.map((g, i) => (
          <ToggleButton key={g.key} value={String(i)} label={g.name} data-testid={`grenade-pick-${g.key}`}>
            <HStack as="span" gap={1.5} align="center">
              <Text as="span" aria-hidden>
                {GRENADE_VIEW[g.key].icon}
              </Text>
              {g.name}
            </HStack>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </>
  );
}

/**
 * The perk, next to the grenade: one or none (one slot), same rules as the
 * weapon, put in hand on the next spawn (at once in warmup). The battle
 * royale has no picker: its perks are loot.
 */
export function PerkPicker({ heading, live = false }: { heading: string; live?: boolean }) {
  countRender("perkPicker");
  const { app, view, gesture } = useEngine();
  const { pick, canPick } = useSelector(view, (v) => ({ pick: v?.perkPick ?? NO_PERK, canPick: !!v?.canPick }), shallowEqual);
  return (
    <>
      <Text as="p" xstyle={shared.eyebrow}>
        {heading}
      </Text>
      <ToggleButtonGroup
        type="single"
        label="Perk for your next spawn"
        value={String(pick)}
        onChange={(v) => {
          if (v === null) return;
          gesture();
          app.pickPerk(Number(v));
          if (live) releaseFocus();
        }}
        isDisabled={!canPick}
        xstyle={styles.group}
        data-testid="perk-picker"
      >
        <ToggleButton value={String(NO_PERK)} label="None" data-testid="perk-pick-none" />
        {PERKS.map((p, i) => (
          <ToggleButton key={p.key} value={String(i)} label={p.name} tooltip={PERK_VIEW[p.key].blurb} data-testid={`perk-pick-${p.key}`}>
            <HStack as="span" gap={1.5} align="center">
              <Text as="span" aria-hidden>
                {PERK_VIEW[p.key].icon}
              </Text>
              {p.name}
            </HStack>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </>
  );
}
