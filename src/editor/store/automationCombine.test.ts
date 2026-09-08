import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate, serialize } from '../../persistence/serialize'
import { useProjectStore } from './ProjectStore'

test('duplicate position targets default to sum, retarget freely and persist modes and order', () => {
  hydrate(emptyDocument())
  const st = () => useProjectStore.getState()
  st().addTrack({ id: 'parent', name: 'Parent', type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] })
  st().addAutomationTrack('parent', 'tfX', 'X')
  st().addAutomationTrack('parent', 'tfX', 'X')
  st().addAutomationTrack('parent', 'tfY', 'Y')
  const ids = st().tracks.parent.childIds
  assert.equal(ids.length, 3)
  for (const id of ids) assert.equal(st().tracks[id].automationCombine, 'sum')
  st().setAutomationTarget(ids[2], 'tfX', 'X', true)
  assert.equal(st().tracks[ids[2]].targetParam, 'tfX')
  st().setAutomationCombine(ids[1], 'multiply')
  st().setAutomationCombine(ids[2], 'override')
  hydrate(JSON.parse(JSON.stringify(serialize())))
  assert.deepEqual(st().tracks.parent.childIds, ids)
  assert.deepEqual(ids.map(id => st().tracks[id].automationCombine), ['sum', 'multiply', 'override'])
  const legacy = JSON.parse(JSON.stringify(serialize()))
  for (const scene of Object.values(legacy.scenes) as { tracks: Record<string, { automationCombine?: string }> }[]) {
    for (const t of Object.values(scene.tracks)) delete t.automationCombine
  }
  hydrate(legacy)
  assert.equal(st().tracks[ids[0]].automationCombine, undefined)
})
