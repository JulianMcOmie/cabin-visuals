import type { ResolvedNote } from '../visual/types'
import { midiVelocity } from '../../utils/midiVelocity'
import { fluidImpactOperation, type GpuOperation } from './gpuOperations'

export interface FluidImpactSettings {
  strength: number
  radius: number
  decay: number
  curl: number
  turbulence: number
  rebound: number
  eddySize: number
  flow: number
  axis: number
  centerX: number
  centerY: number
  centerZ: number
}

const TAU = Math.PI * 2
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback
const phase = (value: number) => ((value % TAU) + TAU) % TAU
type ImpactHit = { beat: number; velocity: number }
const compiledHits = new WeakMap<readonly ResolvedNote[], readonly ImpactHit[]>()

function prepareHits(notes: readonly ResolvedNote[]): readonly ImpactHit[] {
  let hits = compiledHits.get(notes)
  if (!hits) {
    hits = notes.filter(note => note.pitch === 60 && Number.isFinite(note.beat))
      .map(note => ({ beat: note.beat, velocity: midiVelocity(note.velocity) }))
      .filter(note => Number.isFinite(note.velocity) && note.velocity > 0)
      .sort((a, b) => a.beat - b.beat)
    // Automation re-resolves settings against the same immutable note array.
    // Changing Center X should not re-sort a whole song on every frame.
    compiledHits.set(notes, hits)
  }
  return hits
}

/** A fast launch and a later, softer wake. Both return to exactly zero and
 * have zero terminal velocity. Note duration never cuts off an impact. The
 * closed form makes playback, arbitrary seeking and export identical. */
export function fluidImpactEnvelope(age: number, decay: number): { kick: number; wake: number } {
  const u = age / Math.max(.0001, decay)
  if (u <= 0 || u >= 1) return { kick: 0, wake: 0 }
  const tail = 1 - u, tail2 = tail * tail
  return { kick: 12.20703125 * u * tail2 * tail2, wake: 16 * u * u * tail2 }
}

/** Compile note history once; each frame visits only sounding impact tails.
 * The shader receives three summed displacement channels, never a note loop
 * or an expanded particle array. All overlapping impacts contribute, without
 * a voice limit that could abruptly remove an older wake on a fast drum roll.
 * This is an analytic flow effect, not an accumulating fluid simulation. */
export function createFluidImpactSampler(notes: readonly ResolvedNote[], settings: FluidImpactSettings): (beat: number) => GpuOperation {
  const hits = prepareHits(notes)
  const strength = Math.max(0, finite(settings.strength, 2.2))
  const radius = Math.max(.0001, finite(settings.radius, 6))
  const decay = Math.max(.0001, finite(settings.decay, 1.5))
  const curl = finite(settings.curl, .8)
  const turbulence = Math.max(0, finite(settings.turbulence, .65))
  const rebound = Math.max(0, Math.min(1, finite(settings.rebound, .45)))
  const frequency = TAU / Math.max(.0001, finite(settings.eddySize, 1.5))
  const speed = finite(settings.flow, .8) * TAU / decay
  const axis: [number, number, number] = settings.axis === 0 ? [1, 0, 0] : settings.axis === 1 ? [0, 1, 0] : [0, 0, 1]
  const center: [number, number, number] = [finite(settings.centerX, 0), finite(settings.centerY, 0), finite(settings.centerZ, 0)]
  return beat => {
    let low = 0, high = hits.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (hits[middle].beat < beat - decay) low = middle + 1
      else high = middle
    }
    let kick = 0, wake = 0
    for (let i = low; i < hits.length && hits[i].beat <= beat; i++) {
      const envelope = fluidImpactEnvelope(beat - hits[i].beat, decay)
      kick += envelope.kick * hits[i].velocity
      wake += envelope.wake * hits[i].velocity
    }
    return fluidImpactOperation({ axis, center, radius,
      radialTravel: strength * (kick - rebound * wake),
      swirlTravel: strength * curl * wake,
      scatterTravel: strength * turbulence * wake,
      frequency,
      // Reduce each phase separately in Float64. Reducing the common clock
      // before multiplying unequal speeds would introduce a visible jump.
      phase: [phase(beat * speed * .73 + .7), phase(beat * speed * -1.13 + 2.1), phase(beat * speed * .91 - 1.3)],
    })
  }
}
