import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import type { MoverOrSplitterDefinition } from '../visualCopies/definitions'
import { RELEASE_CONTINUE, RELEASE_SNAP } from '../visualCopies/freeze'
import {
  registerMoverOrSplitterDefinition,
  unregisterMoverOrSplitterDefinitionForTests,
} from '../visualCopies/registry'
import { computeAtBeat, getObjectState, getVisualCopies, setProject } from './VisualEngine'
import type { ProjectSnapshot } from './resolve'

// Freeze is a TIME remap, so what has to be proven here is not its arithmetic
// (freeze.test.ts owns that) but its REACH: an object carrying a freeze row is
// evaluated wholesale at the remapped beat - its mover chain and the state the
// instrument itself renders from.

/** A mover that never repeats a position, so "did it freeze?" is unambiguous. */
const driftMover: MoverOrSplitterDefinition<Record<string, never>> = {
  id: 'test.drift',
  label: 'Drift',
  kind: 'mover',
  params: [],
  resolve() {
    return {
      apply(visualCopy, { beat }) {
        return [{
          transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(beat, 0, 0)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}

registerMoverOrSplitterDefinition(driftMover)
test.after(() => unregisterMoverOrSplitterDefinitionForTests('test.drift'))

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

/** `cube` drifts along +X forever, with a freeze row holding beats 4..6. */
function frozenCube(release: number, pitch: number): ProjectSnapshot {
  const tracks = [
    track({ id: 'cube', instrumentId: 'cube', childIds: ['drift', 'frz'] }),
    track({ id: 'drift', type: 'mover', moverId: 'test.drift', parentId: 'cube' }),
    track({
      id: 'frz', type: 'mover', moverId: 'freeze', parentId: 'cube',
      inputValues: { release },
      blocks: [{
        id: 'b', startBar: 0, durationBars: 4, loop: false,
        notes: [{ id: 'n', startBeat: 4, durationBeats: 2, pitch, velocity: 1 }],
      }],
    }),
  ]
  return { tracks: Object.fromEntries(tracks.map((t) => [t.id, t])), rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120 }
}

/** Where the drift mover has pushed the copy - i.e. what the eye sees. */
function driftX(): number {
  return getVisualCopies('cube')[0].transform.elements[12]
}

test('a held freeze stops the chain below it dead', () => {
  setProject(frozenCube(RELEASE_CONTINUE, 60))

  computeAtBeat(3)
  assert.equal(driftX(), 3)
  for (const beat of [4, 4.5, 5, 5.99]) {
    computeAtBeat(beat)
    assert.equal(driftX(), 4, `beat ${beat} should still be showing beat 4`)
  }
})

test('the remap reaches the object state instruments render from, not just the chain', () => {
  setProject(frozenCube(RELEASE_CONTINUE, 60))
  computeAtBeat(5)
  // Whole-object scope: an instrument animating off its own beat freezes too.
  assert.equal(getObjectState('cube')?.beat, 4)
})

test('continue mode resumes exactly where it stopped', () => {
  setProject(frozenCube(RELEASE_CONTINUE, 60))
  computeAtBeat(6)
  assert.equal(driftX(), 4)
  computeAtBeat(9)
  assert.equal(driftX(), 7)
})

test('snap-back mode cuts to real time on release', () => {
  setProject(frozenCube(RELEASE_SNAP, 60))
  computeAtBeat(5)
  assert.equal(driftX(), 4)
  computeAtBeat(6)
  assert.equal(driftX(), 6)
})

test('a held reverse retraces the path the object arrived by', () => {
  setProject(frozenCube(RELEASE_SNAP, 62))
  computeAtBeat(4.5)
  assert.equal(driftX(), 3.5)
  computeAtBeat(5.5)
  assert.equal(driftX(), 2.5)
  computeAtBeat(6)
  assert.equal(driftX(), 6)
})

test('a freeze row with no notes leaves the object on real time', () => {
  const snapshot = frozenCube(RELEASE_CONTINUE, 60)
  snapshot.tracks.frz.blocks = []
  setProject(snapshot)
  computeAtBeat(5)
  assert.equal(driftX(), 5)
  assert.equal(getVisualCopies('cube').length, 1, 'freeze adds no copies')
})

test('scrubbing away and back through a freeze reproduces the same frame', () => {
  setProject(frozenCube(RELEASE_CONTINUE, 60))
  computeAtBeat(5)
  const frozen = driftX()
  computeAtBeat(0)
  computeAtBeat(120)
  computeAtBeat(5)
  assert.equal(driftX(), frozen)
})
