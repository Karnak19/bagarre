/**
 * Sound effects.
 *
 * - Files live in `client/public/sfx/` (mono .mp3, built by scripts/sfx/build.sh,
 *   sources in CREDITS.md). The dash and grenade-throw whooshes have no file:
 *   they are filtered-noise sweeps rendered once at load time.
 * - Everything is fetched and decoded as soon as this module is imported, with
 *   an OfflineAudioContext, which browsers allow before any user gesture. The
 *   real AudioContext is only created by `initAudio()`, which must run inside a
 *   click or key handler (autoplay rules). Until both are ready, `play()` is a
 *   silent no-op.
 * - Positional sounds pan by where the source is ON SCREEN (the camera looks
 *   down the world diagonal), and get quieter with distance, gently: the arena
 *   is small and the opponent must always be heard.
 */

export type SfxName =
  | "rifle"
  | "shotgun"
  | "sniper"
  | "smg"
  | "reload"
  | "empty_click"
  | "dash"
  | "grenade_throw"
  | "grenade_bounce"
  | "explosion"
  | "shield_up"
  | "shield_hit"
  | "shield_break"
  | "hit"
  | "hurt"
  | "death"
  | "respawn"
  | "weapon_pick"
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

/** Weapon id (index in WEAPONS) -> shot sound. */
export const WEAPON_SFX: readonly SfxName[] = ["rifle", "shotgun", "sniper", "smg"];

interface SfxDef {
  /** File basenames in /sfx/, one per variant. Empty for synthesized sounds. */
  files: string[];
  /** Level relative to the others (files are already levelled by the build script). */
  gain: number;
  /** Copies of this sound allowed at once; the oldest is cut when exceeded. */
  voices: number;
}

const variants = (base: string, n: number) => Array.from({ length: n }, (_, i) => `${base}_${i + 1}`);

const DEFS: Record<SfxName, SfxDef> = {
  rifle: { files: variants("rifle", 3), gain: 0.9, voices: 4 },
  shotgun: { files: variants("shotgun", 2), gain: 0.95, voices: 3 },
  sniper: { files: variants("sniper", 2), gain: 1, voices: 2 },
  smg: { files: variants("smg", 3), gain: 0.75, voices: 4 },
  reload: { files: ["reload"], gain: 0.8, voices: 2 },
  empty_click: { files: ["empty_click"], gain: 0.7, voices: 2 },
  dash: { files: [], gain: 0.55, voices: 2 },
  grenade_throw: { files: [], gain: 0.4, voices: 2 },
  grenade_bounce: { files: variants("grenade_bounce", 2), gain: 0.8, voices: 3 },
  explosion: { files: variants("explosion", 2), gain: 1, voices: 3 },
  shield_up: { files: ["shield_up"], gain: 0.8, voices: 2 },
  shield_hit: { files: variants("shield_hit", 2), gain: 0.8, voices: 3 },
  shield_break: { files: ["shield_break"], gain: 0.9, voices: 2 },
  hit: { files: variants("hit", 3), gain: 0.8, voices: 4 },
  hurt: { files: variants("hurt", 2), gain: 0.85, voices: 2 },
  death: { files: ["death"], gain: 0.9, voices: 2 },
  respawn: { files: ["respawn"], gain: 0.7, voices: 2 },
  weapon_pick: { files: ["weapon_pick"], gain: 0.7, voices: 2 },
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

function readBool(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
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
    }
    if (ctx.state !== "running") await ctx.resume();
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
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * PITCH_JITTER;
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
