import assert from 'node:assert/strict'
import test from 'node:test'
import type { EffectInstance, Track } from '../../types'
import { createVisualEngine } from './VisualEngine'
import { hasUnbatchableEffects } from './instancedEffects'
import { isDirectParticlePopulation } from './directParticleScene'
import type { ProjectSnapshot } from './resolve'

const effect = (pluginId = 'glow', enabled = false): EffectInstance => ({ id: 'fx', pluginId, enabled, settings: {} })
function fixture(inherited = false): ProjectSnapshot {
  const p: Track = { id: 'p', name: 'Particle', instrumentId: 'particle', type: 'base', color: '#fff',
    childIds: ['grid'], muted: false, solo: false, blocks: [], params: { size: .01, tfX: 2 } }
  const grid: Track = { ...p, id: 'grid', instrumentId: '', type: 'splitter', splitterId: 'grid',
    parentId: 'p', childIds: [], inputValues: { rows: 32, columns: 32, depth: 16, spacing: .2 } }
  const tracks: Record<string, Track> = { p, grid }
  if (inherited) {
    p.parentId = 'group'
    tracks.group = { ...p, id: 'group', instrumentId: '', type: 'group', parentId: undefined,
      childIds: ['p'], params: { tfY: 3 }, effects: [effect()] }
  } else p.effects = [effect()]
  return { tracks, rootTrackIds: [inherited ? 'group' : 'p'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}

function addLane(document: ProjectSnapshot, owner: string, targetParam = 'fx:fx:enabled') {
  const source = document.tracks[owner]
  const lane: Track = { ...source, id: 'enable', type: 'automation', instrumentId: '',
    parentId: owner, childIds: [], effects: undefined, targetParam, muted: true, blocks: [] }
  return { ...document, tracks: { ...document.tracks,
    [owner]: { ...source, childIds: [...source.childIds, lane.id] }, [lane.id]: lane } }
}

test('disabled effects stay pooled; enabling, unknown effects and enable lanes keep the compatibility renderer', () => {
  for (const inherited of [false, true]) {
    const document = fixture(inherited), owner = inherited ? 'group' : 'p'
    assert.equal(hasUnbatchableEffects(document.tracks, 'p'), false)
    for (const pluginId of ['glow', 'scale', 'missing-plugin']) {
      for (const enabled of [false, true]) {
        const changed = { ...document.tracks, [owner]: { ...document.tracks[owner], effects: [effect(pluginId, enabled)] } }
        assert.equal(hasUnbatchableEffects(changed, 'p'), !inherited && pluginId === 'scale' ? false : enabled || pluginId === 'missing-plugin')
      }
    }
    assert.equal(hasUnbatchableEffects(addLane(document, owner).tracks, 'p'), true, 'empty/muted enable lane is still structural')
    assert.equal(hasUnbatchableEffects(addLane(document, owner, 'fx:fx:amount').tracks, 'p'), false)
    assert.equal(hasUnbatchableEffects(addLane(document, owner, 'fx:other:enabled').tracks, 'p'), false)
    if (inherited) assert.equal(hasUnbatchableEffects(addLane(document, 'p').tracks, 'p'), true, 'member enable ids are checked against merged group effects')
  }
  assert.equal(hasUnbatchableEffects(undefined, 'p'), true)
})

test('effect edits switch actual engine plans and mounts while keeping the CPU copy matrices', () => {
  for (const inherited of [false, true]) {
    const document = fixture(inherited), owner = inherited ? 'group' : 'p'
    const engine = createVisualEngine(), reference = createVisualEngine()
    // A Cube uses the original CPU chain evaluator with the identical layouts.
    reference.setProject({ ...document, tracks: { ...document.tracks, p: { ...document.tracks.p, instrumentId: 'cube' } } })
    engine.setProject(document)
    assert.equal(engine.getParticlePlan('p')?.count, 16384)
    assert.equal(engine.getObjectList().length, 1)
    assert.equal(engine.isDirectParticleScene('__legacy_scene__'), true)
    for (const beat of [0, 3, -.5, 0]) {
      engine.computeAtBeat(beat); reference.computeAtBeat(beat)
      for (const index of [0, 1, 1023, 16383]) {
        assert.deepEqual(engine.getVisualCopy('p', index), reference.getVisualCopy('p', index))
      }
    }
    const enabled = { ...document, tracks: { ...document.tracks,
      [owner]: { ...document.tracks[owner], effects: [effect('glow', true)] } } }
    const enabling = addLane(document, owner)
    for (const changed of [enabled, document, enabling, document]) {
      engine.setProject(changed); engine.computeAtBeat(2)
      const pooled = changed === document
      assert.equal(!!engine.getParticlePlan('p'), pooled)
      assert.equal(engine.getObjectList().length, pooled ? 1 : 16384)
      assert.equal(engine.isDirectParticleScene('__legacy_scene__'), pooled)
    }
  }
})

test('direct stream presentation uses the same disabled and inherited effect eligibility', () => {
  const entries = [{ trackId: 'p', sceneId: 's', instrumentId: 'particleStream', maskSourceIds: [] }]
  for (const inherited of [false, true]) {
    const document = fixture(inherited), owner = inherited ? 'group' : 'p'
    const direct = (p: ProjectSnapshot) => isDirectParticlePopulation(entries, () => false, () => 4096, new Set(), {
      s: { id: 's', name: 'S', isMain: false, backgroundColor: '#000', backgroundTransparent: false,
        tracks: p.tracks, rootTrackIds: p.rootTrackIds },
    })
    assert.equal(direct(document), true)
    assert.equal(direct(addLane(document, owner)), false)
  }
})
