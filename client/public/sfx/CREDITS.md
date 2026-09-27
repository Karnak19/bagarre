# Sound credits

Every sound here is CC0 (public domain dedication, no attribution required).
Credit is given anyway. The files were cut, made mono, levelled and encoded
to MP3 by `scripts/sfx/build.sh`, which lists the exact cut points.

The `dash` and `grenade_throw` whooshes have no file: `client/src/audio.ts`
synthesizes them from filtered noise when it loads (original work, CC0).

## The Free Firearm Sound Library

- Pack: "The Free Firearm Sound Library" (Prepared SFX Library), by Ben Jaszczak et al.
- URL: https://opengameart.org/content/the-free-firearm-sound-library
- License: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/ (per the page's License field: "Our team holds CC0 NO RIGHTS RESERVED for this library")

| Output | Source file |
| --- | --- |
| `rifle_1`, `rifle_2`, `rifle_3` | `AK-47/C_28P.wav` (AK-47, single shots, near distance) |
| `smg_1`, `smg_2`, `smg_3` | `PPSh/P_30P.wav` (PPSh, single shots, near distance) |
| `shotgun_1`, `shotgun_2` | `CD/H_21P.wav` (Charles Daly pump shotgun, near distance) |
| `sniper_1`, `sniper_2` | `Tikka/W_29P.wav` (Tikka T3 .30-06 bolt action, near distance) |
| `reload`, `empty_click` | `Model 12/K_22P.wav` (Winchester Model 12, the pump being racked, and a lone mechanical click) |

## Kenney Impact Sounds

- Pack: "Impact Sounds" 1.0, by Kenney (www.kenney.nl)
- URL: https://kenney.nl/assets/impact-sounds
- License: CC0 1.0 (Creative Commons Zero, stated on the page and in the pack's License.txt)

| Output | Source file |
| --- | --- |
| `hit_1`, `hit_2`, `hit_3` | `impactPunch_medium_000.ogg`, `impactPunch_medium_001.ogg`, `impactPunch_medium_003.ogg` |
| `hurt_1`, `hurt_2` | `impactPunch_heavy_000.ogg`, `impactPunch_heavy_002.ogg` |
| `death` (layer 1) | `impactPunch_heavy_001.ogg` |
| `grenade_bounce_1`, `grenade_bounce_2` | `impactMetal_light_000.ogg`, `impactMetal_light_001.ogg` |
| `shield_hit_1`, `shield_hit_2` | `impactGlass_light_000.ogg`, `impactGlass_light_002.ogg` |
| `shield_break` (layer 1) | `impactGlass_heavy_001.ogg` |

## Kenney Sci-Fi Sounds

- Pack: "Sci-Fi Sounds" 1.0, by Kenney (www.kenney.nl)
- URL: https://kenney.nl/assets/sci-fi-sounds
- License: CC0 1.0 (Creative Commons Zero, stated on the page and in the pack's License.txt)

| Output | Source file |
| --- | --- |
| `explosion_1` | `explosionCrunch_000.ogg` + `lowFrequency_explosion_000.ogg` |
| `explosion_2` | `explosionCrunch_002.ogg` + `lowFrequency_explosion_000.ogg` |
| `death` (layer 2) | `lowFrequency_explosion_001.ogg` |
| `shield_up` | `forceField_000.ogg` |
| `shield_break` (layer 2) | `forceField_003.ogg` |

## Kenney Interface Sounds

- Pack: "Interface Sounds" 1.0, by Kenney (www.kenney.nl)
- URL: https://kenney.nl/assets/interface-sounds
- License: CC0 1.0 (Creative Commons Zero, stated on the page and in the pack's License.txt)

| Output | Source file |
| --- | --- |
| `respawn` | `maximize_008.ogg` |
| `weapon_pick` | `switch_002.ogg` |
| `match_win` | `confirmation_004.ogg` |
| `match_lose` | `error_006.ogg` |
