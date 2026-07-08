import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { flattenBlocks } from './noteFlatten'
import { computeAtBeat, getObjectState, setProject } from './VisualEngine'

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
    elementCount: state.elementCount,
    elementMatrices: state.elementMatrices.slice(0, state.elementCount).map((m) => m.toArray().map(round)),
    elementOpacities: state.elementOpacities.slice(0, state.elementCount).map(round),
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
    childIds: ['spin'],
  }
  const spin: Track = {
    id: 'spin',
    name: 'Spin',
    type: 'mover',
    instrumentId: '',
    moverId: 'spin',
    depth: 1,
    inputValues: { angle: 0.75 },
    midiMode: 'none',
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'cube',
  }

  setProject({ tracks: { cube, spin }, rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(1.25)
  const first = serializeState('cube')
  computeAtBeat(1.25)
  const second = serializeState('cube')

  assert.deepEqual(second, first)
})

test('scrubbing back to a beat reproduces the same object state', () => {
  const cube: Track = {
    id: 'cube-scrub',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, baseXPosition: 0.5, baseYPosition: -0.25, baseZPosition: 0, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['orbit'],
  }
  const orbit: Track = {
    id: 'orbit',
    name: 'Orbit',
    type: 'mover',
    instrumentId: '',
    moverId: 'orbit',
    depth: 0.8,
    inputValues: { radius: 1.2, rate: 0.5, phase: 0.1, tilt: 0.2 },
    midiMode: 'none',
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'cube-scrub',
  }

  setProject({ tracks: { 'cube-scrub': cube, orbit }, rootTrackIds: ['cube-scrub'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(2.5)
  const before = serializeState('cube-scrub')
  computeAtBeat(0)
  computeAtBeat(2.5)
  const after = serializeState('cube-scrub')

  assert.deepEqual(after, before)
})

test('continuous mover MIDI interpolates note values between onsets', () => {
  const cube: Track = {
    id: 'cube-continuous',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, baseXPosition: 1, baseYPosition: 0, baseZPosition: 0, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['spin-continuous'],
  }
  const spin: Track = {
    id: 'spin-continuous',
    name: 'Spin',
    type: 'mover',
    instrumentId: '',
    moverId: 'spin',
    depth: 1,
    inputValues: { angle: 0 },
    midiMode: 'continuous',
    midiTargetInput: 'angle',
    interpolation: 'linear',
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'spin-envelope',
      startBar: 0,
      durationBars: 2,
      loop: false,
      notes: [
        { id: 'angle-zero', startBeat: 0, durationBeats: 0.25, pitch: 60, velocity: 1 },
        { id: 'angle-tau', startBeat: 4, durationBeats: 0.25, pitch: 84, velocity: 1 },
      ],
    }],
    childIds: [],
    parentId: 'cube-continuous',
  }

  setProject({
    tracks: { 'cube-continuous': cube, 'spin-continuous': spin },
    rootTrackIds: ['cube-continuous'],
    beatsPerBar: 4,
    bpm: 120,
    totalBars: 2,
  })
  computeAtBeat(2)

  assert.equal(serializeState('cube-continuous').world[12], -1)
})

test('continuous mover MIDI ignores invalid saved targets and falls back to angle', () => {
  const cube: Track = {
    id: 'cube-continuous-fallback',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, baseXPosition: 1, baseYPosition: 0, baseZPosition: 0, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['spin-continuous-fallback'],
  }
  const spin: Track = {
    id: 'spin-continuous-fallback',
    name: 'Spin',
    type: 'mover',
    instrumentId: '',
    moverId: 'spin',
    depth: 1,
    inputValues: { angle: 0 },
    midiMode: 'continuous',
    midiTargetInput: 'space',
    interpolation: 'linear',
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'spin-envelope',
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [{ id: 'angle-pi', startBeat: 0, durationBeats: 0.25, pitch: 72, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-continuous-fallback',
  }

  setProject({
    tracks: { 'cube-continuous-fallback': cube, 'spin-continuous-fallback': spin },
    rootTrackIds: ['cube-continuous-fallback'],
    beatsPerBar: 4,
    bpm: 120,
    totalBars: 1,
  })
  computeAtBeat(0)

  assert.equal(serializeState('cube-continuous-fallback').world[12], -1)
})

test('amount mode drives spin rate direction from MIDI value', () => {
  const cube: Track = {
    id: 'cube-amount',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, baseXPosition: 1, baseYPosition: 0, baseZPosition: 0, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['spin-amount'],
  }
  const spin: Track = {
    id: 'spin-amount',
    name: 'Spin',
    type: 'mover',
    instrumentId: '',
    moverId: 'spin',
    depth: 1,
    inputValues: { angle: 0, rate: 0.25 },
    midiMode: 'amount',
    interpolation: 'linear',
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'amount-envelope',
      startBar: 0,
      durationBars: 2,
      loop: false,
      notes: [{ id: 'reverse', startBeat: 0, durationBeats: 0.25, pitch: 36, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-amount',
  }

  setProject({
    tracks: { 'cube-amount': cube, 'spin-amount': spin },
    rootTrackIds: ['cube-amount'],
    beatsPerBar: 4,
    bpm: 120,
    totalBars: 2,
  })
  computeAtBeat(1)
  const world = serializeState('cube-amount').world

  assert.equal(Math.abs(world[12]), 0)
  assert.equal(world[14], 1)
})

test('swarm produces one matrix per resolved element', () => {
  const swarm: Track = {
    id: 'swarm',
    name: 'Swarm',
    type: 'base',
    instrumentId: 'swarm',
    params: { count: 4, layout: 0, radius: 2, spacing: 0.5, size: 0.2 },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['breathe'],
  }
  const breathe: Track = {
    id: 'breathe',
    name: 'Breathe',
    type: 'mover',
    instrumentId: '',
    moverId: 'breathe',
    depth: 1,
    inputValues: { amount: 0.2, rate: 1, phase: 0 },
    midiMode: 'none',
    weight: { mode: 'odd' },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'swarm',
  }

  setProject({ tracks: { swarm, breathe }, rootTrackIds: ['swarm'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0.25)
  const state = serializeState('swarm')

  assert.equal(state.elementCount, 4)
  assert.equal(state.elementMatrices.length, 4)
  assert.notDeepEqual(state.elementMatrices[0], state.elementMatrices[1])
})

test('swarm ring elements face outward from the ring center', () => {
  const swarm: Track = {
    id: 'swarm-facing',
    name: 'Swarm',
    type: 'base',
    instrumentId: 'swarm',
    params: { count: 4, layout: 0, radius: 2, spacing: 0.5, size: 0.2 },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
  }

  setProject({ tracks: { 'swarm-facing': swarm }, rootTrackIds: ['swarm-facing'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)
  const state = serializeState('swarm-facing')

  assert.deepEqual(normalizedForward(state.elementMatrices[0]), [1, 0, 0])
  assert.deepEqual(normalizedForward(state.elementMatrices[1]), [0, 1, 0])
  assert.deepEqual(normalizedForward(state.elementMatrices[2]), [-1, 0, 0])
  assert.deepEqual(normalizedForward(state.elementMatrices[3]), [0, -1, 0])
})

test('spin self space rotates a swarm element without orbiting its position', () => {
  const swarm: Track = {
    id: 'swarm-self-spin',
    name: 'Swarm',
    type: 'base',
    instrumentId: 'swarm',
    params: { count: 1, layout: 0, radius: 2, spacing: 0.5, size: 0.2 },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['self-spin'],
  }
  const spin: Track = {
    id: 'self-spin',
    name: 'Spin',
    type: 'mover',
    instrumentId: '',
    moverId: 'spin',
    depth: 1,
    inputValues: { space: 1, angle: Math.PI / 2, axisX: 0, axisY: 1, axisZ: 0 },
    midiMode: 'none',
    weight: { mode: 'all' },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'swarm-self-spin',
  }

  setProject({ tracks: { 'swarm-self-spin': swarm, 'self-spin': spin }, rootTrackIds: ['swarm-self-spin'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)
  const matrix = serializeState('swarm-self-spin').elementMatrices[0]

  assert.equal(matrix[12], 2)
  assert.equal(matrix[13], 0)
  assert.equal(matrix[14], 0)
  assert.notDeepEqual(normalizedForward(matrix), [1, 0, 0])
})

test('spin self local x axis can pitch a swarm element like a nod', () => {
  const swarm: Track = {
    id: 'swarm-self-nod',
    name: 'Swarm',
    type: 'base',
    instrumentId: 'swarm',
    params: { count: 1, layout: 0, radius: 2, spacing: 0.5, size: 0.2 },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['self-nod'],
  }
  const spin: Track = {
    id: 'self-nod',
    name: 'Spin',
    type: 'mover',
    instrumentId: '',
    moverId: 'spin',
    depth: 1,
    inputValues: { space: 1, angle: Math.PI / 2, axisX: 1, axisY: 0, axisZ: 0 },
    midiMode: 'none',
    weight: { mode: 'all' },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'swarm-self-nod',
  }

  setProject({ tracks: { 'swarm-self-nod': swarm, 'self-nod': spin }, rootTrackIds: ['swarm-self-nod'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)
  const matrix = serializeState('swarm-self-nod').elementMatrices[0]

  assert.equal(matrix[12], 2)
  assert.equal(matrix[13], 0)
  assert.equal(matrix[14], 0)
  assert.deepEqual(normalizedForward(matrix), [0, -1, 0])
})

test('dot wave offsets swarm elements by index', () => {
  const swarm: Track = {
    id: 'swarm-wave',
    name: 'Swarm',
    type: 'base',
    instrumentId: 'swarm',
    params: { count: 3, layout: 1, radius: 2, spacing: 1, size: 0.2 },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['dot-wave'],
  }
  const dotWave: Track = {
    id: 'dot-wave',
    name: 'Dot Wave',
    type: 'mover',
    instrumentId: '',
    moverId: 'dotWave',
    depth: 1,
    inputValues: { amount: 1, rate: 0, indexStep: 0.25, phase: 0 },
    midiMode: 'none',
    weight: { mode: 'all' },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'swarm-wave',
  }

  setProject({ tracks: { 'swarm-wave': swarm, 'dot-wave': dotWave }, rootTrackIds: ['swarm-wave'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)
  const state = serializeState('swarm-wave')

  assert.equal(state.elementMatrices[0][13], 0)
  assert.equal(state.elementMatrices[1][13], 1)
  assert.equal(state.elementMatrices[2][13], 0)
})

test('opacity mover resolves to object opacity', () => {
  const cube: Track = {
    id: 'cube-opacity',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['opacity-dim'],
  }
  const opacity: Track = {
    id: 'opacity-dim',
    name: 'Opacity',
    type: 'mover',
    instrumentId: '',
    moverId: 'opacity',
    depth: 1,
    inputValues: { opacity: 0.25 },
    midiMode: 'none',
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'cube-opacity',
  }

  setProject({ tracks: { 'cube-opacity': cube, 'opacity-dim': opacity }, rootTrackIds: ['cube-opacity'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)

  assert.equal(serializeState('cube-opacity').opacity, 0.25)
})

test('ballistic opacity rests at zero and peaks at full opacity by default', () => {
  const cube: Track = {
    id: 'cube-opacity-ballistic',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['opacity-ballistic'],
  }
  const opacity: Track = {
    id: 'opacity-ballistic',
    name: 'Opacity',
    type: 'mover',
    instrumentId: '',
    moverId: 'opacity',
    depth: 1,
    inputValues: {},
    midiMode: 'ballistic',
    envelope: { attack: 0.01, decay: 0.4 },
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [{
      id: 'opacity-trigger',
      startBar: 0,
      durationBars: 1,
      loop: false,
      notes: [{ id: 'hit', startBeat: 1, durationBeats: 0.25, pitch: 60, velocity: 1 }],
    }],
    childIds: [],
    parentId: 'cube-opacity-ballistic',
  }

  setProject({
    tracks: { 'cube-opacity-ballistic': cube, 'opacity-ballistic': opacity },
    rootTrackIds: ['cube-opacity-ballistic'],
    beatsPerBar: 4,
    bpm: 120,
    totalBars: 4,
  })
  computeAtBeat(0)
  assert.equal(serializeState('cube-opacity-ballistic').opacity, 0)

  computeAtBeat(1.01)
  assert.equal(serializeState('cube-opacity-ballistic').opacity, 1)
})

test('checker white weight targets alternating grid cells', () => {
  const swarm: Track = {
    id: 'swarm-checker',
    name: 'Swarm',
    type: 'base',
    instrumentId: 'swarm',
    params: { count: 4, layout: 2, radius: 2, spacing: 1, size: 0.2 },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['checker-opacity'],
  }
  const opacity: Track = {
    id: 'checker-opacity',
    name: 'Opacity',
    type: 'mover',
    instrumentId: '',
    moverId: 'opacity',
    depth: 1,
    inputValues: { opacity: 0 },
    midiMode: 'none',
    weight: { mode: 'checkerWhite' },
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'swarm-checker',
  }

  setProject({ tracks: { 'swarm-checker': swarm, 'checker-opacity': opacity }, rootTrackIds: ['swarm-checker'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)

  assert.deepEqual(serializeState('swarm-checker').elementOpacities, [0, 1, 1, 0])
})

function makeTranslateMover(id: string, dx: number, dy: number, dz: number): Track {
  return {
    id,
    name: id,
    type: 'mover',
    instrumentId: '',
    moverId: 'translate',
    depth: 1,
    inputValues: { dx, dy, dz },
    midiMode: 'none',
    weight: { mode: 'all' },
    opMode: 'add',
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'cube-add',
  }
}

test('add-mode movers in one run are order independent', () => {
  const cube: Track = {
    id: 'cube-add',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['a', 'b', 'c'],
  }
  const a = makeTranslateMover('a', 1, 0, 0)
  const b = makeTranslateMover('b', 0, 2, 0)
  const c = makeTranslateMover('c', 0, 0, 3)

  setProject({ tracks: { 'cube-add': cube, a, b, c }, rootTrackIds: ['cube-add'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)
  const first = serializeState('cube-add').world

  const cubeReordered = { ...cube, childIds: ['c', 'a', 'b'] }
  setProject({ tracks: { 'cube-add': cubeReordered, a, b, c }, rootTrackIds: ['cube-add'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)
  const second = serializeState('cube-add').world

  assert.deepEqual(second, first)
})

test('negative depth reverses a transform delta', () => {
  const cube: Track = {
    id: 'cube-negative-depth',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['negative-translate'],
  }
  const translate: Track = {
    id: 'negative-translate',
    name: 'Translate',
    type: 'mover',
    instrumentId: '',
    moverId: 'translate',
    depth: -1,
    inputValues: { dx: 2, dy: 0, dz: 0 },
    midiMode: 'none',
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'cube-negative-depth',
  }

  setProject({ tracks: { 'cube-negative-depth': cube, 'negative-translate': translate }, rootTrackIds: ['cube-negative-depth'], beatsPerBar: 4, bpm: 120, totalBars: 4 })
  computeAtBeat(0)

  assert.equal(serializeState('cube-negative-depth').world[12], -2)
})

test('soloed mover is the only local mover applied to its instrument', () => {
  const cube: Track = {
    id: 'cube-mover-solo',
    name: 'Cube',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: ['translate-x', 'translate-y'],
  }
  const translateX: Track = {
    id: 'translate-x',
    name: 'Translate X',
    type: 'mover',
    instrumentId: '',
    moverId: 'translate',
    depth: 1,
    inputValues: { dx: 2, dy: 0, dz: 0 },
    midiMode: 'none',
    weight: { mode: 'all' },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    parentId: 'cube-mover-solo',
  }
  const translateY: Track = {
    ...translateX,
    id: 'translate-y',
    name: 'Translate Y',
    inputValues: { dx: 0, dy: 3, dz: 0 },
    solo: true,
  }

  setProject({
    tracks: { 'cube-mover-solo': cube, 'translate-x': translateX, 'translate-y': translateY },
    rootTrackIds: ['cube-mover-solo'],
    beatsPerBar: 4,
    bpm: 120,
    totalBars: 4,
  })
  computeAtBeat(0)
  const world = serializeState('cube-mover-solo').world

  assert.equal(world[12], 0)
  assert.equal(world[13], 3)
})

test('top-level mover targets tagged objects after local movers', () => {
  const cubeA: Track = {
    id: 'cube-a',
    name: 'A',
    type: 'base',
    instrumentId: 'cube',
    params: { baseSize: 1.6, spinSpeed: 0 },
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    tags: ['group'],
  }
  const cubeB: Track = {
    ...cubeA,
    id: 'cube-b',
    name: 'B',
    tags: ['other'],
  }
  const globalDim: Track = {
    id: 'global-dim',
    name: 'Global Translate',
    type: 'mover',
    instrumentId: '',
    moverId: 'translate',
    depth: 1,
    inputValues: { dx: 2, dy: 0, dz: 0 },
    midiMode: 'none',
    weight: { mode: 'all' },
    opMode: 'transform',
    targets: [{ port: 'mover', scope: { kind: 'tag', tag: 'group' }, amount: 1 }],
    color: '#22d3ee',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
  }

  setProject({
    tracks: { 'cube-a': cubeA, 'cube-b': cubeB, 'global-dim': globalDim },
    rootTrackIds: ['cube-a', 'cube-b', 'global-dim'],
    beatsPerBar: 4,
    bpm: 120,
    totalBars: 4,
  })
  computeAtBeat(0)

  assert.equal(serializeState('cube-a').world[12], 2)
  assert.equal(serializeState('cube-b').world[12], 0)
})
