/**
 * Sound effects and music.
 *
 * - Files live in `apps/client/public/sfx/` (mono .mp3, built by scripts/sfx/build.sh,
 *   sources in CREDITS.md). The dash and grenade-throw whooshes and the heal
 *   chime have no file: they are rendered once at load time (filtered-noise
 *   sweeps, and a rising run of soft bell tones).
 * - Everything is fetched and decoded as soon as this module is imported, with
 *   an OfflineAudioContext, which browsers allow before any user gesture. The
 *   real AudioContext is only created by `initAudio()`, which must run inside a
 *   click or key handler (autoplay rules). Until both are ready, `play()` is a
 *   silent no-op.
 * - Positional sounds pan by where the source is ON SCREEN (the camera looks
 *   down the world diagonal), and get quieter with distance, gently: the arena
 *   is small and the opponent must always be heard.
 * - Music (see "Music" below) is one looping track at a time, on its own
 *   volume, under the master volume and mute like the effects.
 */

export type SfxName =
  | "rifle"
  | "shotgun"
  | "sniper"
  | "smg"
  | "revolver"
  | "burst"
  | "dmr"
  | "pistol"
  | "reload"
  | "empty_click"
  | "dash"
  | "grenade_throw"
  | "grenade_bounce"
  | "explosion"
  | "smoke_pop"
  | "stun_zap"
  | "flashbang"
  | "heal_chime"
  | "shield_up"
  | "shield_hit"
  | "shield_break"
  | "hit"
  | "hurt"
  | "death"
  | "respawn"
  | "weapon_pick"
  | "chest_open"
  | "match_win"
  | "match_lose";

export interface PlayOptions {
  /** World position of the source. Without it the sound is centred and not attenuated. */
  x?: number;
  z?: number;
  /** Extra gain on top of the sound's own level, 0..1 (default 1). */
  volume?: number;
  /**
   * Seconds from now to start. Use INTERP_DELAY_MS / 1000 for events read from
   * a snapshot about the opponent, so the sound lands when they are drawn.
   */
  delay?: number;
}

interface SfxDef {
  /** File basenames in /sfx/, one per variant. Empty for synthesized sounds. */
  files: string[];
  /** Level relative to the others (files are already levelled by the build script). */
  gain: number;
  /** Copies of this sound allowed at once; the oldest is cut when exceeded. */
  voices: number;
  /** Playback rate (pitch and speed), for sounds that reuse another's files. Default 1. */
  rate?: number;
}

const variants = (base: string, n: number) => Array.from({ length: n }, (_, i) => `${base}_${i + 1}`);

