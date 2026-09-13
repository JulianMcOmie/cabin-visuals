import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import { compileParticlePlan, particlePlanMatrix } from '../visualCopies/particlePlan'
import { resolveVisualCopies, structuralCopyCount } from '../visualCopies/resolveVisualCopies'
import { resolveProject, type ProjectSnapshot } from './resolve'

function fixture(motion: number, count = 4): ProjectSnapshot {
  const particle: Track = { id: 'p', name: 'Particle', instrumentId: 'particle', type: 'base',
    color: '#fff', childIds: ['a', 'm', 'b'], muted: false, solo: false, blocks: [], params: { size: .01 } }
  const a: Track = { ...particle, id: 'a', type: 'splitter', splitterId: 'radial', parentId: 'p',
    childIds: [], inputValues: { copies: count, radius: 2, tilt: 37 } }
  const b: Track = { ...a, id: 'b', inputValues: { copies: count, radius: .3, tilt: 13 }, blocks: [{
    id: 'counts', startBar: 0, durationBars: 8, loop: false, notes: [
      { id: 'few', pitch: 37, velocity: 100, startBeat: 1, durationBeats: .25 },
      { id: 'many', pitch: 36 + count - 1, velocity: 100, startBeat: 3, durationBeats: .25 },
    ],
  }] }
  const mover: Track = { ...particle, id: 'm', type: 'mover', moverId: 'mover', parentId: 'p',
    childIds: ['angle'], inputValues: { motion, mode: 1, angleX: 13, angleY: 21, angleZ: 37,
      pivotX: 1.2, pivotY: -.8, pivotZ: .4 } }
  const angle: Track = { ...mover, id: 'angle', type: 'automation', parentId: 'm', childIds: [],
    targetParam: 'angleZ', blocks: [{ id: 'angles', startBar: 0, durationBars: 8, loop: false, notes: [
      { id: 'low', pitch: 36, velocity: 100, startBeat: 0, durationBeats: .25 },
      { id: 'high', pitch: 60, velocity: 100, startBeat: 4, durationBeats: .25 },
    ] }] }
  return { tracks: { p: particle, a, b, m: mover, angle }, rootTrackIds: ['p'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}

test('automated Mover matrices and splitter count lanes retain exact compact metadata', () => {
  for (const motion of [0, 1, 2]) {
    const chain = resolveProject(fixture(motion)).objects[0].moverAndSplitterChain
    const seen = new Map<number, Float64Array>()
    for (const beat of [0, 2, 4, -.5, 2, 0]) {
      const plan = compileParticlePlan(chain, 0, beat)!
      assert.ok(plan, `motion ${motion} at ${beat} retains its contract`)
      const copies = resolveVisualCopies(chain, beat, new Matrix4().makeRotationX(.3).setPosition(2, 3, 4))
      assert.equal(plan.count, copies.length)
      copies.forEach((copy, index) => {
        const actual = particlePlanMatrix(plan, index, new Matrix4())
        actual.elements.forEach((value, i) => assert.ok(Math.abs(value - copy.transform.elements[i]) < 1e-9))
      })
      if (seen.has(beat)) assert.deepEqual(plan.matrices, seen.get(beat))
      seen.set(beat, plan.matrices)
    }
    assert.equal(structuralCopyCount(chain), 16)
  }
})

test('structural probes with automated root motion never expand the splitter product', () => {
  const p = fixture(2, 32)
  p.tracks.p.childIds = ['a', 'm', 'b', 'c', 'd']
  p.tracks.c = { ...p.tracks.a, id: 'c' }
  p.tracks.d = { ...p.tracks.a, id: 'd' }
  const chain = resolveProject(p).objects[0].moverAndSplitterChain
  for (const entry of chain) {
    entry.apply = () => { throw new Error('expanded structural probe') }
    for (const variant of entry.structuralVariants ?? []) variant.apply = entry.apply
  }
  assert.equal(structuralCopyCount(chain), 1048576)
  assert.equal(compileParticlePlan(chain, 0, 4)!.matrices.length, (4 * 32 + 1) * 16)
})

test('a nested Mover frame keeps the reference fallback after automation resolution', () => {
  const p = fixture(2)
  p.tracks.frame = { ...p.tracks.m, id: 'frame', parentId: 'm', childIds: [] }
  p.tracks.m.childIds.push('frame')
  const chain = resolveProject(p).objects[0].moverAndSplitterChain
  assert.equal(compileParticlePlan(chain), undefined)
})
