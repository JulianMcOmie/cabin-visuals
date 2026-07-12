import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { flattenBlocks } from './noteFlatten'
import { computeAtBeat, getObjectState, getVisualCopy, setProject } from './VisualEngine'

function round(n: number) {
  return Math.round(n * 1_000_000) / 1_000_000
}

function normalizedForward(m: number[]): [number, number, number] {
  const len = Math.hypot(m[8], m[9], m[10]) || 1
  const clean = (n: number) => Object.is(n, -0) ? 0 : n
  return [clean(round(m[8] / len)), clean(round(m[9] / len)), clean(round(m[10] / len))]
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
    params: { baseSize: 1.6, baseXPosition: 0, baseYPosition: 0, baseZPosition: 0, spinSpeed: 0 },
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
    moverId: 'burst',
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
    params: { baseSize: 1.6, baseXPosition: 0.5, baseYPosition: -0.25, baseZPosition: 0, spinSpeed: 0 },
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
    moverId: 'burst',
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

test('envelope track on the reserved opacity target gates the object by its notes', () => {
  const cube: Track = {
    id: 'cube-env-opacity',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['env-opacity'],
  }
  const env: Track = {
    id: 'env-opacity',
    name: 'Env · Opacity',
    type: 'envelope',
    instrumentId: '',
    targetParam: 'opacity',
    adsr: { attackBeats: 1, decayBeats: 1, sustainLevel: 0.5, releaseBeats: 1 },
    envDepth: 1,
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'gates',
      startBar: 0,
      durationBars: 2,
      loop: false,
      notes: [{ id: 'gate', startBeat: 0, durationBeats: 4, pitch: 60, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-env-opacity',
  }

  setProject({ tracks: { 'cube-env-opacity': cube, 'env-opacity': env }, rootTrackIds: ['cube-env-opacity'], beatsPerBar: 4, bpm: 120, totalBars: 4 })

  computeAtBeat(0.5) // mid-attack
  assert.equal(serializeState('cube-env-opacity').opacity, 0.5)
  computeAtBeat(3) // sustaining
  assert.equal(serializeState('cube-env-opacity').opacity, 0.5)
  computeAtBeat(4.5) // mid-release: 0.5 * 0.5
  assert.equal(serializeState('cube-env-opacity').opacity, 0.25)
  computeAtBeat(8) // fully released, depth 1 → fully gated (invisible between gates)
  assert.equal(serializeState('cube-env-opacity').opacity, 0)
})

test('envelope depth blends the opacity gate toward no-effect', () => {
  const cube: Track = {
    id: 'cube-env-depth',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['env-depth'],
  }
  const env: Track = {
    id: 'env-depth',
    name: 'Env · Opacity',
    type: 'envelope',
    instrumentId: '',
    targetParam: 'opacity',
    adsr: { attackBeats: 1, decayBeats: 1, sustainLevel: 0.5, releaseBeats: 1 },
    envDepth: 0.5,
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'gates',
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [{ id: 'gate', startBeat: 0, durationBeats: 2, pitch: 60, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-env-depth',
  }

  setProject({ tracks: { 'cube-env-depth': cube, 'env-depth': env }, rootTrackIds: ['cube-env-depth'], beatsPerBar: 4, bpm: 120, totalBars: 4 })

  // Idle (gain 0): opacity = 1 - depth = 0.5, not fully invisible.
  computeAtBeat(10)
  assert.equal(serializeState('cube-env-depth').opacity, 0.5)
})

test('envelope track lerps a numeric param toward its peak value', () => {
  const cube: Track = {
    id: 'cube-env-param',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['env-x'],
  }
  const env: Track = {
    id: 'env-x',
    name: 'Env · Base X Position',
    type: 'envelope',
    instrumentId: '',
    targetParam: 'baseXPosition',
    adsr: { attackBeats: 1, decayBeats: 1, sustainLevel: 1, releaseBeats: 1 },
    envDepth: 1,
    envTarget: 2,
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'gates',
      startBar: 0,
      durationBars: 2,
      loop: false,
      notes: [{ id: 'gate', startBeat: 0, durationBeats: 4, pitch: 60, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-env-param',
  }

  setProject({ tracks: { 'cube-env-param': cube, 'env-x': env }, rootTrackIds: ['cube-env-param'], beatsPerBar: 4, bpm: 120, totalBars: 4 })

  computeAtBeat(0.5) // half gain → halfway from base 0 to envTarget 2
  assert.equal(serializeState('cube-env-param').world[12], 1)
  computeAtBeat(2) // sustain 1 → the full peak value
  assert.equal(serializeState('cube-env-param').world[12], 2)
  computeAtBeat(10) // released → back to the base param
  assert.equal(serializeState('cube-env-param').world[12], 0)
})

test('muted envelope child is ignored', () => {
  const cube: Track = {
    id: 'cube-env-muted',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['env-muted'],
  }
  const env: Track = {
    id: 'env-muted',
    name: 'Env · Opacity',
    type: 'envelope',
    instrumentId: '',
    targetParam: 'opacity',
    adsr: { attackBeats: 1, decayBeats: 1, sustainLevel: 0.5, releaseBeats: 1 },
    envDepth: 1,
    color: '#6366f1',
    muted: true,
    solo: false,
    blocks: [{
      id: 'gates',
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [{ id: 'gate', startBeat: 0, durationBeats: 2, pitch: 60, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-env-muted',
  }

  setProject({ tracks: { 'cube-env-muted': cube, 'env-muted': env }, rootTrackIds: ['cube-env-muted'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(10)
  assert.equal(serializeState('cube-env-muted').opacity, 1)
})

