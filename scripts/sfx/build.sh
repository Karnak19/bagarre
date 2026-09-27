#!/usr/bin/env bash
# Rebuilds client/public/sfx/*.mp3 from the original CC0 packs.
#
# Needs ffmpeg (with libmp3lame) on the PATH. Download and unpack the packs
# listed in client/public/sfx/CREDITS.md into one folder, then:
#
#   SRC=/path/to/packs scripts/sfx/build.sh
#
# Expected layout under $SRC:
#   Prepared SFX Library/...      (The Free Firearm Sound Library, .7z unpacked; `tar -xf` reads it on macOS)
#   impact-sounds/Audio/*.ogg     (Kenney Impact Sounds)
#   sci-fi-sounds/Audio/*.ogg     (Kenney Sci-Fi Sounds)
#   interface-sounds/Audio/*.ogg  (Kenney Interface Sounds)
#
# Every clip is cut, made mono 44.1 kHz, faded out, then levelled: the gain is
# chosen so the loudest 50 ms window lands on a per-sound target (dBFS RMS),
# and a limiter keeps peaks under -1 dBFS. Targets put the weapons together
# (sniper loudest), impacts a bit under, UI well under.
set -euo pipefail

SRC="${SRC:?set SRC to the folder holding the unpacked packs}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/client/public/sfx"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

FA="$SRC/Prepared SFX Library"
IMP="$SRC/impact-sounds/Audio"
SCI="$SRC/sci-fi-sounds/Audio"
UI="$SRC/interface-sounds/Audio"

# Trim leading and trailing silence (for the Kenney files).
TRIM="silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.004,areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.02,areverse"

# level <in.wav> <out.mp3> <target dBFS>
level() {
  local rms gain
  rms=$(ffmpeg -hide_banner -nostats -i "$1" -af "astats=length=0.05:measure_overall=RMS_peak:measure_perchannel=none" -f null - 2>&1 |
    grep -oE "RMS peak dB: -?[0-9.]+" | tail -1 | awk '{print $4}')
  gain=$(awk -v t="$3" -v r="$rms" 'BEGIN { printf "%.2f", t - r }')
  ffmpeg -hide_banner -loglevel error -y -i "$1" \
    -af "volume=${gain}dB,alimiter=limit=0.89:attack=1:release=40:level=disabled" \
    -ac 1 -ar 44100 -c:a libmp3lame -q:a 2 "$2"
  printf "%-22s rms %7s dB  gain %6s dB\n" "$(basename "$2")" "$rms" "$gain"
}

# cut <src> <start s> <dur s> <name> <target> [extra filters]
# Cuts a window out of a long recording (the firearm takes hold several shots each).
# The fade-out starts at FADE_AT (fraction of the window, default 0.45).
cut() {
  local fade_start
  fade_start=$(awk -v d="$3" -v f="${FADE_AT:-0.45}" 'BEGIN { printf "%.3f", d * f }')
  local fade_len
  fade_len=$(awk -v d="$3" -v s="$fade_start" 'BEGIN { printf "%.3f", d - s }')
  ffmpeg -hide_banner -loglevel error -y -ss "$2" -t "$3" -i "$1" \
    -af "pan=mono|c0=0.5*c0+0.5*c1,aresample=44100,highpass=f=35,afade=t=in:d=0.002,afade=t=out:st=${fade_start}:d=${fade_len}${6:+,$6}" \
    -c:a pcm_f32le "$TMP/$4.wav"
  level "$TMP/$4.wav" "$OUT/$4.mp3" "$5"
}

# one <src> <name> <target> [extra filters]   (whole file, silence trimmed)
one() {
  ffmpeg -hide_banner -loglevel error -y -i "$1" \
    -af "aformat=channel_layouts=mono,aresample=44100,$TRIM${4:+,$4}" -c:a pcm_f32le "$TMP/$2.wav"
  level "$TMP/$2.wav" "$OUT/$2.mp3" "$3"
}

# mix <a> <b> <gain b> <name> <target> [extra filters]   (two layers, both trimmed)
mix() {
  ffmpeg -hide_banner -loglevel error -y -i "$1" -i "$2" -filter_complex \
    "[0:a]aformat=channel_layouts=mono,aresample=44100,$TRIM[a];[1:a]aformat=channel_layouts=mono,aresample=44100,$TRIM,volume=$3[b];[a][b]amix=inputs=2:normalize=0:duration=longest${6:+,$6}" \
    -c:a pcm_f32le "$TMP/$4.wav"
  level "$TMP/$4.wav" "$OUT/$4.mp3" "$5"
}

