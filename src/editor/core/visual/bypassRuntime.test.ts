import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import type { MoverOrSplitterDefinition } from '../visualCopies/definitions'
import { BYPASS_ON_REST, BYPASS_PITCH } from '../visualCopies/bypass'
import {
  registerMoverOrSplitterDefinition,
  unregisterMoverOrSplitterDefinitionForTests,
} from '../visualCopies/registry'
import { computeAtBeat, getVisualCopies, setProject } from './VisualEngine'
import { getPriorVisualCopyCount, resolveProject, type ProjectSnapshot } from './resolve'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'

// A Bypass lane is the one child that is NOT an entry of the chain its parent
// builds: it wraps the parent instead. What has to be proven here is the wiring
// - that it reaches the parent, that it stays out of every chain walk, and that
// a bypassed SPLITTER keeps the mounted copy pool it was sized for. The gate's
// own arithmetic belongs to visualCopies/bypass.test.ts.

/** Shifts +1 on X, so "did the parent run" is one number. */
const shift: MoverOrSplitterDefinition<Record<string, never>> = {
  id: 'test.bypassShift',
  label: 'Shift',
  kind: 'mover',
  params: [],
  resolve() {
    return {
      apply(visualCopy) {
        return [{
          transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(1, 0, 0)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}

/** Three copies, so "did it fan out" is a length. */
const triple: MoverOrSplitterDefinition<Record<string, never>> = {
  id: 'test.bypassTriple',
  label: 'Triple',
  kind: 'splitter',
  params: [],
  resolve() {
    return {
      apply(visualCopy) {
        return [0, 1, 2].map((i) => ({
          transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(i, 0, 0)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }))
      },
    }
  },
}

registerMoverOrSplitterDefinition(shift)
registerMoverOrSplitterDefinition(triple)
test.after(() => {
  unregisterMoverOrSplitterDefinitionForTests('test.bypassShift')
  unregisterMoverOrSplitterDefinitionForTests('test.bypassTriple')
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

/** A bypass lane holding beats 4..6. */
function bypassLane(id: string, parentId: string, mode = 0, extra: Partial<Track> = {}): Track {
  return track({
    id, type: 'mover', moverId: 'bypass', parentId,
    inputValues: { mode },
    blocks: [{
      id: `${id}-b`, startBar: 0, durationBars: 4, loop: false,
      notes: [{ id: `${id}-n`, startBeat: 4, durationBeats: 2, pitch: BYPASS_PITCH, velocity: 100 }],
    }],
    ...extra,
  })
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

const shiftedX = (p: ProjectSnapshot, beat: number) =>
  resolveVisualCopies(chainOf(p, 'cube'), beat)[0].transform.elements[12]

test('a held note switches the parent mover off, and it comes back after', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['m'] }),
    track({ id: 'm', type: 'mover', moverId: 'test.bypassShift', parentId: 'cube', childIds: ['gate'] }),
    bypassLane('gate', 'm'),
  ], ['cube'])
  assert.equal(shiftedX(p, 3), 1)
  assert.equal(shiftedX(p, 5), 0)
  assert.equal(shiftedX(p, 7), 1)
})

test('Switch on mode leaves the parent off until it is played', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['m'] }),
    track({ id: 'm', type: 'mover', moverId: 'test.bypassShift', parentId: 'cube', childIds: ['gate'] }),
    bypassLane('gate', 'm', BYPASS_ON_REST),
  ], ['cube'])
  assert.equal(shiftedX(p, 3), 0)
  assert.equal(shiftedX(p, 5), 1)
})

test('a muted bypass lane stops gating', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['m'] }),
    track({ id: 'm', type: 'mover', moverId: 'test.bypassShift', parentId: 'cube', childIds: ['gate'] }),
    bypassLane('gate', 'm', 0, { muted: true }),
  ], ['cube'])
  assert.equal(shiftedX(p, 5), 1)
})

test('a bypass lane is not an entry of the parent frame it sits in', () => {
  // A mover's children are its FRAME. If the bypass lane joined that frame it
  // would resolve as an ordinary identity entry and gate nothing - which is
  // exactly what a filter drifting out of step with isChainEntryTrack looks
  // like, so pin both halves: the chain is one entry, and it still gates.
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['m'] }),
    track({ id: 'm', type: 'mover', moverId: 'test.bypassShift', parentId: 'cube', childIds: ['gate'] }),
    bypassLane('gate', 'm'),
  ], ['cube'])
  assert.equal(chainOf(p, 'cube').length, 1)
  assert.equal(shiftedX(p, 5), 0)
})

test('a bypass lane on the OBJECT itself is inert rather than an identity entry', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['m', 'gate'] }),
    track({ id: 'm', type: 'mover', moverId: 'test.bypassShift', parentId: 'cube' }),
    bypassLane('gate', 'cube'),
  ], ['cube'])
  assert.equal(chainOf(p, 'cube').length, 1)
  assert.equal(shiftedX(p, 5), 1)
})

test('a bypassed splitter collapses, and the mounted pool is still sized for its fan-out', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['s'] }),
    track({ id: 's', type: 'splitter', splitterId: 'test.bypassTriple', parentId: 'cube', childIds: ['gate'] }),
    // Bypassed across beat 0, which is the beat the structural probe samples.
    track({
      id: 'gate', type: 'mover', moverId: 'bypass', parentId: 's',
      inputValues: { mode: 0 },
      blocks: [{
        id: 'gb', startBar: 0, durationBars: 4, loop: false,
        notes: [{ id: 'gn', startBeat: 0, durationBeats: 2, pitch: BYPASS_PITCH, velocity: 100 }],
      }],
    }),
  ], ['cube'])
  setProject(p)

  computeAtBeat(1)
  const bypassed = getVisualCopies('cube')
  assert.equal(bypassed.length, 3, 'the pool stays mounted')
  assert.equal(bypassed.filter((c) => c.opacity > 0).length, 1, 'padded with hidden copies')

  computeAtBeat(5)
  const running = getVisualCopies('cube')
  assert.equal(running.length, 3)
  assert.equal(running.filter((c) => c.opacity > 0).length, 3)
})

test('a bypass lane does not shift the copy count a downstream lane sizes its rows against', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['s', 'vis'] }),
    track({ id: 's', type: 'splitter', splitterId: 'test.bypassTriple', parentId: 'cube', childIds: ['gate'] }),
    track({
      id: 'gate', type: 'mover', moverId: 'bypass', parentId: 's',
      inputValues: { mode: 0 },
      blocks: [{
        id: 'gb', startBar: 0, durationBars: 4, loop: false,
        notes: [{ id: 'gn', startBeat: 0, durationBeats: 2, pitch: BYPASS_PITCH, velocity: 100 }],
      }],
    }),
    track({ id: 'vis', type: 'mover', moverId: 'visibility', parentId: 'cube' }),
  ], ['cube'])
  assert.equal(getPriorVisualCopyCount('vis', p), 3)
})
