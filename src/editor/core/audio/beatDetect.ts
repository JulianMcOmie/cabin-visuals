// Beat/BPM detection for uploaded songs. Pure DSP over a decoded AudioBuffer -
// no dependencies, runs client-side in well under a second for a typical song.
//
// Pipeline: mono mixdown → onset-energy envelope (RMS per hop, half-wave
// rectified difference) → autocorrelation over the 60-200 BPM lag range →
// octave-corrected tempo pick → comb-filter phase fit for where beat 1 lands.
// Tuned for beat-forward music (the target audience); confidence comes back
// low on rubato/ambient material so callers can decline to auto-apply.

export interface BeatDetection {
  bpm: number
  /** Seconds into the file where the first beat lands. */
  firstBeatSec: number
  /** 0-1; how much the autocorrelation peak stands out over the mean. */
  confidence: number
}

const FRAME = 1024
const HOP = 512
const MIN_BPM = 60
const MAX_BPM = 200
// Prefer tempos in the range people actually tap; octave-fold into it.
// The ceiling sits above drum'n'bass (≈174) so real fast tempos survive.
const FOLD_MIN = 85
const FOLD_MAX = 180

/** Onset envelope: half-wave-rectified RMS difference per hop. */
function onsetEnvelope(buffer: AudioBuffer): { env: Float32Array; fps: number } {
  const n = buffer.length
  const chs = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  const frames = Math.max(0, Math.floor((n - FRAME) / HOP))
  const env = new Float32Array(frames)
  let prev = 0
  for (let f = 0; f < frames; f++) {
    const start = f * HOP
    let sum = 0
    for (let i = start; i < start + FRAME; i++) {
      let s = 0
      for (const ch of chs) s += ch[i]
      s /= chs.length
      sum += s * s
    }
    const rms = Math.sqrt(sum / FRAME)
    env[f] = Math.max(0, rms - prev)
    prev = rms
  }
  return { env, fps: buffer.sampleRate / HOP }
}

/** Autocorrelation of the envelope at a given integer lag. */
function autocorr(env: Float32Array, lag: number): number {
  let sum = 0
  for (let i = 0; i + lag < env.length; i++) sum += env[i] * env[i + lag]
  return sum / (env.length - lag)
}

/** Envelope linearly interpolated at fractional frame t. */
function envAt(env: Float32Array, t: number): number {
  const i = Math.floor(t)
  if (i < 0 || i >= env.length - 1) return 0
  const f = t - i
  return env[i] * (1 - f) + env[i + 1] * f
}

/** Comb sum of the envelope sampled every `period` frames from `phase`.
 *  Interpolated sampling - an integer-frame comb against a fractional period
 *  blurs which phase actually lines up with the beats. */
function combSum(env: Float32Array, period: number, phase: number): number {
  let sum = 0
  let count = 0
  for (let t = phase; t < env.length; t += period) {
    sum += envAt(env, t)
    count++
  }
  return count > 0 ? sum / count : 0
}

