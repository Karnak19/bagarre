// How each gun and grenade type looks and sounds: the client's half of the
// item definitions (WEAPONS and GRENADES in packages/shared/src/constants.ts,
// which say how to add one). Looked up by the item's `key`, never by its
// position, and typed as Record<key, ...>: an item missing here is a compile
// error.

import { FLASH, GRENADE, HEAL, SMOKE, STUN, WEAPONS, grenadeDef, isPickableWeapon, weaponDef, type GrenadeKey, type WeaponKey } from "@bagarre/shared";
import type { SfxName } from "./audio.ts";
import { Cell, type MuzzleFlash, type Vfx } from "./vfx.ts";

// --- Guns ----------------------------------------------------------------------

export interface GunModel {
  /** The gun's file under models/ (one mesh, barrel along +X, top up). */
  file: string;
  /** Where the hand closes on the handle, in the file's glTF coordinates. */
  grip: readonly [number, number, number];
  /** The barrel tip, in the file's glTF coordinates: flashes and tracers start here. */
  muzzle: readonly [number, number, number];
}

/**
 * A gun's bullet tracer: a small bright head with a warm streak behind it
 * that fades out (see tracers.ts). Visual only: the hit size is
 * BULLET_RADIUS whatever the look. All are much thinner than the old shared
 * 0.08 m bar, so they read as tracers rather than blaster bolts.
 */
export interface TracerLook {
  /** The streak's thickness, metres (the head is a bit thicker). */
  width: number;
  /** Head to tail tip, metres. */
  length: number;
  /** The bright head's length, metres. */
  head: number;
  /** The streak's opacity just behind the head (0-1); it fades to 0 at the tail. */
  glow: number;
}

export interface GunViewDef {
  /**
   * The gun in the hand. Grip and muzzle were measured by convert-guns.py
   * (guns.json), the grips set by hand on the preview renders.
   */
  model: GunModel;
  /**
   * The gun's size next to the character, in model units per gun-file unit
   * (the pack's guns are about as long as a character is tall). The small
   * guns are drawn a bit bigger so they still read from above.
   */
  scale: number;
  /** Muzzle flash: atlas cell, width and length in metres. */
  flash: MuzzleFlash;
  /** The bullet tracer. */
  tracer: TracerLook;
  /** The shot sound. */
  sfx: SfxName;
  /** Its line in How to play. */
  role: string;
}

export const GUN_VIEW: Record<WeaponKey, GunViewDef> = {
  rifle: {
    // AssaultRifle_2 (wooden AK)
    model: { file: "guns/rifle.glb", grip: [-0.05, 0, 0], muzzle: [3.8168, 0.6423, 0] },
    scale: 0.35,
    flash: { cell: Cell.MuzzleRifle, w: 0.45, h: 0.9 },
    tracer: { width: 0.04, length: 1.2, head: 0.15, glow: 0.85 },
    sfx: "rifle",
    role: "All-rounder",
  },
  shotgun: {
    // Shotgun_ShortStock (pump)
    model: { file: "guns/shotgun.glb", grip: [0, -0.05, 0], muzzle: [4.049, 0.3578, 0] },
    scale: 0.36,
    flash: { cell: Cell.MuzzleRound, w: 0.95, h: 1.05 },
    tracer: { width: 0.034, length: 0.45, head: 0.1, glow: 0.8 },
    sfx: "shotgun",
    role: "Close range",
  },
  sniper: {
    // SniperRifle_1 (green, scoped)
    model: { file: "guns/sniper.glb", grip: [-0.4, -0.15, 0.0747], muzzle: [5.2512, 0.2959, 0] },
    scale: 0.33,
    flash: { cell: Cell.MuzzleLong, w: 0.6, h: 1.5 },
    tracer: { width: 0.034, length: 2.8, head: 0.22, glow: 0.95 },
    sfx: "sniper",
    role: "Long range",
  },
  smg: {
    // SubmachineGun_1 (compact)
    model: { file: "guns/smg.glb", grip: [-0.15, 0, 0], muzzle: [2.2713, 0.621, 0] },
    scale: 0.42,
    flash: { cell: Cell.MuzzleSmall, w: 0.35, h: 0.6 },
    tracer: { width: 0.03, length: 0.8, head: 0.1, glow: 0.8 },
    sfx: "smg",
    role: "Mid range, fast",
  },
  revolver: {
    // Revolver_1
    model: { file: "guns/revolver.glb", grip: [-0.1, -0.1, 0], muzzle: [1.7399, 0.4635, 0] },
    scale: 0.48,
    flash: { cell: Cell.MuzzleRound, w: 0.55, h: 0.7 },
    tracer: { width: 0.044, length: 0.9, head: 0.16, glow: 0.9 },
    sfx: "revolver",
    role: "Six heavy, precise shots",
  },
  "burst-pistol": {
    // Pistol_6 (long slide)
    model: { file: "guns/burst-pistol.glb", grip: [-0.13, -0.1, 0], muzzle: [2.1092, 0.5807, 0] },
    scale: 0.46,
    flash: { cell: Cell.MuzzleSmall, w: 0.3, h: 0.45 },
    tracer: { width: 0.032, length: 0.6, head: 0.12, glow: 0.85 },
    sfx: "burst",
    role: "Three rounds per click",
  },
  dmr: {
    // AssaultRifle2_1 (black M4)
    model: { file: "guns/dmr.glb", grip: [-0.2, 0, 0.0017], muzzle: [3.6092, 0.6381, 0.0017] },
    scale: 0.35,
    flash: { cell: Cell.MuzzleLong, w: 0.5, h: 1.15 },
    tracer: { width: 0.036, length: 2.0, head: 0.18, glow: 0.9 },
    sfx: "dmr",
    role: "Long range, semi-auto",
  },
  pistol: {
    // The burst pistol's Pistol_6, a little smaller: the royale's starting gun.
    model: { file: "guns/burst-pistol.glb", grip: [-0.13, -0.1, 0], muzzle: [2.1092, 0.5807, 0] },
    scale: 0.4,
    flash: { cell: Cell.MuzzleSmall, w: 0.26, h: 0.4 },
    tracer: { width: 0.03, length: 0.5, head: 0.11, glow: 0.8 },
    sfx: "pistol",
    role: "The battle royale's starting gun: weak, find better in chests",
  },
};

