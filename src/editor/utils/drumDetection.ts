/** A deliberately heuristic first pass: band energy attacks, not a learned
 * drum classifier. Cymbals, toms, claps and stem bleed can confuse it. */
export type DrumPart = 'kick' | 'snare' | 'hihat'
export interface DrumHit { time: number; velocity: number }
export type DrumAnalysis = Record<DrumPart, DrumHit[]>
export const DRUM_PARTS: DrumPart[] = ['kick', 'snare', 'hihat']
export const DRUM_NAMES = { kick: 'Kick', snare: 'Snare', hihat: 'Hi-hat' }
export const DRUM_PITCHES = { kick: 36, snare: 38, hihat: 42 }

function filter(type: 'low' | 'high', hz: number, sampleRate: number) {
  const w = 2 * Math.PI * hz / sampleRate
  const c = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2, a0 = 1 + alpha
  const b0 = (type === 'low' ? 1 - c : 1 + c) / (2 * a0)
  const b1 = (type === 'low' ? 1 - c : -(1 + c)) / a0
  const a1 = -2 * c / a0, a2 = (1 - alpha) / a0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x: number) => {
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    return y
  }
}

export function detectDrums(samples: Float32Array, sampleRate: number, onProgress: (p: number) => void = () => {}): DrumAnalysis {
  if (!Number.isFinite(sampleRate) || sampleRate < 16000) throw new Error('The drum audio sample rate is unsupported.')
  if (samples.length > sampleRate * 15 * 60) throw new Error('Drum extraction supports songs up to 15 minutes.')
  const hop = Math.round(sampleRate * 0.005)
  const frames = Math.ceil(samples.length / hop)
  const energies = DRUM_PARTS.map(() => new Float32Array(frames))
  const filters = [
    [filter('high', 35, sampleRate), filter('low', 190, sampleRate)],
    [filter('high', 450, sampleRate), filter('low', 3500, sampleRate)],
    [filter('high', 6500, sampleRate), filter('low', Math.min(14000, sampleRate * 0.45), sampleRate)],
  ]
  for (let f = 0; f < frames; f++) {
    const end = Math.min(samples.length, (f + 1) * hop)
    for (let i = f * hop; i < end; i++) {
      const x = Number.isFinite(samples[i]) ? samples[i] : 0
      for (let b = 0; b < 3; b++) {
        const v = filters[b][1](filters[b][0](x))
        energies[b][f] += v * v
      }
    }
    for (let b = 0; b < 3; b++) energies[b][f] = Math.sqrt(energies[b][f] / hop)
    if (f % 200 === 0) onProgress(0.85 * f / frames)
  }
  const result: DrumAnalysis = { kick: [], snare: [], hihat: [] }
  for (let b = 0; b < 3; b++) {
    const e = energies[b], novelty = new Float32Array(frames)
    let peak = 0, background = 0
    for (let f = 0; f < frames; f++) {
      // An attack must clear its recent envelope; sustained tones have no
      // repeated onsets. A global floor suppresses very quiet separator bleed.
      novelty[f] = Math.max(0, e[f] - background * 1.6)
      background = Math.max(e[f], background * 0.88)
      peak = Math.max(peak, novelty[f])
    }
    if (peak < 0.001) continue
    let lastTime = -1
    for (let f = 0; f < frames; f++) {
      if (novelty[f] < Math.max(0.001, peak * 0.07)) continue
      let isPeak = true
      for (let d = -3; d <= 3; d++) {
        const other = novelty[f + d] ?? 0
        if (other > novelty[f] || (d < 0 && other === novelty[f])) { isPeak = false; break }
      }
      if (!isPeak) continue
      // Compare a short attack window so a slow low-frequency cycle doesn't
      // misclassify a simultaneous snare/hat onset.
      const bands = energies.map((a) => {
        let v = 0
        for (let j = f; j < Math.min(frames, f + 5); j++) v = Math.max(v, a[j])
        return v
      })
      const [low, mid, high] = bands
      if (b === 0 && low < mid * 0.65) continue
      if (b === 1 && (mid < high * 0.65 || mid < low * 0.12)) continue
      if (b === 2 && (high < mid * 0.85 || high < low * 0.12)) continue
      let onset = f
      while (onset > Math.max(0, f - 4) && e[onset - 1] > e[f] * 0.12 && e[onset - 1] < e[onset]) onset--
      const time = onset * hop / sampleRate
      if (time - lastTime < (b === 2 ? 0.045 : 0.075)) continue
      lastTime = time
      result[DRUM_PARTS[b]].push({ time, velocity: Math.round(40 + 87 * Math.min(1, Math.sqrt(novelty[f] / peak))) })
    }
    onProgress(0.85 + (b + 1) * 0.05)
  }
  return result
}
