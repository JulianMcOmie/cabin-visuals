import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import type { MoverOrSplitterDefinition } from '../visualCopies/definitions'
import {
  registerMoverOrSplitterDefinition,
  unregisterMoverOrSplitterDefinitionForTests,
} from '../visualCopies/registry'
import type { ResolvedNote } from './types'
import type { VisualCopy } from '../visualCopies/types'
import {
  computeAtBeat,
  getObjectList,
  getVisualCopies,
  getVisualCopy,
  getVisualCopyCount,
  setProject,
} from './VisualEngine'
import type { ProjectSnapshot } from './resolve'

// Runtime-cache tests: the engine evaluates each object's mover-and-splitter
// chain per computed beat into a separate per-track VisualCopy cache, with a
// structural count fixed at resolve time.

function cloneCopy(copy: VisualCopy): VisualCopy {
  return {
    transform: copy.transform.clone(),
    opacity: copy.opacity,
    colorShift: { ...copy.colorShift },
  }
}

function gateAt(notes: ResolvedNote[], beat: number, pitch: number): number {
  for (const n of notes) {
    if (n.pitch === pitch && beat >= n.beat && beat < n.beat + n.durationBeats) return n.velocity
  }
  return 0
}

/** Beat-driven mover: translates X by sin(beat) * distance (no MIDI). */
const waveMover: MoverOrSplitterDefinition<{ distance: number }> = {
  id: 'test.wave',
  label: 'Wave',
  kind: 'mover',
  params: [{ key: 'distance', label: 'Distance', min: 0, max: 10, step: 0.1, default: 2 }],
  resolve({ settings }) {
    return {
      apply(visualCopy, { beat }) {
        const next = cloneCopy(visualCopy)
        next.transform.multiply(new Matrix4().makeTranslation(Math.sin(beat) * settings.distance, 0, 0))
        return [next]
      },
    }
  },
}

/** Two-slot splitter: pitch 60 gates the left slot's opacity, 62 the right. */
const gatedSplitter: MoverOrSplitterDefinition<{ spacing: number }> = {
  id: 'test.gatedSplit',
  label: 'Gated Split',
  kind: 'splitter',
  params: [{ key: 'spacing', label: 'Spacing', min: 0, max: 20, step: 0.5, default: 3 }],
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat }) {
        return [
          { pitch: 60, side: -1 },
          { pitch: 62, side: 1 },
        ].map(({ pitch, side }) => {
          const next = cloneCopy(visualCopy)
          next.transform.multiply(new Matrix4().makeTranslation(side * settings.spacing, 0, 0))
          next.opacity = visualCopy.opacity * gateAt(notes, beat, pitch)
          return next
        })
      },
    }
  },
}

registerMoverOrSplitterDefinition(waveMover)
registerMoverOrSplitterDefinition(gatedSplitter)
test.after(() => {
  unregisterMoverOrSplitterDefinitionForTests('test.wave')
  unregisterMoverOrSplitterDefinitionForTests('test.gatedSplit')
})

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

function project(tracks: Track[], rootTrackIds: string[]): ProjectSnapshot {
  return {
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    rootTrackIds,
    beatsPerBar: 4,
    bpm: 120,
  }
}

function serializeCopies(trackId: string) {
  return getVisualCopies(trackId).map((c) => ({
    transform: [...c.transform.elements],
    opacity: c.opacity,
    colorShift: { ...c.colorShift },
  }))
}

test('the identity path remains one copy, readable before the first frame', () => {
  setProject(project([track({ id: 'cube', instrumentId: 'cube' })], ['cube']))
  assert.equal(getVisualCopyCount('cube'), 1)
  const copy = getVisualCopy('cube', 0)
  assert.ok(copy)
  assert.deepEqual(copy.transform.elements, new Matrix4().elements)
  assert.equal(copy.opacity, 1)
  assert.equal(getVisualCopy('cube', 1), undefined)
  assert.equal(getVisualCopyCount('nonexistent'), 0)
  assert.deepEqual(getVisualCopies('nonexistent'), [])
})

