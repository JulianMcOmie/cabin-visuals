import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { getInstrument } from '../../instruments'
import { isNumberParam } from '../../instruments/types'
import { identityVisualCopy } from '../visualCopies/identityVisualCopy'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'
import { STAGGER_SPAWN_PITCH } from '../visualCopies/stagger'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { computeAtBeat, getObjectState, isTrackStaggered, setProject } from './VisualEngine'

// The Stagger's WIRING: that a stagger track resolves into the chain through
// resolveProject, that the copies below it latch per birth end to end, that
// spawn notes written on the track's own lane reach the allocator, and that
// the automation wrapper forwards applyFramed (dropping it would silently
// strip every copy's clock the moment a knob is automated - the exact failure
// the wrapper note in resolve.ts warns about). The clock arithmetic itself is
// visualCopies/stagger.test.ts's job.

function track(partial: Partial<Track> & { id: string }): Track {
  return {
    name: partial.id,
    type: 'base',
    instrumentId: '',
    color: '#fff',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    ...partial,
  }
}

function snapshot(tracks: Track[], rootTrackIds: string[]): ProjectSnapshot {
  return {
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    rootTrackIds,
    beatsPerBar: 4,
    bpm: 120,
  }
}

function chainOf(p: ProjectSnapshot, trackId: string) {
  const obj = resolveProject(p).objects.find((o) => o.trackId === trackId)
  assert.ok(obj, `object ${trackId} resolved`)
  return obj.moverAndSplitterChain
}

/** A latching colorizer lane: slot 1 (pitch 60) over beats [0, 2), slot 2
 *  (pitch 62) over [2, 4) - one note per birth at the stagger defaults below. */
function latchColorizerTrack(id: string, parentId: string): Track {
  return track({
    id, type: 'mover', moverId: 'calmHueRotate', parentId,
    inputValues: { sample: 1 },
    blocks: [{
      id: `${id}-b`, startBar: 0, durationBars: 1, loop: false,
      notes: [
        { id: `${id}-n1`, startBeat: 0, durationBeats: 2, pitch: 60, velocity: 100 },
        { id: `${id}-n2`, startBeat: 2, durationBeats: 2, pitch: 62, velocity: 100 },
      ],
    }],
  })
}

test('a stagger in the document gives each copy the color its birth note said', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['st', 'col'] }),
    track({ id: 'st', type: 'splitter', splitterId: 'stagger', parentId: 'cube', inputValues: { copies: 2, duration: 4 } }),
    latchColorizerTrack('col', 'cube'),
  ], ['cube'])
  // At beat 3: copy 0 was born at 0 (slot 1 sounding), copy 1 at 2 (slot 2).
  const copies = resolveVisualCopies(chainOf(p, 'cube'), 3)
  assert.equal(copies.length, 2)
  assert.equal(copies[0].colorShift.tint, '#ffd166')
  assert.equal(copies[1].colorShift.tint, '#ef476f')
})

test('spawn notes on the stagger track trigger births end to end', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['st'] }),
    track({
      id: 'st', type: 'splitter', splitterId: 'stagger', parentId: 'cube',
      inputValues: { copies: 2, duration: 4 },
      blocks: [{
        id: 'st-b', startBar: 0, durationBars: 2, loop: false,
        notes: [{ id: 'st-n', startBeat: 1, durationBeats: 0.25, pitch: STAGGER_SPAWN_PITCH, velocity: 100 }],
      }],
    }),
  ], ['cube'])
  const chain = chainOf(p, 'cube')
  // One note = a pool of one. Dark before the onset, flying for DURATION
  // beats after it, dark again once the flight ends.
  assert.deepEqual(resolveVisualCopies(chain, 0.5).map((c) => c.opacity), [0])
  assert.deepEqual(resolveVisualCopies(chain, 2).map((c) => c.opacity), [1])
  assert.deepEqual(resolveVisualCopies(chain, 5.5).map((c) => c.opacity), [0])
})