rm -f "$OUT"/*.mp3

# --- Weapons (Free Firearm Sound Library, "near distance" takes) --------------
# Rifle: AK-47, three single shots from the same take.
cut "$FA/AK-47/C_28P.wav" 0.603 0.50 rifle_1 -10
cut "$FA/AK-47/C_28P.wav" 3.248 0.50 rifle_2 -10
cut "$FA/AK-47/C_28P.wav" 6.011 0.50 rifle_3 -10
# SMG: PPSh, short cuts so 10 shots a second don't smear.
cut "$FA/PPSh/P_30P.wav" 0.927 0.30 smg_1 -11.5
cut "$FA/PPSh/P_30P.wav" 4.346 0.30 smg_2 -11.5
cut "$FA/PPSh/P_30P.wav" 8.202 0.30 smg_3 -11.5
# Shotgun: Charles Daly pump, two shots.
cut "$FA/CD/H_21P.wav" 0.460 0.75 shotgun_1 -9
cut "$FA/CD/H_21P.wav" 3.071 0.75 shotgun_2 -9
# Sniper: Tikka T3 .30-06 bolt action, long tail, the loudest.
cut "$FA/Tikka/W_29P.wav" 0.574 1.10 sniper_1 -7.5
cut "$FA/Tikka/W_29P.wav" 5.661 1.10 sniper_2 -7.5
# Reload: the pump being racked back and forward on the Winchester Model 12.
# Handling noise is recorded ~30 dB under the shots, so it gets a denoise and a
# gate before being brought up.
QUIET="highpass=f=150,afftdn=nr=18:nf=-80:tn=1,agate=threshold=0.003:ratio=8:attack=0.5:release=30"
FADE_AT=0.85 cut "$FA/Model 12/K_22P.wav" 4.195 0.72 reload -15 "$QUIET"
# Empty click: the lone mechanical click earlier in that take.
FADE_AT=0.6 cut "$FA/Model 12/K_22P.wav" 3.270 0.14 empty_click -18 "$QUIET"

# --- Kenney -------------------------------------------------------------------
# Bullet hits a player (heard by everyone, positional).
one "$IMP/impactPunch_medium_000.ogg" hit_1 -14
one "$IMP/impactPunch_medium_001.ogg" hit_2 -14
one "$IMP/impactPunch_medium_003.ogg" hit_3 -14
# We got hurt (non-positional, heavier, a bit darker).
one "$IMP/impactPunch_heavy_000.ogg" hurt_1 -12 "lowpass=f=5000"
one "$IMP/impactPunch_heavy_002.ogg" hurt_2 -12 "lowpass=f=5000"
# Death: heavy punch over a low boom.
mix "$IMP/impactPunch_heavy_001.ogg" "$SCI/lowFrequency_explosion_001.ogg" 0.6 death -11 "afade=t=out:st=0.5:d=0.45"
# Grenade: landing clink, then the blast (crunch over a sub boom).
one "$IMP/impactMetal_light_000.ogg" grenade_bounce_1 -17
one "$IMP/impactMetal_light_001.ogg" grenade_bounce_2 -17
mix "$SCI/explosionCrunch_000.ogg" "$SCI/lowFrequency_explosion_000.ogg" 0.8 explosion_1 -7.5 "afade=t=out:st=0.9:d=0.5,atrim=0:1.45"
mix "$SCI/explosionCrunch_002.ogg" "$SCI/lowFrequency_explosion_000.ogg" 0.8 explosion_2 -7.5 "afade=t=out:st=0.9:d=0.5,atrim=0:1.45"
# Shield.
one "$SCI/forceField_000.ogg" shield_up -15 "afade=t=out:st=0.6:d=0.3"
one "$IMP/impactGlass_light_000.ogg" shield_hit_1 -15
one "$IMP/impactGlass_light_002.ogg" shield_hit_2 -15
mix "$IMP/impactGlass_heavy_001.ogg" "$SCI/forceField_003.ogg" 0.35 shield_break -12 "afade=t=out:st=0.35:d=0.2,atrim=0:0.55"
# Spawn, weapon choice and match end (UI, non-positional).
one "$UI/maximize_008.ogg" respawn -16
one "$UI/switch_002.ogg" weapon_pick -18
one "$UI/confirmation_004.ogg" match_win -13
one "$UI/error_006.ogg" match_lose -14

du -ch "$OUT"/*.mp3 | tail -1
