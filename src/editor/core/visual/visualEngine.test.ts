import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { flattenBlocks } from './noteFlatten'
import { computeAtBeat, getObjectState, getVisualCopy, setProject } from './VisualEngine'

function round(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000
}

function serializeState(trackId: string) {
  const state = getObjectState(trackId)
  assert.ok(state)
  return {
    world: state.world.toArray().map(round),
    opacity: round(state.opacity),
    activeNotes: state.activeNotes.map((n) => ({ beat: n.beat, pitch: n.pitch, durationBeats: n.durationBeats })),
    energy: round(state.energy),
  }
}

test('looped blocks expand at resolve-time note boundaries', () => {
  const notes = flattenBlocks([
    {
      id: 'loop',
      startBar: 0,
      durationBars: 4,
      loop: true,
      loopLengthBars: 1,
      notes: [{ id: 'n1', startBeat: 0.5, durationBeats: 0.25, pitch: 60, velocity: 1 }],
    },
  ], 4, 4)

  assert.deepEqual(notes.map((n) => n.beat), [0.5, 4.5, 8.5, 12.5])
  assert.deepEqual(notes.map((n) => n.pitch), [60, 60, 60, 60])
})

test('computeAtBeat is deterministic across repeated calls', () => {
  const cube: Track = {
    id: 'cube',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'block',
      startBar: 0,
      durationBars: 2,
      loop: false,
      notes: [{ id: 'note', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 1 }],
    }],
    childIds: ['burst'],
  }
  const burst: Track = {
    id: 'burst',
    name: 'Burst',
    type: 'mover',
    instrumentId: '',
    moverId: 'mover',
    inputValues: { easing: 5, burstBeats: 2 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'bblock',
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [{ id: 'bnote', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube',
  }

  setProject({ tracks: { cube, burst }, rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120, totalBars: 4 })

  computeAtBeat(1.3)
  const first = serializeState('cube')
  const firstCopy = getVisualCopy('cube', 0)!.transform.toArray()
  computeAtBeat(1.3)
  assert.deepEqual(serializeState('cube'), first)
  assert.deepEqual(getVisualCopy('cube', 0)!.transform.toArray(), firstCopy)
})

test('scrubbing back to a beat reproduces the same object state and copies', () => {
  // Same project as above (module-level engine state persists per test file order,
  // so re-set it explicitly for isolation).
  const cube: Track = {
    id: 'cube-scrub',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { tfX: 0.5, tfY: -0.25, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'block',
      startBar: 0,
      durationBars: 2,
      loop: false,
      notes: [{ id: 'note', startBeat: 0.5, durationBeats: 0.5, pitch: 62, velocity: 0.8 }],
    }],
    childIds: ['burst-scrub'],
  }
  const burst: Track = {
    id: 'burst-scrub',
    name: 'Burst',
    type: 'mover',
    instrumentId: '',
    moverId: 'mover',
    inputValues: { easing: 0, burstBeats: 1 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'bblock',
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [
        { id: 'b1', startBeat: 0, durationBeats: 1, pitch: 60, velocity: 1 },
        { id: 'b2', startBeat: 1, durationBeats: 1, pitch: 62, velocity: 0.5 },
      ],
    }],
    childIds: [],
    parentId: 'cube-scrub',
  }

  setProject({ tracks: { 'cube-scrub': cube, 'burst-scrub': burst }, rootTrackIds: ['cube-scrub'], beatsPerBar: 4, bpm: 120, totalBars: 4 })

  computeAtBeat(1.75)
  const at175 = serializeState('cube-scrub')
  const copy175 = getVisualCopy('cube-scrub', 0)!.transform.toArray()
  computeAtBeat(0)
  computeAtBeat(3.2)
  computeAtBeat(1.75)
  assert.deepEqual(serializeState('cube-scrub'), at175)
  assert.deepEqual(getVisualCopy('cube-scrub', 0)!.transform.toArray(), copy175)
})