const DEFS: Record<SfxName, SfxDef> = {
  rifle: { files: variants("rifle", 3), gain: 0.9, voices: 4 },
  shotgun: { files: variants("shotgun", 2), gain: 0.95, voices: 3 },
  sniper: { files: variants("sniper", 2), gain: 1, voices: 2 },
  smg: { files: variants("smg", 3), gain: 0.75, voices: 4 },
  // The three later guns reuse those files, pitched: a sharper sniper crack
  // for the revolver, a light snappy rifle for the burst pistol, a deeper
  // rifle for the DMR.
  revolver: { files: variants("sniper", 2), gain: 0.85, voices: 2, rate: 1.3 },
  burst: { files: variants("rifle", 3), gain: 0.6, voices: 4, rate: 1.35 },
  dmr: { files: variants("rifle", 3), gain: 1, voices: 3, rate: 0.8 },
  // The royale's Pistol: the rifle again, lighter and higher than the burst pistol.
  pistol: { files: variants("rifle", 3), gain: 0.5, voices: 4, rate: 1.6 },
  reload: { files: ["reload"], gain: 0.8, voices: 2 },
  empty_click: { files: ["empty_click"], gain: 0.7, voices: 2 },
  dash: { files: [], gain: 0.55, voices: 2 },
  grenade_throw: { files: [], gain: 0.4, voices: 2 },
  grenade_bounce: { files: variants("grenade_bounce", 2), gain: 0.8, voices: 3 },
  explosion: { files: variants("explosion", 2), gain: 1, voices: 3 },
  // The utility grenades reuse files too: a soft low pop for the smoke, an
  // electric crackle for the stun, a sharp high bang for the flash.
  smoke_pop: { files: variants("grenade_bounce", 2), gain: 0.9, voices: 2, rate: 0.55 },
  stun_zap: { files: ["shield_break"], gain: 0.9, voices: 2, rate: 1.5 },
  flashbang: { files: variants("explosion", 2), gain: 0.8, voices: 2, rate: 1.7 },
  // The heal grenade: a soft rising chime, synthesized (renderChime).
  heal_chime: { files: [], gain: 0.5, voices: 2 },
  shield_up: { files: ["shield_up"], gain: 0.8, voices: 2 },
  shield_hit: { files: variants("shield_hit", 2), gain: 0.8, voices: 3 },
  shield_break: { files: ["shield_break"], gain: 0.9, voices: 2 },
  hit: { files: variants("hit", 3), gain: 0.8, voices: 4 },
  hurt: { files: variants("hurt", 2), gain: 0.85, voices: 2 },
  death: { files: ["death"], gain: 0.9, voices: 2 },
  respawn: { files: ["respawn"], gain: 0.7, voices: 2 },
  weapon_pick: { files: ["weapon_pick"], gain: 0.7, voices: 2 },
  // A battle royale chest's lid: the pump being racked, slower and deeper, a wooden clunk.
  chest_open: { files: ["reload"], gain: 0.85, voices: 3, rate: 0.6 },
  match_win: { files: ["match_win"], gain: 0.8, voices: 1 },
  match_lose: { files: ["match_lose"], gain: 0.8, voices: 1 },
};

const NAMES = Object.keys(DEFS) as SfxName[];

// --- Tuning ------------------------------------------------------------------
/** Random pitch spread on every play: +-4 %. */
const PITCH_JITTER = 0.04;
/** Metres to the side (on screen) at which a sound is panned all the way. */
const PAN_RANGE = 16;
/** Never pan fully into one speaker. */
const PAN_MAX = 0.75;
/** Distance falloff: gain = 1 / (1 + d / FALLOFF_DIST), floored at MIN_GAIN. */
const FALLOFF_DIST = 22;
const MIN_GAIN = 0.4;
/** Fade applied to a voice that gets stolen, seconds (avoids a click). */
const STEAL_FADE = 0.015;

// --- State -------------------------------------------------------------------
const buffers = new Map<SfxName, AudioBuffer[]>();
const lastVariant = new Map<SfxName, number>();
interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}
const active = new Map<SfxName, Voice[]>();
for (const n of NAMES) active.set(n, []);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** The music's own volume, into `master`. */
let musicBus: GainNode | null = null;
let listenerX = 0;
let listenerZ = 0;

const VOLUME_KEY = "bagarre.sfx.volume";
const MUTED_KEY = "bagarre.sfx.muted";
let volume = readNumber(VOLUME_KEY, 0.8);
let muted = readBool(MUTED_KEY, false);

function readNumber(key: string, fallback: number) {
  try {
    const v = localStorage.getItem(key);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  } catch {
    return fallback;
  }
}

export function readBool(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the setting just won't persist.
  }
}

// --- Loading -----------------------------------------------------------------
const LOAD_RATE = 44100;

function offline(seconds: number): OfflineAudioContext {
  return new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * LOAD_RATE)), LOAD_RATE);
}

async function loadFile(decoder: BaseAudioContext, base: string): Promise<AudioBuffer> {
  const res = await fetch(`${import.meta.env.BASE_URL}sfx/${base}.mp3`);
  if (!res.ok) throw new Error(`sfx ${base}: HTTP ${res.status}`);
  return decoder.decodeAudioData(await res.arrayBuffer());
}

