import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import { BURST_EASINGS, burstMover, evaluateBurstOffset, type BurstSettings } from './library'
import { getMoverOrSplitterDefinition } from './registry'
import { mergeDefinitionSettings } from './definitions'
import type { VisualCopy } from './types'

function note(beat: number, pitch: number, velocity = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats: 1 }
}

const DEFAULTS = mergeDefinitionSettings(burstMover, undefined) as unknown as BurstSettings

function settings(overrides: Partial<BurstSettings> = {}): BurstSettings {
  return { ...DEFAULTS, ...overrides }
}

function close(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ${expected}, got ${actual}`)
}

test('burst is registered as a production mover', () => {
  const def = getMoverOrSplitterDefinition('burst')
  assert.equal(def?.kind, 'mover')
  assert.equal(def?.label, 'Burst')
  const rows = def!.midiRows!(DEFAULTS)
  assert.equal(rows.length, 6)
  assert.deepEqual(rows.map((r) => r.pitch).sort((a, b) => a - b), [60, 61, 62, 63, 64, 65])
})

test('no notes, future notes, and unknown pitches contribute nothing', () => {
  assert.deepEqual(evaluateBurstOffset([], settings(), 4), [0, 0, 0])
  assert.deepEqual(evaluateBurstOffset([note(5, 60)], settings(), 4), [0, 0, 0])
  assert.deepEqual(evaluateBurstOffset([note(0, 40), note(1, 90)], settings(), 4), [0, 0, 0])
})

test('a burst eases out to exactly its distance and the step is permanent', () => {
  const s = settings({ easing: 5 /* linear */, burstBeats: 2, distanceX: 3, distance: 2 })
  const notes = [note(0, 60)] // Right (+X)
  close(evaluateBurstOffset(notes, s, 0)[0], 0)
  close(evaluateBurstOffset(notes, s, 1)[0], 3 * 2 * 0.5, 'halfway through a linear burst')
  close(evaluateBurstOffset(notes, s, 2)[0], 6, 'landed on the destination')
  close(evaluateBurstOffset(notes, s, 100)[0], 6, 'the step never decays')
})

test('velocity scales distance', () => {
  const s = settings({ easing: 5, burstBeats: 1 })
  close(evaluateBurstOffset([note(0, 60, 0.5)], s, 5)[0], 0.5)
  close(evaluateBurstOffset([note(0, 60, 1)], s, 5)[0], 1)
})

test('sequential same-direction notes accumulate; opposite notes step back', () => {
  const s = settings({ easing: 5, burstBeats: 1 })
  const walk = [note(0, 60), note(2, 60), note(4, 60)]
  close(evaluateBurstOffset(walk, s, 10)[0], 3, 'three +X steps walk 3 units right')
  const thereAndBack = [note(0, 60), note(2, 61)]
  close(evaluateBurstOffset(thereAndBack, s, 10)[0], 0, 'a -X step cancels a +X step')
})

test('a chord sums motion across directions', () => {
  const s = settings({ easing: 5, burstBeats: 2, distanceX: 1, distanceY: 4, distanceZ: 2 })
  const chord = [note(0, 60), note(0, 62), note(0, 65)] // +X, +Y, -Z together
  assert.deepEqual(evaluateBurstOffset(chord, s, 1), [0.5, 2, -1])
  assert.deepEqual(evaluateBurstOffset(chord, s, 2), [1, 4, -2])
})

test('per-axis distances and the overall multiplier both apply', () => {
  const s = settings({ easing: 5, burstBeats: 1, distanceY: 3, distance: 0.5 })
  close(evaluateBurstOffset([note(0, 63)], s, 2)[1], -1.5) // Down: -Y * 3 * 0.5
})

test('easing families differ mid-burst but agree at the destination', () => {
  const mid: number[] = []
  for (let easing = 0; easing < BURST_EASINGS.length; easing++) {
    const s = settings({ easing, burstBeats: 2 })
    mid.push(evaluateBurstOffset([note(0, 60)], s, 1)[0])
    close(evaluateBurstOffset([note(0, 60)], s, 2)[0], 1, `${BURST_EASINGS[easing].label} lands at 1`)
  }
  assert.ok(new Set(mid.map((v) => v.toFixed(6))).size > 1, 'curves are actually different')
  const expoMid = mid[0]
  const linearMid = mid[BURST_EASINGS.length - 1]
  assert.ok(expoMid > linearMid, 'expo bursts ahead of linear early on')
})

test('sharpness makes the early burst more violent without changing the destination', () => {
  const soft = settings({ easing: 5, burstBeats: 2, sharpness: 1 })
  const sharp = settings({ easing: 5, burstBeats: 2, sharpness: 4 })
  const notes = [note(0, 60)]
  assert.ok(
    evaluateBurstOffset(notes, sharp, 0.5)[0] > evaluateBurstOffset(notes, soft, 0.5)[0],
    'sharper curve is further along early',
  )
  close(evaluateBurstOffset(notes, sharp, 2)[0], 1)
})

test('through the chain: the offset composes locally, so upstream entries re-frame it', () => {
  const chain = [
    // An upstream mover that rotates the copy 90° about Z (local composition).
    {
      apply(visualCopy: VisualCopy) {
        return [{
          transform: visualCopy.transform.clone().multiply(new Matrix4().makeRotationZ(Math.PI / 2)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    },
    burstMover.resolve({ settings: settings({ easing: 5, burstBeats: 1 }), notes: [note(0, 60)] }),
  ]
  const copies = resolveVisualCopies(chain, 5)
  const e = copies[0].transform.elements
  // Position is (0, 1, 0) - the +X burst happens inside the rotated frame.
  const round = (n: number) => Math.round(n * 1e9) / 1e9 || 0
  assert.deepEqual([e[12], e[13], e[14]].map(round), [0, 1, 0])
})

test('evaluation is pure: scrubbing reproduces offsets exactly', () => {
  const resolved = burstMover.resolve({
    settings: settings({ easing: 3 /* elastic */, burstBeats: 4 }),
    notes: [note(0, 60), note(1, 62, 0.7), note(3, 65)],
  })
  const at = (beat: number) => resolved.apply(identityVisualCopy(), { beat, index: 0, count: 1 })[0].transform.elements
  const first = [...at(2.35)]
  at(0)
  at(50)
  assert.deepEqual([...at(2.35)], first)
})