export function detectBeats(buffer: AudioBuffer): BeatDetection | null {
  const { env, fps } = onsetEnvelope(buffer)
  // Need a handful of bars of material to say anything (≈8s at 120bpm).
  if (env.length < fps * 8) return null

  // Normalize so confidence is scale-free.
  let mean = 0
  for (const v of env) mean += v
  mean /= env.length
  if (mean <= 0) return null

  // Tempo: best autocorrelation lag across the BPM range.
  const minLag = Math.floor((60 / MAX_BPM) * fps)
  const maxLag = Math.ceil((60 / MIN_BPM) * fps)
  let bestLag = minLag
  let bestScore = -Infinity
  let scoreSum = 0
  let scoreCount = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = autocorr(env, lag)
    scoreSum += score
    scoreCount++
    if (score > bestScore) { bestScore = score; bestLag = lag }
  }
  const scoreMean = scoreSum / scoreCount

  // Autocorrelation biases toward half tempo (two beat periods overlap at
  // least as well as one). If half the winning lag is nearly as supported,
  // the track's actual beat is the faster one - take it.
  while (Math.round(bestLag / 2) >= minLag) {
    const half = Math.round(bestLag / 2)
    if (autocorr(env, half) >= 0.85 * autocorr(env, bestLag)) { bestLag = half; bestScore = autocorr(env, half) }
    else break
  }

  // Parabolic interpolation around a lag's peak for sub-frame precision.
  const refineAt = (lag: number): number => {
    const y0 = autocorr(env, lag - 1)
    const y1 = autocorr(env, lag)
    const y2 = autocorr(env, lag + 1)
    const denom = y0 - 2 * y1 + y2
    const shift = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0
    return lag + Math.max(-0.5, Math.min(0.5, shift))
  }
  let period = refineAt(bestLag)

  // Multi-scale refinement: the peak near k×period carries k× smaller relative
  // quantization error. Without this the period is off by up to ~0.5%, which
  // compounds across a song and throws the phase fit off entirely.
  const k = Math.min(8, Math.floor(env.length / 2 / period))
  if (k >= 2) {
    const target = Math.round(k * period)
    const radius = Math.ceil(k / 2) + 1
    let bestL = target
    let bestV = -Infinity
    for (let l = target - radius; l <= target + radius; l++) {
      if (l < 1 || l >= env.length - 1) continue
      const v = autocorr(env, l)
      if (v > bestV) { bestV = v; bestL = l }
    }
    period = refineAt(bestL) / k
  }

  let bpm = (60 * fps) / period
  // Octave-fold into the tap range: half/double the tempo while the folded
  // variant is at least comparably supported by the envelope.
  while (bpm < FOLD_MIN && bpm * 2 <= MAX_BPM) { bpm *= 2; period /= 2 }
  while (bpm > FOLD_MAX && bpm / 2 >= MIN_BPM) { bpm /= 2; period *= 2 }

  // Snap to an integer BPM when we're within rounding noise of one - projects
  // hold a single number and "120" beats "119.87" for everything downstream.
  const rounded = Math.round(bpm)
  if (Math.abs(bpm - rounded) < 0.35) bpm = rounded
  bpm = Math.round(bpm * 100) / 100
  period = (60 * fps) / bpm

  // Phase: which offset into the first period best lines the comb up with
  // onsets. Quarter-frame steps - the period is fractional, so integer phases
  // can all straddle the beats and let a wrong one win on noise.
  let bestPhase = 0
  let bestComb = -Infinity
  for (let phase = 0; phase < period; phase += 0.25) {
    const s = combSum(env, period, phase)
    if (s > bestComb) { bestComb = s; bestPhase = phase }
  }

  // First beat: the first comb gridpoint that carries real energy - skips
  // count-in silence without mistaking a quiet intro's grid for dead air.
  const gate = Math.max(mean, bestComb * 0.15)
  let firstBeatFrame = bestPhase
  for (let t = bestPhase; t < env.length; t += period) {
    const i = Math.round(t)
    const w = Math.max(env[i - 1] ?? 0, env[i] ?? 0, env[i + 1] ?? 0)
    if (w >= gate) { firstBeatFrame = t; break }
  }

  // Overlapping analysis frames make every onset bleed ~2 frames early -
  // except a beat at t=0, which has no earlier frames, so the comb fit lands
  // one period late on it. Peek one period back (window widened toward 0)
  // before accepting.
  while (firstBeatFrame - period >= -2) {
    const t = firstBeatFrame - period
    const i = Math.max(0, Math.round(t))
    const w = Math.max(env[i] ?? 0, env[i + 1] ?? 0, env[i + 2] ?? 0)
    if (w >= gate) firstBeatFrame = Math.max(0, t)
    else break
  }

  const confidence = Math.max(0, Math.min(1, (bestScore - scoreMean) / (bestScore + scoreMean)))
  return {
    bpm,
    firstBeatSec: firstBeatFrame / fps,
    confidence,
  }
}
