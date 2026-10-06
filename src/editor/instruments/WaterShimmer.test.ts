import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../core/visual/types'
import {
  WATER_SHIMMER_FIELD_GLSL,
  WATER_SHIMMER_FRAGMENT,
  WATER_SHIMMER_GATE_ALWAYS,
  WATER_SHIMMER_PATTERNS,
  WATER_SHIMMER_PITCH,
  resolveActiveWaterShimmer,
  waterShimmerInstrument,
} from './WaterShimmer'

function note(beat: number, durationBeats = 1, pitch = WATER_SHIMMER_PITCH, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 }
}

function stateAt(beat: number, notes: ResolvedNote[], params: Record<string, number> = {}, opacity = 1) {
  return {
    beat,
    notes,
    activeNotes: notes.filter((n) => beat >= n.beat && beat < n.beat + (n.durationBeats || 0.05)),
    // INTENSITY pinned to full scale so the gate and tail assertions read as
    // plain fractions; the shipped default is lower.
    params: { amount: 1, ...params },
    opacity,
    blackedOut: false,
  }
}

const ALWAYS = { gate: WATER_SHIMMER_GATE_ALWAYS }

test('while held (the default): the water flows only for as long as a note lasts', () => {
  const notes = [note(0, 2)]
  assert.equal(resolveActiveWaterShimmer(stateAt(1, notes, { release: 0 }))?.amount, 1)
  assert.equal(resolveActiveWaterShimmer(stateAt(2, notes, { release: 0 })), null)
  // An empty lane runs no pass at all.
  assert.equal(resolveActiveWaterShimmer(stateAt(1, [])), null)
})

test('release drains the water over its own length in beats, on a squared tail', () => {
  const notes = [note(0, 2)]
  const params = { release: 2 }
  assert.equal(resolveActiveWaterShimmer(stateAt(3, notes, params))?.amount, 0.25)
  assert.equal(resolveActiveWaterShimmer(stateAt(4, notes, params)), null)
})

test('velocity and track opacity both scale intensity while held', () => {
  const notes = [note(0, 2, WATER_SHIMMER_PITCH, 0.5)]
  assert.equal(resolveActiveWaterShimmer(stateAt(1, notes))?.amount, 0.5)
  assert.equal(resolveActiveWaterShimmer(stateAt(1, notes, {}, 0.5))?.amount, 0.25)
})

test('always on: an empty lane flows at full intensity', () => {
  assert.equal(resolveActiveWaterShimmer(stateAt(7, [], ALWAYS))?.amount, 1)
  assert.equal(resolveActiveWaterShimmer(stateAt(7, [], { ...ALWAYS, amount: 0.4 }))?.amount, 0.4)
})

test('always on: a held note stills the water completely, whatever its velocity', () => {
  // 100/127 is what a freshly drawn note carries. Scaling the switch by it
  // would leave a fifth of the shimmer running under a note meant to stop it.
  const notes = [note(0, 2, WATER_SHIMMER_PITCH, 100)]
  assert.equal(resolveActiveWaterShimmer(stateAt(1, notes, ALWAYS)), null)
})

test('always on: the water comes back over the release once the note ends', () => {
  const notes = [note(0, 2)]
  const params = { ...ALWAYS, release: 2 }
  // Half way through the release the "held" level is a quarter, so 3/4 is back.
  assert.equal(resolveActiveWaterShimmer(stateAt(3, notes, params))?.amount, 0.75)
  assert.equal(resolveActiveWaterShimmer(stateAt(4, notes, params))?.amount, 1)
  // Before the note it was simply on.
  assert.equal(resolveActiveWaterShimmer(stateAt(-1, [note(0, 2)], params))?.amount, 1)
})

test('a muted track runs no pass in either gate', () => {
  const held = { ...stateAt(1, [note(0, 2)]), blackedOut: true }
  const always = { ...stateAt(1, [], ALWAYS), blackedOut: true }
  assert.equal(resolveActiveWaterShimmer(held), null)
  assert.equal(resolveActiveWaterShimmer(always), null)
})

test('unrecognized pitches neither start the water nor still it', () => {
  const stray = [note(0, 2, 40)]
  assert.equal(resolveActiveWaterShimmer(stateAt(1, stray)), null)
  assert.equal(resolveActiveWaterShimmer(stateAt(1, stray, ALWAYS))?.amount, 1)
})

test('the knobs ride along, with the schema defaults for a track that stored none', () => {
  const live = resolveActiveWaterShimmer(stateAt(1, [note(0, 2)], { pattern: 2, scale: 6, speed: 1.5, chroma: 0.9 }))
  assert.deepEqual(live, { pattern: 2, amount: 1, scale: 6, speed: 1.5, chroma: 0.9, beat: 1 })
  const bare = resolveActiveWaterShimmer({ ...stateAt(1, [note(0, 2)]), params: {} })
  const defaults = Object.fromEntries(waterShimmerInstrument.params.map((p) => [p.key, p.default]))
  assert.deepEqual(bare, {
    pattern: defaults.pattern, amount: defaults.amount, scale: defaults.scale,
    speed: defaults.speed, chroma: defaults.chroma, beat: 1,
  })
})

test('the pattern values a track stores are frozen', () => {
  // Append-only: a saved project stores the number, so a renumber would
  // silently repaint it. Extending the list means adding at the end.
  assert.deepEqual(WATER_SHIMMER_PATTERNS.slice(0, 3), [
    { value: 0, label: 'Caustics' },
    { value: 1, label: 'Swell' },
    { value: 2, label: 'Rings' },
  ])
})

test('the pass is colour-only: it samples the source at its own pixel and keeps its alpha', () => {
  // The instrument's whole contract is that it never moves a pixel. Exactly one
  // tap, at vUv, and the colour law hands back the source alpha untouched.
  const taps = WATER_SHIMMER_FRAGMENT.match(/texture2D\([^)]*\)/g) ?? []
  assert.deepEqual(taps, ['texture2D(tDiffuse, vUv)'])
  assert.match(WATER_SHIMMER_FIELD_GLSL, /return vec4\(color, source\.a\);/)
})

test('the row is relabelled when the gate turns the note into an off switch', () => {
  const rows = waterShimmerInstrument.midiRowsFor
  assert.equal(rows?.({ params: {} })[0].label, 'Shimmer')
  assert.equal(rows?.({ params: ALWAYS })[0].label, 'Still')
  assert.equal(rows?.({ params: ALWAYS })[0].pitch, WATER_SHIMMER_PITCH)
})