test('an automated stagger still emits its clocks (applyFramed survives the wrapper)', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['st'] }),
    track({
      id: 'st', type: 'splitter', splitterId: 'stagger', parentId: 'cube',
      inputValues: { copies: 2, duration: 4 }, childIds: ['auto'],
    }),
    track({
      id: 'auto', type: 'automation', parentId: 'st', targetParam: 'duration',
      blocks: [{
        id: 'auto-b', startBar: 0, durationBars: 1, loop: false,
        notes: [{ id: 'auto-n', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 100 }],
      }],
    }),
  ], ['cube'])
  const [entry] = chainOf(p, 'cube')
  assert.ok(entry.applyFramed, 'the automation wrapper forwards applyFramed')
  const framed = entry.applyFramed!(identityVisualCopy(), { beat: 3, index: 0, count: 1 })
  assert.equal(framed.length, 2)
  for (const copy of framed) {
    assert.notEqual(copy.beatOffset, undefined)
    assert.notEqual(copy.birthBeat, undefined)
  }
})

// ── Per-copy object states: CHILD POSITION routes each lane's clock ──────────
// Above the emitter = pattern, replayed at each copy's own clock; after it =
// live overlay on the real timeline. The instrument itself (notes, energy,
// localTransform) is above everything and always staggers.

/** A min→max keyframe ramp over beats [0, 4] on `targetParam`. */
function rampLane(id: string, parentId: string, targetParam: string): Track {
  return track({
    id, type: 'automation', parentId, targetParam,
    blocks: [{
      id: `${id}-b`, startBar: 0, durationBars: 2, loop: false,
      notes: [
        { id: `${id}-n1`, startBeat: 0, durationBeats: 0.25, pitch: 36, velocity: 100 },
        { id: `${id}-n2`, startBeat: 4, durationBeats: 0.25, pitch: 84, velocity: 100 },
      ],
    }],
  })
}

test('a staggered track gets per-copy object states; lane position routes each clock', () => {
  const cubeParams = getInstrument('cube')?.params.filter(isNumberParam) ?? []
  const patternKey = cubeParams[0]?.key
  const liveKey = cubeParams[1]?.key
  assert.ok(patternKey && liveKey && patternKey !== liveKey, 'cube declares two numeric params to automate')
  const p = snapshot([
    track({
      id: 'cube', instrumentId: 'cube', childIds: ['patternAuto', 'st', 'liveAuto', 'tfauto'],
      blocks: [{
        id: 'cube-b', startBar: 0, durationBars: 1, loop: false,
        notes: [{ id: 'cube-n', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 100 }],
      }],
    }),
    // ABOVE the stagger: pattern - each copy reads a DIFFERENT value at its age.
    rampLane('patternAuto', 'cube', patternKey!),
    track({ id: 'st', type: 'splitter', splitterId: 'stagger', parentId: 'cube', inputValues: { copies: 4, duration: 4 } }),
    // AFTER the stagger: live - every copy reads the real timeline's value.
    rampLane('liveAuto', 'cube', liveKey!),
    // A SPATIAL tf lane below every chain child: formation-as-one, object clock
    // (routed by the same position rule now - no special case).
    track({
      id: 'tfauto', type: 'automation', parentId: 'cube', targetParam: 'tfX',
      blocks: [{
        id: 'tf-b', startBar: 0, durationBars: 3, loop: false,
        notes: [
          { id: 't1', startBeat: 0, durationBeats: 0.25, pitch: 36, velocity: 100 },
          { id: 't2', startBeat: 12, durationBeats: 0.25, pitch: 84, velocity: 100 },
        ],
      }],
    }),
  ], ['cube'])
  setProject(p)
  assert.ok(isTrackStaggered('cube'))
  computeAtBeat(10)
  // Loop stagger(4, 4) at beat 10: ages [2, 1, 0, 3].
  const objectState = getObjectState('cube')
  assert.equal(objectState?.beat, 10)
  const ages = [2, 1, 0, 3]
  ages.forEach((age, i) => {
    const s = getObjectState('cube', i)
    assert.equal(s?.beat, age, `copy ${i} clock`)
    // The cube's note at [0, 1) sounds only for the copy whose age is inside it.
    assert.equal(s?.activeNotes.length, age < 1 ? 1 : 0, `copy ${i} active notes`)
  })
  // The pattern lane ramps over [0, 4]: distinct per copy, ordered by age.
  const v = (i: number) => getObjectState('cube', i)!.params[patternKey!]
  assert.ok(v(3) > v(0) && v(0) > v(1) && v(1) > v(2), 'pattern lane staggers per copy')
  // The live lane and the spatial tf lane read the real timeline: identical
  // across copies, equal to the shared state's values.
  ages.forEach((_, i) => {
    const s = getObjectState('cube', i)!
    assert.equal(s.params[liveKey!], objectState!.params[liveKey!], `copy ${i} live lane`)
    assert.equal(s.params.tfX, objectState!.params.tfX, `copy ${i} tfX`)
  })
})