/**
 * A whoosh: white noise through a band-pass whose centre sweeps up then down,
 * under a fast-attack envelope. Normalised to a 0.7 peak.
 */
async function renderWhoosh(dur: number, f0: number, fPeak: number, f1: number, q: number): Promise<AudioBuffer> {
  const oc = offline(dur);
  const noise = oc.createBuffer(1, oc.length, LOAD_RATE);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = oc.createBufferSource();
  src.buffer = noise;
  const bp = oc.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, 0);
  bp.frequency.exponentialRampToValueAtTime(fPeak, dur * 0.35);
  bp.frequency.exponentialRampToValueAtTime(f1, dur);
  const env = oc.createGain();
  env.gain.setValueAtTime(0.0001, 0);
  env.gain.exponentialRampToValueAtTime(1, dur * 0.18);
  env.gain.exponentialRampToValueAtTime(0.0001, dur);
  src.connect(bp).connect(env).connect(oc.destination);
  src.start();
  const out = await oc.startRendering();
  const ch = out.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 0) for (let i = 0; i < ch.length; i++) ch[i] *= 0.7 / peak;
  return out;
}

/**
 * A chime: soft bell tones (a sine and a quiet octave above it) rising
 * through `notes` (Hz), one every `step` seconds, each ringing out over
 * `ring` seconds. Normalised to a 0.7 peak.
 */
async function renderChime(notes: readonly number[], step: number, ring: number): Promise<AudioBuffer> {
  const dur = step * (notes.length - 1) + ring;
  const oc = offline(dur);
  for (const [i, f] of notes.entries()) {
    const t0 = i * step;
    const env = oc.createGain();
    env.gain.setValueAtTime(0.0001, 0);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(1, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + ring);
    env.connect(oc.destination);
    for (const [mul, level] of [
      [1, 1],
      [2, 0.25],
    ] as const) {
      const osc = oc.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f * mul;
      const g = oc.createGain();
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(t0);
      osc.stop(t0 + ring);
    }
  }
  const out = await oc.startRendering();
  const ch = out.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak > 0) for (let i = 0; i < ch.length; i++) ch[i] *= 0.7 / peak;
  return out;
}

async function loadAll() {
  const decoder = offline(1);
  await Promise.all(
    NAMES.map(async (name) => {
      const files = DEFS[name].files;
      if (files.length === 0) return;
      const list = await Promise.all(files.map((f) => loadFile(decoder, f)));
      buffers.set(name, list);
    }),
  );
  buffers.set("dash", [await renderWhoosh(0.3, 350, 2600, 600, 0.9), await renderWhoosh(0.28, 420, 3000, 700, 0.8)]);
  buffers.set("grenade_throw", [await renderWhoosh(0.2, 700, 3400, 1400, 1.2)]);
  // C5, E5, G5, C6.
  buffers.set("heal_chime", [await renderChime([523.25, 659.25, 783.99, 1046.5], 0.07, 0.6)]);
}

/** Resolves once every buffer is decoded (or failed; failures are logged and those sounds stay silent). */
export const audioReady: Promise<void> =
  typeof window === "undefined" || typeof OfflineAudioContext === "undefined"
    ? Promise.resolve()
    : loadAll().catch((err) => console.warn("[audio] loading failed:", err));

// --- Context -----------------------------------------------------------------
/**
 * Creates (or resumes) the AudioContext. Call it from a user gesture: the
 * first click or key press. Safe to call again on every gesture.
 */
export async function initAudio(): Promise<void> {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      applyMaster();
      // Glue for overlapping shots + blasts, so a busy moment doesn't clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 8;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      master.connect(comp).connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicVolume;
      musicBus.connect(master);
    }
    if (ctx.state !== "running") await ctx.resume();
    syncMusic();
  } catch (err) {
    console.warn("[audio] init failed:", err);
  }
}