test('track size is inherited: children and mover layouts scale with the parent', () => {
  // tfSize 2 is a group fader: it lives IN the world matrix, so child placements
  // and mover layout distances scale with the parent. The instrument's own pulse
  // scale is still mesh-local (state.meshScale).
  const parent: Track = {
    id: 'cube-parent',
    name: 'Parent',
    type: 'base',
    instrumentId: 'cube',
    params: { tfSize: 2, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['cube-child'],
  }
  const child: Track = {
    id: 'cube-child',
    name: 'Child',
    type: 'base',
    instrumentId: 'cube',
    params: { tfX: 1, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'cube-parent',
  }

  setProject({ tracks: { 'cube-parent': parent, 'cube-child': child }, rootTrackIds: ['cube-parent'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)

  // The parent's size sits in its world matrix; meshScale carries only the
  // (currently idle) note pulse.
  const p = getObjectState('cube-parent')
  assert.ok(p)
  assert.equal(round(p.meshScale), 1)
  assert.equal(round(p.world.toArray()[0]), 2)

  // The child's placement inherits the parent's size: its x=1 lands at world
  // x=2, and its rendered scale doubles too.
  const c = getObjectState('cube-child')
  assert.ok(c)
  assert.equal(round(c.world.toArray()[12]), 2)
  assert.equal(round(c.world.toArray()[0]), 2)
  assert.equal(round(c.meshScale), 1)
})

test('a burst-mode automation lane carries its param from the base to the note value', () => {
  // spinSpeed is 0..4 on Cube, so the top automation row (pitch 84) means 4.
  // Whole-beat stages make each expected value readable by hand.
  const cube: Track = {
    id: 'cube-burst',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { spinSpeed: 1 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['lane-burst'],
  }
  const lane: Track = {
    id: 'lane-burst',
    name: 'Spin Speed',
    type: 'automation',
    instrumentId: '',
    targetParam: 'spinSpeed',
    burst: { attackBeats: 1, decayBeats: 1, sustainLevel: 0.5, releaseBeats: 1, intensity: 1 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'lblock',
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [{ id: 'ln', startBeat: 0, durationBeats: 2, pitch: 84, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-burst',
  }

  setProject({ tracks: { 'cube-burst': cube, 'lane-burst': lane }, rootTrackIds: ['cube-burst'], beatsPerBar: 4, bpm: 120, totalBars: 4 })

  const spinAt = (beat: number) => {
    computeAtBeat(beat)
    return round(getObjectState('cube-burst')!.params.spinSpeed)
  }

  assert.equal(spinAt(1), 4)      // peak: arrives exactly at the note's value
  assert.equal(spinAt(0.5), 2.5)  // half attack: halfway from base 1 to 4
  assert.equal(spinAt(2), 2.5)    // decayed to sustain 0.5
  assert.equal(spinAt(2.5), 1.75) // halfway through the release
  assert.equal(spinAt(3.5), 1)    // fully released - the lane is inert, base shows
  assert.equal(spinAt(1), 4)      // scrubbing back reproduces the value exactly
})

test('a burst lane with intensity 0 leaves its param completely alone', () => {
  const cube: Track = {
    id: 'cube-burst-off',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { spinSpeed: 2 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['lane-burst-off'],
  }
  const lane: Track = {
    id: 'lane-burst-off',
    name: 'Spin Speed',
    type: 'automation',
    instrumentId: '',
    targetParam: 'spinSpeed',
    burst: { attackBeats: 1, decayBeats: 1, sustainLevel: 0.5, releaseBeats: 1, intensity: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'lblock',
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [{ id: 'ln', startBeat: 0, durationBeats: 2, pitch: 84, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-burst-off',
  }

  setProject({ tracks: { 'cube-burst-off': cube, 'lane-burst-off': lane }, rootTrackIds: ['cube-burst-off'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(1)
  assert.equal(round(getObjectState('cube-burst-off')!.params.spinSpeed), 2)
})