test('same beat produces identical copies; scrubbing away and back reproduces exactly', () => {
  setProject(project([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['w'] }),
    track({ id: 'w', type: 'mover', moverId: 'test.wave', parentId: 'cube', inputValues: { distance: 4 } }),
  ], ['cube']))

  computeAtBeat(2.75)
  const first = serializeCopies('cube')
  assert.notEqual(first[0].transform[12], 0, 'the wave mover actually moved the copy')

  computeAtBeat(0)
  computeAtBeat(97.3)
  computeAtBeat(2.75)
  assert.deepEqual(serializeCopies('cube'), first)
})

test('MIDI gates change opacity without changing the copy count', () => {
  setProject(project([
    track({
      id: 'cube', instrumentId: 'cube', childIds: ['s'],
    }),
    track({
      id: 's', type: 'splitter', splitterId: 'test.gatedSplit', parentId: 'cube',
      blocks: [{
        id: 'b', startBar: 0, durationBars: 1, loop: false,
        notes: [
          { id: 'n1', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 1 },
          { id: 'n2', startBeat: 1, durationBeats: 1, pitch: 62, velocity: 0.5 },
        ],
      }],
    }),
  ], ['cube']))

  assert.equal(getVisualCopyCount('cube'), 2)

  computeAtBeat(0.5) // left gate open
  assert.equal(getVisualCopies('cube').length, 2)
  assert.deepEqual(getVisualCopies('cube').map((c) => c.opacity), [1, 0])

  computeAtBeat(1.5) // right gate open
  assert.equal(getVisualCopies('cube').length, 2)
  assert.deepEqual(getVisualCopies('cube').map((c) => c.opacity), [0, 0.5])

  computeAtBeat(10) // both closed - slots persist, invisible
  assert.equal(getVisualCopies('cube').length, 2)
  assert.deepEqual(getVisualCopies('cube').map((c) => c.opacity), [0, 0])
  assert.equal(getVisualCopyCount('cube'), 2)
})

test('the structural object list has one entry per copy index', () => {
  setProject(project([
    track({ id: 'solo', instrumentId: 'cube' }),
    track({ id: 'cube', instrumentId: 'cube', childIds: ['s'] }),
    track({ id: 's', type: 'splitter', splitterId: 'test.gatedSplit', parentId: 'cube' }),
  ], ['solo', 'cube']))

  assert.deepEqual(getObjectList(), [
    { trackId: 'solo', instrumentId: 'cube', visualCopyIndex: 0 },
    { trackId: 'cube', instrumentId: 'cube', visualCopyIndex: 0 },
    { trackId: 'cube', instrumentId: 'cube', visualCopyIndex: 1 },
  ])
})

test('per-frame evaluation never republishes the structural list', () => {
  setProject(project([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['s'] }),
    track({
      id: 's', type: 'splitter', splitterId: 'test.gatedSplit', parentId: 'cube',
      blocks: [{
        id: 'b', startBar: 0, durationBars: 1, loop: false,
        notes: [{ id: 'n1', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 1 }],
      }],
    }),
  ], ['cube']))

  const before = getObjectList()
  computeAtBeat(0.5) // gate open
  computeAtBeat(10) // gates closed - copies hidden, never unmounted
  assert.equal(getObjectList(), before, 'list reference is stable across frames')
  assert.equal(before.length, 2)
})

test('re-resolving drops caches for removed tracks', () => {
  setProject(project([track({ id: 'cube', instrumentId: 'cube' })], ['cube']))
  assert.equal(getVisualCopyCount('cube'), 1)
  setProject(project([track({ id: 'other', instrumentId: 'cube' })], ['other']))
  assert.equal(getVisualCopyCount('cube'), 0)
  assert.deepEqual(getVisualCopies('cube'), [])
  assert.equal(getVisualCopyCount('other'), 1)
})
