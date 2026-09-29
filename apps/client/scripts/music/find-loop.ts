// Finds a loop body in a song, for build.sh: where the song's ending starts
// (so the loop skips it), and a loop start A and end B where the music around
// A sounds like the music around B, so jumping from B back to A is heard as
// the song carrying on. Prints the numbers build.sh hardcodes (the two
// sample positions at 44.1 kHz).
//
//   bun apps/client/scripts/music/find-loop.ts <song> [--a-from s] [--a-to s]
//
// Needs ffmpeg on the PATH. How it works:
// - Level per 0.1 s: the ending is where the level (1 s average) drops for
//   good more than 4 dB under the song's median.
// - Every 12 ms, the energy in 20 log-spaced bands (60 Hz to 8 kHz). Each
//   band is standardised over the song, so a pair of windows scores by the
//   shape of the music (rhythm, instruments, register), not by raw level.
// - Every A in [--a-from, --a-to] (default 12..70 s) against every B in the
//   last 30 s before the ending, 46 ms apart: score = cosine similarity of the 3 s before
//   plus the 3 s after each point. The best pair wins.
// - B is then moved frame by frame (12 ms), then by up to +-6 ms to where the raw waveform in the 1 s
//   before it lines up best with the 1 s before A (the crossfade window),
//   so the two layers of the crossfade are on the same beat.

const RATE = 22050;
const HOP = 256;
/** The first pass compares every STRIDE-th frame only (46 ms apart), the refinement all of them. */
const STRIDE = 4;
const WIN = 2048;
const BANDS = 20;
const SIDE = 3; // seconds compared on each side of a point
const FPS = RATE / HOP;

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error("usage: bun find-loop.ts <song> [--a-from s] [--a-to s]");
  process.exit(1);
}
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], {
  stdout: "pipe",
});
const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
const x = new Float32Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 4));
const duration = x.length / RATE;

// --- Level over time and the ending -------------------------------------------
const lvlStep = Math.round(RATE * 0.1);
const levels: number[] = [];
for (let i = 0; i + lvlStep <= x.length; i += lvlStep) {
  let s = 0;
  for (let j = i; j < i + lvlStep; j++) s += x[j] * x[j];
  levels.push(10 * Math.log10(s / lvlStep + 1e-12));
}
const smooth = levels.map((_, i) => {
  const a = levels.slice(Math.max(0, i - 5), i + 5);
  return 10 * Math.log10(a.reduce((s, v) => s + 10 ** (v / 10), 0) / a.length);
});
const median = [...smooth].sort((a, b) => a - b)[Math.floor(smooth.length / 2)];
let endIdx = smooth.length - 1;
while (endIdx > 0 && smooth[endIdx] < median - 4) endIdx--;
const bodyEnd = (endIdx + 1) * 0.1;

// --- Band energies --------------------------------------------------------------
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
  }
}

