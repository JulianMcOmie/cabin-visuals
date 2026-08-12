import assert from 'node:assert/strict'
import test from 'node:test'
import type { Block, Track } from '../../types'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'

// Child order routes spatial tf* automation (resolve.ts's weave step): a lane
// ABOVE a splitter animates each copy in place (the splitter duplicates the
// animated object), a lane BELOW every chain child keeps the historical
// whole-formation placement path. These tests pin both directions plus the
// mirrored middle slot, the base-relative delta, and the lanes that must stay
// overlays (non-spatial params, no live chain entry below).

function keyframeBlock(notes: { pitch: number; startBeat: number }[]): Block {
  return {
    id: crypto.randomUUID(),
    startBar: 0,
    durationBars: 4,
    loop: false,
    notes: notes.map((n) => ({
      id: crypto.randomUUID(),
      pitch: n.pitch,
      startBeat: n.startBeat,
      durationBeats: 0.5,
      velocity: 100,
    })),
  }
}

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

/** tfRot* pitch encoding over the frozen 36-84 span: 60 = 0°, 72 = 90°, 84 = 180°. */
function rotLane(id: string, param: string, notes: { pitch: number; startBeat: number }[]): Track {
  return track({ id, type: 'automation', parentId: 'obj', targetParam: param, blocks: [keyframeBlock(notes)] })
}

function gridChild(id: string, columns: number, spacing: number): Track {
  return track({
    id,
    type: 'splitter',
    parentId: 'obj',
    splitterId: 'grid',
    inputValues: { rows: 1, columns, depth: 1, spacing },
  })
}

function resolveObj(children: Track[], params: Record<string, number> = {}) {
  const obj = track({ id: 'obj', instrumentId: 'cube', params, childIds: children.map((c) => c.id) })
  const p: ProjectSnapshot = {
    tracks: Object.fromEntries([obj, ...children].map((t) => [t.id, t])),
    rootTrackIds: ['obj'],
    beatsPerBar: 4,
    bpm: 120,
  }
  const resolved = resolveProject(p).objects.find((o) => o.trackId === 'obj')
  assert.ok(resolved, 'object resolved')
  return resolved
}

const positions = (copies: ReturnType<typeof resolveVisualCopies>) =>
  copies.map((c) => [c.transform.elements[12], c.transform.elements[13], c.transform.elements[14]]
    .map((v) => Number(v.toFixed(6)) || 0))

/** The copy's local X basis - a pure Y rotation by θ reads (cosθ, 0, −sinθ). */
const xBasis = (copies: ReturnType<typeof resolveVisualCopies>) =>
  copies.map((c) => [c.transform.elements[0], c.transform.elements[1], c.transform.elements[2]]
    .map((v) => Number(v.toFixed(6)) || 0))

test('a tf lane above a splitter spins each copy in place', () => {
  const lane = rotLane('lane', 'tfRotY', [{ pitch: 60, startBeat: 0 }, { pitch: 84, startBeat: 4 }])
  const obj = resolveObj([lane, gridChild('split', 2, 2)])
  // The lane left the placement overlay and joined the chain as a delta entry.
  assert.equal(obj.automations.length, 0)
  assert.equal(obj.moverAndSplitterChain.length, 2)
  const at0 = resolveVisualCopies(obj.moverAndSplitterChain, 0)
  const at2 = resolveVisualCopies(obj.moverAndSplitterChain, 2) // lane reads 90°
  assert.equal(at0.length, 2)
  // Slots hold still while every copy carries the rotation itself...
  assert.deepEqual(positions(at0), [[-1, 0, 0], [1, 0, 0]])
  assert.deepEqual(positions(at2), [[-1, 0, 0], [1, 0, 0]])
  // ...which under the legacy placement path would have orbited them instead.
  assert.deepEqual(xBasis(at2), [[0, 0, -1], [0, 0, -1]])
})

test('a tf lane below the whole chain keeps the placement overlay (formation moves as one)', () => {
  const lane = rotLane('lane', 'tfRotY', [{ pitch: 60, startBeat: 0 }, { pitch: 84, startBeat: 4 }])
  const obj = resolveObj([gridChild('split', 2, 2), lane])
  assert.equal(obj.automations.length, 1)
  assert.equal(obj.automations[0].param, 'tfRotY')
  assert.equal(obj.moverAndSplitterChain.length, 1)
})

test('a lane between two splitters mirrors into the slot between them', () => {
  const lane = rotLane('lane', 'tfRotY', [{ pitch: 60, startBeat: 0 }, { pitch: 84, startBeat: 4 }])
  const obj = resolveObj([gridChild('splitA', 2, 4), lane, gridChild('splitB', 2, 1)])
  assert.equal(obj.automations.length, 0)
  assert.equal(obj.moverAndSplitterChain.length, 3)
  // slotA · R_y(90°) · slotB: the outer slots stay put while each copy's
  // sub-formation turns about its own slot (B's ±0.5 x-offsets become ∓z).
  const at2 = resolveVisualCopies(obj.moverAndSplitterChain, 2)
  assert.deepEqual(positions(at2), [
    [-2, 0, 0.5],
    [-2, 0, -0.5],
    [2, 0, 0.5],
    [2, 0, -0.5],
  ])
})

test('the chain delta is relative to the panel value, so keyframe values stay absolute', () => {
  // Panel says 30°; the lane holds 90°. Placement keeps composing the panel's
  // 30 exactly as before, so the chain entry contributes only the 60° delta.
  const lane = rotLane('lane', 'tfRotY', [{ pitch: 72, startBeat: 0 }])
  const obj = resolveObj([lane, gridChild('split', 2, 2)], { tfRotY: 30 })
  const copies = resolveVisualCopies(obj.moverAndSplitterChain, 0)
  const cos60 = Number(Math.cos(Math.PI / 3).toFixed(6))
  const sin60 = Number(Math.sin(Math.PI / 3).toFixed(6))
  assert.deepEqual(xBasis(copies), [[cos60, 0, -sin60], [cos60, 0, -sin60]])
})

test('a muted splitter below the lane leaves it on the overlay path', () => {
  const lane = rotLane('lane', 'tfRotY', [{ pitch: 84, startBeat: 0 }])
  const muted = { ...gridChild('split', 2, 2), muted: true }
  const obj = resolveObj([lane, muted])
  assert.equal(obj.moverAndSplitterChain.length, 0)
  assert.equal(obj.automations.length, 1)
})

test('non-spatial lanes stay overlays wherever they sit', () => {
  const opacity = rotLane('lane1', 'tfOpacity', [{ pitch: 84, startBeat: 0 }])
  const instrument = rotLane('lane2', 'size', [{ pitch: 84, startBeat: 0 }])
  const obj = resolveObj([opacity, instrument, gridChild('split', 2, 2)])
  assert.deepEqual(obj.automations.map((a) => a.param).sort(), ['size', 'tfOpacity'])
  assert.equal(obj.moverAndSplitterChain.length, 1)
})