// ── Chain movers: before the stagger = the pattern, after it = a live overlay ─

/** A translate-burst Mover with one note - the x offset arrives over the burst. */
function burstMoverTrack(id: string, parentId: string, noteBeat: number): Track {
  return track({
    id, type: 'mover', moverId: 'mover', parentId,
    inputValues: { movement: 0, timing: 0, x: 3, y: 0, z: 0 },
    blocks: [{
      id: `${id}-b`, startBar: 0, durationBars: 4, loop: false,
      notes: [{ id: `${id}-n`, startBeat: noteBeat, durationBeats: 1, pitch: 60, velocity: 100 }],
    }],
  })
}

const copyX = (copies: ReturnType<typeof resolveVisualCopies>) =>
  copies.map((c) => c.transform.elements[12])

test('a mover AFTER the stagger runs on the real timeline', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['st', 'mv'] }),
    track({ id: 'st', type: 'splitter', splitterId: 'stagger', parentId: 'cube', inputValues: { copies: 3, duration: 4 } }),
    burstMoverTrack('mv', 'cube', 9),
  ], ['cube'])
  const chain = chainOf(p, 'cube')
  // Before its note nothing moves; mid-burst every copy carries the SAME
  // real-clock offset - the note at beat 9 fires even though no copy's age
  // ever reaches 9, which is the whole point of the live overlay.
  assert.deepEqual(copyX(resolveVisualCopies(chain, 8)), [0, 0, 0])
  const mid = copyX(resolveVisualCopies(chain, 9.5))
  assert.ok(mid[0] > 0.1, 'the burst fired on the timeline clock')
  assert.ok(mid.every((x) => x === mid[0]), 'all copies share the live offset')
})

test('a mover BEFORE the stagger is the pattern and replays per copy', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['mv', 'st'] }),
    burstMoverTrack('mv', 'cube', 1),
    track({ id: 'st', type: 'splitter', splitterId: 'stagger', parentId: 'cube', inputValues: { copies: 4, duration: 4 } }),
  ], ['cube'])
  const chain = chainOf(p, 'cube')
  // Loop stagger(4, 4) at beat 10: ages [2, 1, 0, 3] - each copy mid-replay of
  // the burst at its own phase, so the offsets DIFFER across copies.
  const xs = copyX(resolveVisualCopies(chain, 10))
  assert.equal(xs.length, 4)
  assert.ok(new Set(xs.map((x) => x.toFixed(4))).size > 1, 'copies replay the burst at their own ages')
})

test('unstaggered tracks answer any copy index with the shared state', () => {
  const p = snapshot([
    track({ id: 'plain', instrumentId: 'cube' }),
  ], ['plain'])
  setProject(p)
  assert.equal(isTrackStaggered('plain'), false)
  computeAtBeat(5)
  assert.equal(getObjectState('plain', 0), getObjectState('plain'))
  assert.equal(getObjectState('plain', 3), getObjectState('plain'))
})