/**
 * Convenience: calls `initAudio()` on the first pointer or key press, then
 * removes its listeners. (Also retries on later gestures if the context is
 * still suspended, e.g. after Safari suspended it in the background.)
 */
export function initAudioOnFirstGesture() {
  const onGesture = () => {
    void initAudio().then(() => {
      if (ctx?.state === "running") {
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown", onGesture, true);
      }
    });
  };
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
}

function applyMaster() {
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.01);
}

export function setMasterVolume(v: number) {
  volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  write(VOLUME_KEY, String(volume));
  applyMaster();
}

export function getMasterVolume() {
  return volume;
}

export function setMuted(m: boolean) {
  muted = m;
  write(MUTED_KEY, m ? "1" : "0");
  applyMaster();
  syncMusic();
}

export function isMuted() {
  return muted;
}

/** Where the local player is, in world x/z. Update every frame. */
export function setListener(x: number, z: number) {
  listenerX = x;
  listenerZ = z;
}

// --- Playback ----------------------------------------------------------------
function pickVariant(name: SfxName, count: number) {
  if (count <= 1) return 0;
  const last = lastVariant.get(name) ?? -1;
  // Never the same variant twice in a row.
  let i = Math.floor(Math.random() * (count - 1));
  if (i >= last) i++;
  lastVariant.set(name, i);
  return i;
}

function steal(v: Voice, now: number) {
  v.gain.gain.cancelScheduledValues(now);
  v.gain.gain.setValueAtTime(v.gain.gain.value, now);
  v.gain.gain.linearRampToValueAtTime(0, now + STEAL_FADE);
  try {
    v.src.stop(now + STEAL_FADE + 0.005);
  } catch {
    // Already stopped.
  }
}

/**
 * Plays a sound. A silent no-op until `initAudio()` ran and the buffers are
 * decoded. With `x`/`z` the sound is panned and attenuated relative to the
 * listener (see `setListener`).
 */
export function play(name: SfxName, opts?: PlayOptions) {
  if (!ctx || !master || ctx.state !== "running") return;
  const list = buffers.get(name);
  if (!list || list.length === 0) return;
  try {
    const def = DEFS[name];
    const now = ctx.currentTime;
    const at = now + Math.max(0, opts?.delay ?? 0);
    let level = def.gain * (opts?.volume ?? 1);
    let pan = 0;
    if (opts?.x !== undefined && opts.z !== undefined) {
      const dx = opts.x - listenerX;
      const dz = opts.z - listenerZ;
      // Iso camera, yaw 45 degrees: screen-right on the ground is (1, 0, -1)/sqrt(2).
      const screenX = (dx - dz) * Math.SQRT1_2;
      pan = Math.max(-1, Math.min(1, screenX / PAN_RANGE)) * PAN_MAX;
      const dist = Math.sqrt(dx * dx + dz * dz);
      level *= Math.max(MIN_GAIN, 1 / (1 + dist / FALLOFF_DIST));
    }

    const voices = active.get(name)!;
    while (voices.length >= def.voices) steal(voices.shift()!, now);

    const src = ctx.createBufferSource();
    src.buffer = list[pickVariant(name, list.length)];
    src.playbackRate.value = (def.rate ?? 1) * (1 + (Math.random() * 2 - 1) * PITCH_JITTER);
    const gain = ctx.createGain();
    gain.gain.value = level;
    src.connect(gain);
    if (pan !== 0 && typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p).connect(master);
    } else {
      gain.connect(master);
    }

    const voice: Voice = { src, gain };
    voices.push(voice);
    src.onended = () => {
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
      gain.disconnect();
    };
    src.start(at);
  } catch (err) {
    console.warn(`[audio] play ${name} failed:`, err);
  }
}

/** Durations of every decoded buffer, in seconds (for checks and debugging). */
export function loadedDurations(): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [name, list] of buffers) out[name] = list.map((b) => b.duration);
  return out;
}