const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((60 * (8000 / 60) ** (i / BANDS) * WIN) / RATE));
const frames = Math.floor((x.length - WIN) / HOP);
const feat = new Float64Array(frames * BANDS);
const flux = new Float64Array(frames);
const re = new Float64Array(WIN);
const im = new Float64Array(WIN);
for (let f = 0; f < frames; f++) {
  for (let i = 0; i < WIN; i++) {
    re[i] = x[f * HOP + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
    im[i] = 0;
  }
  fft(re, im);
  for (let b = 0; b < BANDS; b++) {
    let e = 0;
    for (let k = edges[b]; k < Math.max(edges[b + 1], edges[b] + 1); k++) e += re[k] * re[k] + im[k] * im[k];
    feat[f * BANDS + b] = Math.log10(e + 1e-9);
    if (f > 0) flux[f] += Math.max(0, feat[f * BANDS + b] - feat[(f - 1) * BANDS + b]);
  }
}
for (let b = 0; b < BANDS; b++) {
  let m = 0;
  let v = 0;
  for (let f = 0; f < frames; f++) m += feat[f * BANDS + b];
  m /= frames;
  for (let f = 0; f < frames; f++) v += (feat[f * BANDS + b] - m) ** 2;
  const sd = Math.sqrt(v / frames) || 1;
  for (let f = 0; f < frames; f++) feat[f * BANDS + b] = (feat[f * BANDS + b] - m) / sd;
}

// Tempo, for the report: the strongest period of the onset curve (70..180
// BPM), then measured over 32 beats for precision.
function autocorr(lag: number) {
  let s = 0;
  for (let f = 0; f + lag < frames; f++) s += flux[f] * flux[f + lag];
  return s;
}
let beatLag = 0;
let bestAc = -Infinity;
for (let lag = Math.round((FPS * 60) / 180); lag <= Math.round((FPS * 60) / 70); lag++) {
  const s = autocorr(lag);
  if (s > bestAc) {
    bestAc = s;
    beatLag = lag;
  }
}
let longLag = Math.round(beatLag * 32);
bestAc = -Infinity;
for (let lag = Math.round(beatLag * 31.5); lag <= Math.round(beatLag * 32.5); lag++) {
  const s = autocorr(lag);
  if (s > bestAc) {
    bestAc = s;
    longLag = lag;
  }
}
{
  const [l, c, r] = [autocorr(longLag - 1), autocorr(longLag), autocorr(longLag + 1)];
  const den = l - 2 * c + r;
  beatLag = (longLag + (den !== 0 ? (0.5 * (l - r)) / den : 0)) / 32;
}
const bpm = (FPS * 60) / beatLag;

// --- Search -----------------------------------------------------------------------
const side = Math.round(SIDE * FPS);
function score(fa: number, fb: number, stride: number) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = -side; k < side; k += stride) {
    const oa = (fa + k) * BANDS;
    const ob = (fb + k) * BANDS;
    for (let i = 0; i < BANDS; i++) {
      const a = feat[oa + i];
      const b = feat[ob + i];
      dot += a * b;
      na += a * a;
      nb += b * b;
    }
  }
  return dot / Math.sqrt(na * nb);
}
const aFrom = Math.round(opt("--a-from", 12) * FPS);
const aTo = Math.round(opt("--a-to", 70) * FPS);
const bTo = Math.floor(bodyEnd * FPS) - side - 1;
const bFrom = Math.max(aTo + side, bTo - Math.round(30 * FPS));
let best = { a: 0, b: 0, s: -Infinity };
for (let fb = bFrom; fb <= bTo; fb += STRIDE)
  for (let fa = aFrom; fa <= aTo; fa += STRIDE) {
    const s = score(fa, fb, STRIDE);
    if (s > best.s) best = { a: fa, b: fb, s };
  }
// Then B to the frame (12 ms), A kept: that sets the loop length and the beat phase.
const coarseB = best.b;
best.s = -Infinity;
for (let fb = coarseB - 2 * STRIDE; fb <= Math.min(bTo, coarseB + 2 * STRIDE); fb++) {
  const s = score(best.a, fb, 1);
  if (s > best.s) best = { ...best, b: fb, s };
}

// Sample-level: slide B so the waveforms before A and before B line up.
const A = best.a * HOP + WIN / 2;
const B0 = best.b * HOP + WIN / 2;
const seg = RATE; // the 1 s before each point
function corr(a: number, b: number) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = -seg; i < 0; i++) {
    dot += x[a + i] * x[b + i];
    na += x[a + i] ** 2;
    nb += x[b + i] ** 2;
  }
  return dot / Math.sqrt(na * nb);
}
let B = B0;
let bestCorr = -Infinity;
const reach = Math.round(RATE * 0.006);
for (let d = -reach; d <= reach; d++) {
  const c = corr(A, B0 + d);
  if (c > bestCorr) {
    bestCorr = c;
    B = B0 + d;
  }
}

const t = (s: number) => (s / RATE).toFixed(4);
const loop = (B - A) / RATE;
console.log(
  JSON.stringify({
    file,
    duration: +duration.toFixed(3),
    medianDb: +median.toFixed(1),
    bodyEnd: +bodyEnd.toFixed(1),
    bpm: +bpm.toFixed(1),
    loopStart: +t(A),
    loopEnd: +t(B),
    // The cut points build.sh takes, in samples at 44.1 kHz.
    startSample: A * 2,
    endSample: B * 2,
    loopLength: +loop.toFixed(4),
    beats: +((loop * bpm) / 60).toFixed(2),
    spectralScore: +best.s.toFixed(3),
    waveCorr: +bestCorr.toFixed(3),
  }),
);
