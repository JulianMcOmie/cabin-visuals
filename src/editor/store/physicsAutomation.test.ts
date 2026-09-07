import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate, serialize } from '../../persistence/serialize'
import { useProjectStore } from './ProjectStore'
import { automationMode, DEFAULT_PHYSICS } from '../core/visual/automation'

test('physics mode switches exclusively, edits and survives save/load', () => {
  hydrate(emptyDocument())
  const st = () => useProjectStore.getState()
  st().addTrack({ id: 'physics-test', name: 'Physics', type: 'automation', instrumentId: '', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] })
  st().setAutomationMode('physics-test', 'noise')
  st().setAutomationMode('physics-test', 'physics')
  assert.equal(automationMode(st().tracks['physics-test']), 'physics')
  assert.equal(st().tracks['physics-test'].noise, undefined)
  assert.deepEqual(st().tracks['physics-test'].physics, DEFAULT_PHYSICS)
  st().setTrackPhysics('physics-test', { velocity: -12, acceleration: 35 })
  hydrate(JSON.parse(JSON.stringify(serialize())))
  assert.deepEqual(st().tracks['physics-test'].physics, { velocity: -12, acceleration: 35 })
  st().setAutomationMode('physics-test', 'curve')
  assert.equal(st().tracks['physics-test'].physics, undefined)
  assert.equal(automationMode(st().tracks['physics-test']), 'curve')
})
