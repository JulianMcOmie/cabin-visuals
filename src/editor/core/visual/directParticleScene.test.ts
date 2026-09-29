import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../../types'
import { isDirectParticlePopulation } from './directParticleScene'

const entry = (trackId: string, instrumentId = 'particleStream') => ({ trackId, sceneId: 's', instrumentId, maskSourceIds: [] as string[] })
const entries = [entry('a'), entry('b'), entry('light', 'light')]
function document() {
  const tracks = Object.fromEntries(entries.map(e => [e.trackId, { id: e.trackId, instrumentId: e.instrumentId, type: 'base', effects: [] }])) as unknown as Record<string, Track>
  return { s: { id: 's', name: 'Scene', isMain: false, backgroundColor: '#000000', backgroundTransparent: false, rootTrackIds: entries.map(e => e.trackId), tracks } } satisfies Record<string, Scene>
}
const counts = (id: string): number => id === 'light' ? 1 : 1024

test('shared streams and ordinary lighting use direct presentation across duplicate list entries', () => {
  assert.equal(isDirectParticlePopulation([...entries, ...entries], () => false, counts, new Set(), document()), true)
  assert.equal(isDirectParticlePopulation([entry('light', 'light')], () => false, counts, new Set(), document()), false)
  assert.equal(isDirectParticlePopulation([entry('a', 'particle')], () => true, () => 1048576, new Set()), true)
})

test('private clocks, masks, effects, unknown documents and excessive CPU populations keep compatibility presentation', () => {
  const check = (scenes = document(), copies = counts, staggered = new Set<string>()) => isDirectParticlePopulation(entries, () => false, copies, staggered, scenes)
  assert.equal(check(document(), counts, new Set(['a'])), false)
  assert.equal(check(document(), () => 9000), false)
  const scenes = document()
  scenes.s.tracks.a.effects = [{ id: 'fx', pluginId: 'glow', enabled: true, settings: {} }] as Track['effects']
  assert.equal(check(scenes), false)
  scenes.s.tracks.a.effects = [{ id: 'fx', pluginId: 'scale', enabled: true, settings: {} }] as Track['effects']
  assert.equal(check(scenes), true)
  scenes.s.tracks.a.parentId = 'group'
  scenes.s.tracks.group = { type: 'group', effects: [{ pluginId: 'scale' }] } as Track
  assert.equal(check(scenes), false)
  assert.equal(isDirectParticlePopulation([{ ...entries[0], maskSourceIds: ['mask'] }], () => false, counts, new Set(), document()), false)
  assert.equal(isDirectParticlePopulation([entry('a', 'cube')], () => false, counts, new Set(), document()), false)
  assert.equal(isDirectParticlePopulation(entries, () => false, counts, new Set()), false)
})