/** Sounds playing or scheduled right now (for the dev leak check). */
export function activeVoiceCount(): number {
  let n = 0;
  for (const list of active.values()) n += list.length;
  return n;
}

// --- Music -------------------------------------------------------------------
// - Files live in `apps/client/public/music/` (stereo .mp3, built by
//   scripts/music/build.sh, credits in CREDITS.md): the menu's track and four
//   match tracks. What should play is set by `setMusic()`, which the frame
//   loop calls every frame (engine.ts); it only acts on a change.
// - Gapless: an AudioBufferSourceNode looping between the points build.sh
//   printed (an <audio loop> leaves a gap at the wrap). The intro before the
//   loop start plays once.
// - Memory: a decoded track is ~50 MB of float32 (2.5 min, stereo). So a
//   track is fetched and decoded only when it is about to play, and dropped
//   once it has faded out: at most two are held, the one playing and the one
//   fading out. None while the music volume is 0 or everything is muted
//   (unmuting starts the track again from its top).
// - Silent until `initAudio()` ran (autoplay rules), like the effects. A
//   track that fails to load is logged once and the music stays silent.

export type MusicTrack = "menu" | "match_1" | "match_2" | "match_3" | "match_4";
/** What should be heard: the menu's track, a match track, or nothing. */
export type MusicMood = "menu" | "match" | "off";

/** Loop points in seconds, as printed by scripts/music/build.sh. */
const MUSIC: Record<MusicTrack, { loopStart: number; loopEnd: number }> = {
  menu: { loopStart: 70.165283, loopEnd: 148.925782 },
  match_1: { loopStart: 49.871043, loopEnd: 143.770317 },
  match_2: { loopStart: 56.279751, loopEnd: 155.168912 },
  match_3: { loopStart: 16.898707, loopEnd: 110.89068 },
  match_4: { loopStart: 53.539796, loopEnd: 160.206054 },
};
const MATCH_TRACKS: readonly MusicTrack[] = ["match_1", "match_2", "match_3", "match_4"];

/** From one track to the next, seconds (equal power). */
const MUSIC_CROSSFADE = 1.5;
/** To silence, seconds: at a match end, so the win or lose sting is heard clearly. */
const MUSIC_FADE_OUT = 0.8;

interface MusicVoice {
  track: MusicTrack;
  src: AudioBufferSourceNode;
  /** Fades in on start; fades out on a gain node of its own, so the two never overlap on one param. */
  fadeOut: GainNode;
}

const MUSIC_VOLUME_KEY = "bagarre.music.volume";
let musicVolume = readNumber(MUSIC_VOLUME_KEY, 0.5);
let musicMood: MusicMood = "off";
/** The track the mood asks for (picked when the mood changes, even with no sound). */
let wantedTrack: MusicTrack | null = null;
let lastMatchTrack: MusicTrack | null = null;
let playing: MusicVoice | null = null;
let fading: MusicVoice | null = null;
let loading: { track: MusicTrack; abort: AbortController } | null = null;

/** `n` points of an equal-power fade, rising (sin) or falling (cos). */
function fadeCurve(rise: boolean, n = 64) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = ((i / (n - 1)) * Math.PI) / 2;
    c[i] = rise ? Math.sin(a) : Math.cos(a);
  }
  return c;
}

/** Falls quicker than the equal-power one: -12 dB by half-way. */
function silenceCurve(n = 64) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = (1 - i / (n - 1)) ** 2;
  return c;
}

/**
 * Sets what the music plays. Idempotent: call it every frame. A new "match"
 * picks a match track at random, never the previous game's.
 */
export function setMusic(mood: MusicMood) {
  if (mood === musicMood) return;
  musicMood = mood;
  if (mood === "menu") wantedTrack = "menu";
  else if (mood === "off") wantedTrack = null;
  else {
    const choices = MATCH_TRACKS.filter((t) => t !== lastMatchTrack);
    wantedTrack = choices[Math.floor(Math.random() * choices.length)];
    lastMatchTrack = wantedTrack;
  }
  syncMusic();
}