/** The view of a weapon id (a WEAPONS index); an unknown id gets the default weapon's, like weaponDef. */
export function gunView(weapon: number): GunViewDef {
  return GUN_VIEW[weaponDef(weapon).key];
}

/**
 * The guns the loadout picker offers, by id: every gun but the starting-only
 * ones (the royale's Pistol, `pickable: false`), which come last in WEAPONS,
 * so a gun's number key is still its id + 1.
 */
export const PICKABLE_WEAPONS: readonly number[] = WEAPONS.map((_, i) => i).filter(isPickableWeapon);

/** The number keys that pick a weapon, as shown in hints ("1-7"). */
export const WEAPON_KEYS = `1-${PICKABLE_WEAPONS.length}`;

/** The weapon id a key picks (`KeyboardEvent.code`: Digit1 = weapon 0), or null. Only 1-9 are number keys, and never a starting-only gun. */
export function weaponOfKey(code: string): number | null {
  const m = /^Digit([1-9])$/.exec(code);
  if (!m) return null;
  const id = Number(m[1]) - 1;
  return isPickableWeapon(id) ? id : null;
}

// --- Grenades ------------------------------------------------------------------

/** What a blast's drawing can touch. */
export interface BlastFx {
  vfx: Vfx;
  /** Shakes the camera by this much. */
  shake(amount: number): void;
}

export interface GrenadeViewDef {
  /** One glyph, in the picker and the HUD. */
  icon: string;
  /** The landing telegraph's colour. */
  telegraph: number;
  /** The sound of it going off. */
  sfx: SfxName;
  /** Draws it going off at (x, z). `own`: we threw it. */
  draw(fx: BlastFx, x: number, z: number, now: number, own: boolean): void;
  /** What it does, in How to play (after "<Name>: ", before its cooldown). */
  blurb: string;
}

export const GRENADE_VIEW: Record<GrenadeKey, GrenadeViewDef> = {
  frag: {
    icon: "💥",
    telegraph: 0xff4030,
    sfx: "explosion",
    draw(fx, x, z, now, own) {
      fx.vfx.explosion(x, z, GRENADE.radius, now);
      // Our own frag shakes the camera a little.
      if (own) fx.shake(0.55);
    },
    blurb: "damage, hurts you too",
  },
  smoke: {
    icon: "💨",
    telegraph: 0xc8c8c0,
    sfx: "smoke_pop",
    draw: (fx, x, z) => fx.vfx.smokePop(x, z),
    blurb: `a ${SMOKE.radius} m cloud for ${SMOKE.duration} s that hides whoever is in or behind it from enemies, except your own team, who see through it (faded)`,
  },
  stun: {
    icon: "⚡",
    telegraph: 0x4ab8ff,
    sfx: "stun_zap",
    draw: (fx, x, z) => fx.vfx.stunBurst(x, z, STUN.radius),
    blurb: `${STUN.speedScale * 100}% speed and no dash for ${STUN.duration} s`,
  },
  flash: {
    icon: "✴️",
    telegraph: 0xffffff,
    sfx: "flashbang",
    draw: (fx, x, z) => fx.vfx.flashBurst(x, z),
    blurb: `a white screen up to ${FLASH.maxDuration} s, longest for whoever looks at it; turning away only shortens it, hide behind cover`,
  },
  heal: {
    icon: "💚",
    telegraph: 0x4ee07a,
    sfx: "heal_chime",
    draw: (fx, x, z) => fx.vfx.healBurst(x, z, HEAL.radius),
    blurb: `+${HEAL.amount} HP at once for you and your teammates in it, not through cover`,
  },
};

/** The view of a grenade type (a GRENADES index); an unknown type gets the frag's, like grenadeDef. */
export function grenadeView(kind: number): GrenadeViewDef {
  return GRENADE_VIEW[grenadeDef(kind).key];
}
