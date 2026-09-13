import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Block, Track } from '../../types'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'
import { identityVisualCopy } from '../visualCopies/identityVisualCopy'

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

test('duplicate spatial lanes in one chain slot combine in child order', () => {
  const first = { ...rotLane('a', 'tfRotY', [{ pitch: 72, startBeat: 0 }]), automationCombine: 'sum' as const }
  const last = { ...rotLane('b', 'tfRotY', [{ pitch: 60, startBeat: 0 }]), automationCombine: 'override' as const }
  const obj = resolveObj([first, last, gridChild('split', 2, 2)])
  assert.equal(obj.automations.length, 0)
  assert.deepEqual(xBasis(resolveVisualCopies(obj.moverAndSplitterChain, 0)), [[1, 0, 0], [1, 0, 0]])
  const reversed = resolveObj([last, first, gridChild('split', 2, 2)])
  assert.deepEqual(xBasis(resolveVisualCopies(reversed.moverAndSplitterChain, 0)), [[0, 0, -1], [0, 0, -1]])
})

test('spatial automation declares one immutable local transform with exact apply parity', () => {
  for (const param of ['tfX', 'tfY', 'tfZ', 'tfRotX', 'tfRotY', 'tfRotZ', 'tfSize']) {
    const lane = rotLane('lane', param, [{ pitch: 36, startBeat: 0 }, { pitch: 72, startBeat: 4 }])
    const obj = resolveObj([lane, gridChild('split', 2, 2)])
    const entry = obj.moverAndSplitterChain.find(item => item.localTransformCount === 1)!
    assert.ok(entry)
    const input = identityVisualCopy()
    input.transform.makeRotationZ(.4).setPosition(3, -4, 2)
    for (const beat of [0, 2, 4, -1, 2, 0]) {
      const [local] = entry.localTransformsAtBeat!(beat)
      const before = local.elements.slice()
      const expected = entry.apply(input, { beat, index: 10, count: 20 })[0].transform
      assert.deepEqual(input.transform.clone().multiply(local).elements, expected.elements)
      assert.deepEqual(local.elements, before)
    }
  }
})

test('a Radial rotation automation lane resolves to correlated compact frame metadata', () => {
  const obj = track({ id: 'obj', instrumentId: 'particle', childIds: ['radial', 'after'] })
  const radial = track({ id: 'radial', type: 'splitter', splitterId: 'radial', parentId: 'obj',
    childIds: ['lane'], inputValues: { copies: 4, radius: 2, tilt: 23 } })
  const lane = { ...rotLane('lane', 'tfRotY', [{ pitch: 60, startBeat: 0 }, { pitch: 84, startBeat: 4 }]), parentId: 'radial' }
  const after = gridChild('after', 3, .5)
  const graph = resolveProject({ tracks: { obj, radial, lane, after }, rootTrackIds: ['obj'], bpm: 120, beatsPerBar: 4 })
  const chain = graph.objects[0].moverAndSplitterChain
  assert.equal(chain.length, 2)
  const entry = chain.find(item => item.framedLocalTransformsAtBeat)!
  assert.ok(entry, 'nested TF rotation retains its count-one contract')
  for (const beat of [0, 2, 4, -1, 2, 0]) {
    const compact = entry.framedLocalTransformsAtBeat!(beat)
    const reference = entry.applyFramed!(identityVisualCopy(), { beat, index: 0, count: 1 })
    assert.equal(compact.frames.length, 4)
    reference.forEach((copy, i) => {
      const actual = compact.frames[i].clone().multiply(compact.internals[i] ?? new Matrix4())
      const expected = copy.visualCopy.transform.clone().multiply(copy.internalTransform ?? new Matrix4())
      actual.elements.forEach((value, j) => assert.ok(Math.abs(value - expected.elements[j]) < 1e-9))
    })
  }
})

test('automated nested Movers preserve count-one proof while parent Radial count MIDI changes', () => {
  for (const motion of [0, 1, 2]) {
    const obj = track({ id: 'obj', instrumentId: 'particle', childIds: ['radial'] })
    const radial = track({ id: 'radial', type: 'splitter', splitterId: 'radial', parentId: 'obj',
      childIds: ['mover'], inputValues: { copies: 4, radius: 2, tilt: 23 },
      blocks: [keyframeBlock([{ pitch: 37, startBeat: 1 }, { pitch: 43, startBeat: 3 }])] })
    const mover = track({ id: 'mover', type: 'mover', moverId: 'mover', parentId: 'radial',
      childIds: ['angle'], inputValues: { motion, mode: 1 } })
    const angle = track({ id: 'angle', type: 'automation', parentId: 'mover', targetParam: 'angleZ',
      blocks: [keyframeBlock([{ pitch: 36, startBeat: 0 }, { pitch: 60, startBeat: 4 }])] })
    const graph = resolveProject({ tracks: { obj, radial, mover, angle }, rootTrackIds: ['obj'], bpm: 120, beatsPerBar: 4 })
    const [entry] = graph.objects[0].moverAndSplitterChain
    assert.ok(entry.framedLocalTransformsAtBeat)
    assert.ok(entry.structuralVariants?.every(variant => variant.framedLocalTransformsAtBeat))
    for (const beat of [0, 2, 4, -1, 2, 0]) {
      const compact = entry.framedLocalTransformsAtBeat!(beat)
      assert.equal(compact.frames.length, beat === 2 ? 2 : beat === 4 ? 8 : 4)
      const reference = entry.applyFramed!(identityVisualCopy(), { beat, index: 0, count: 1 })
      reference.forEach((copy, index) => {
        assert.deepEqual(compact.frames[index].elements, copy.visualCopy.transform.elements)
        assert.equal(!!compact.internals[index], !!copy.internalTransform)
        compact.internals[index]?.elements.forEach((value, i) => {
          assert.ok(Math.abs(value - copy.internalTransform!.elements[i]) < 1e-12,
            'affine metadata differs only by inverse roundoff')
        })
      })
    }
  }
})