export function setMusicVolume(v: number) {
  musicVolume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  write(MUSIC_VOLUME_KEY, String(musicVolume));
  if (musicBus && ctx) musicBus.gain.setTargetAtTime(musicVolume, ctx.currentTime, 0.01);
  syncMusic();
}

export function getMusicVolume() {
  return musicVolume;
}

/** Brings what plays in line with the mood, the volume and mute. Safe to call any time. */
function syncMusic() {
  if (!ctx || !musicBus || ctx.state !== "running") return;
  const target = musicVolume > 0 && !muted ? wantedTrack : null;
  if (loading && loading.track !== target) {
    loading.abort.abort();
    loading = null;
  }
  if (playing?.track === target || loading) return;
  if (target === null) {
    fadeOutPlaying(MUSIC_FADE_OUT, silenceCurve());
    return;
  }
  const abort = new AbortController();
  const job = { track: target, abort };
  loading = job;
  void loadTrack(target, abort.signal).then((buffer) => {
    if (loading !== job) return; // superseded meanwhile: the buffer is dropped
    loading = null;
    if (buffer) startTrack(target, buffer);
  });
}

async function loadTrack(track: MusicTrack, signal: AbortSignal): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}music/${track}.mp3`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    if (signal.aborted || !ctx) return null;
    return await ctx.decodeAudioData(data);
  } catch (err) {
    if (!signal.aborted) console.warn(`[audio] music ${track} failed:`, err);
    return null;
  }
}

function startTrack(track: MusicTrack, buffer: AudioBuffer) {
  if (!ctx || !musicBus) return;
  try {
    const now = ctx.currentTime;
    fadeOutPlaying(MUSIC_CROSSFADE, fadeCurve(false));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const { loopStart, loopEnd } = MUSIC[track];
    // Out of range (a file rebuilt without updating MUSIC): loop the whole buffer.
    if (loopEnd <= buffer.duration) {
      src.loopStart = loopStart;
      src.loopEnd = loopEnd;
    }
    const fadeIn = ctx.createGain();
    fadeIn.gain.setValueCurveAtTime(fadeCurve(true), now, MUSIC_CROSSFADE);
    const fadeOut = ctx.createGain();
    src.connect(fadeIn).connect(fadeOut).connect(musicBus);
    src.start(now);
    playing = { track, src, fadeOut };
  } catch (err) {
    console.warn(`[audio] music ${track} failed:`, err);
  }
}

/** Fades the playing track out and lets it go. One already fading is cut: never more than two held. */
function fadeOutPlaying(seconds: number, curve: Float32Array) {
  if (!ctx) return;
  if (fading) stopVoice(fading);
  const v = playing;
  playing = null;
  if (!v) return;
  fading = v;
  try {
    const now = ctx.currentTime;
    v.fadeOut.gain.setValueCurveAtTime(curve, now, seconds);
    v.src.stop(now + seconds + 0.05);
    v.src.onended = () => {
      if (fading === v) fading = null;
      v.fadeOut.disconnect();
    };
  } catch {
    stopVoice(v);
  }
}

function stopVoice(v: MusicVoice) {
  if (fading === v) fading = null;
  try {
    v.src.stop();
  } catch {
    // Already stopped.
  }
  v.fadeOut.disconnect();
}

/**
 * The music's state, for the tests: whether the context runs (unlocked, and
 * the browser has audio), the mood, the track it asks for, the one heard
 * (null until it is decoded), and how many decoded tracks are held.
 */
export function musicDebug() {
  return {
    running: ctx?.state === "running",
    mood: musicMood,
    wanted: wantedTrack,
    playing: playing?.track ?? null,
    held: (playing ? 1 : 0) + (fading ? 1 : 0),
  };
}
