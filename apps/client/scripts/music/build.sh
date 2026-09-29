#!/usr/bin/env bash
# Rebuilds apps/client/public/music/*.mp3 from the Suno songs listed in
# apps/client/public/music/CREDITS.md.
#
# Needs ffmpeg (with libmp3lame) on the PATH. Put the five downloaded .m4a
# files in one folder (under the names below), then, from apps/client:
#
#   bun run music:build /path/to/songs
#
# Each song becomes one file that loops without a seam:
#
#   [ intro ... loop body A..B, its last CROSSFADE crossfaded into the music just before A ][ TAIL ]
#
# - A and B are cut points (samples at 44.1 kHz) found by find-loop.ts: B is
#   before the song's ending, and the music around A sounds like the music
#   around B (same section, same beat phase).
# - The last CROSSFADE seconds before B blend (equal power) into the
#   CROSSFADE seconds before A, so what plays at B is what comes right before
#   A: jumping from B to A carries on without a gap, click or dip. The intro
#   before A plays once, on the first pass.
# - TAIL: the first seconds after A are copied after B. audio.ts loops from
#   A + LOOP_OFFSET to B + LOOP_OFFSET (inside the tail). Both points hold the
#   same samples, so the loop stays seamless even if a browser leaves the mp3
#   encoder delay (~25 ms) at the start of the decoded buffer: it shifts both
#   points alike.
# - One static gain per song brings its loop body to TARGET LUFS (integrated).
#   No limiter or dynamic normalisation: those would make the tail differ
#   from the samples after A.
#
# It prints each file's loop points (seconds) for MUSIC in src/audio.ts.
set -euo pipefail

SRC="${1:?usage: build.sh <folder with the Suno .m4a files>}"
CLIENT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$CLIENT/public/music"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

RATE=44100
CROSSFADE=1.0
TAIL=0.5
LOOP_OFFSET=0.25
# Loudness of every loop body. The sfx peak around -21 LUFS momentary per
# gunshot (mono, so about -18 once on both speakers) and -14 for a blast; with
# the default music volume (0.5, -6 dB) the music sits near -26 LUFS, under
# them.
TARGET=-20

# track <source .m4a> <output name> <A sample> <B sample>
track() {
  local wav="$TMP/$2.wav" xf tail loud gain
  ffmpeg -hide_banner -loglevel error -y -i "$SRC/$1" -af "aresample=$RATE:resampler=soxr" -ac 2 -c:a pcm_f32le "$wav"
  xf=$(awk -v c="$CROSSFADE" -v r="$RATE" 'BEGIN { printf "%d", c * r }')
  tail=$(awk -v c="$TAIL" -v r="$RATE" 'BEGIN { printf "%d", c * r }')
  loud=$(ffmpeg -hide_banner -nostats -i "$wav" -af "atrim=start_sample=$3:end_sample=$4,ebur128" -f null - 2>&1 |
    grep -A2 "Integrated loudness" | grep -oE "I: +-?[0-9.]+" | awk '{print $2}')
  gain=$(awk -v t="$TARGET" -v l="$loud" 'BEGIN { printf "%.2f", t - l }')
  ffmpeg -hide_banner -loglevel error -y -i "$wav" -filter_complex "\
[0:a]asplit=3[s1][s2][s3];\
[s1]atrim=end_sample=$4[body];\
[s2]atrim=start_sample=$(($3 - xf)):end_sample=$3,asetpts=N/SR/TB[pre];\
[s3]atrim=start_sample=$3:end_sample=$(($3 + tail)),asetpts=N/SR/TB[tail];\
[body][pre]acrossfade=ns=$xf:c1=qsin:c2=qsin[looped];\
[looped][tail]concat=n=2:v=0:a=1,volume=${gain}dB[out]" \
    -map "[out]" -ar $RATE -ac 2 -c:a libmp3lame -b:a 128k "$OUT/$2.mp3"
  awk -v n="$2" -v a="$3" -v b="$4" -v r="$RATE" -v o="$LOOP_OFFSET" -v l="$loud" -v g="$gain" 'BEGIN {
    printf "%-8s loopStart %.6f  loopEnd %.6f  (body %.2f s, was %s LUFS, gain %s dB)\n", n, a / r + o, b / r + o, (b - a) / r, l, g
  }'
}

rm -f "$OUT"/*.mp3

# Menu: chill synthwave, ~98 BPM. The loop is 128 beats (32 bars).
track "Warm Analog Groove.m4a" menu 3083264 6556602
# Match tracks: energetic electronic, ~143 BPM.
track "Arcade Rush.m4a" match_1 2188288 6329246
track "Arcade Rush (1).m4a" match_2 2470912 6831924
track "arcade shooter.m4a" match_3 734208 4879254
track "arcade shooter energy.m4a" match_4 2350080 7054062

du -ch "$OUT"/*.mp3 | tail -1
