import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { computeAtBeat, getObjectState, setProject } from './VisualEngine'
import { paramAtBeat } from './instrumentFrame'

const object: Track = { id: 'combine-object', name: 'Object', type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [], params: { tfX: 3 }, effects: [{ id: 'fx', pluginId: 'sceneGrade', enabled: true, settings: { amount: 3 } }] }
const lane = (id: string, targetParam: string, automationCombine: Track['automationCombine']): Track => ({
  ...object, id, type: 'automation', instrumentId: '', parentId: object.id, params: undefined, effects: undefined,
  targetParam, automationCombine, automationRange: { min: 0, max: 4 },
  blocks: [{ id: `${id}-block`, startBar: 0, durationBars: 2, loop: false, notes: [{ id: `${id}-note`, pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }] }],
})

test('engine, effects and spawn-time sampling fold duplicate targets and respect mute/solo', () => {
  const lanes = [lane('a', 'tfX', 'sum'), lane('b', 'tfX', 'multiply'), lane('fx-a', 'fx:fx:amount', 'sum'), lane('fx-b', 'fx:fx:amount', 'multiply')]
  const load = (children: Track[]) => {
    const parent = { ...object, childIds: children.map(c => c.id) }
    setProject({ tracks: Object.fromEntries([parent, ...children].map(t => [t.id, t])), rootTrackIds: [parent.id], beatsPerBar: 4, bpm: 120, totalBars: 4 })
    computeAtBeat(0)
    return getObjectState(parent.id)!
  }
  let state = load(lanes)
  assert.equal(state.params.tfX, 10)
  assert.equal(state.effectOverrides?.fx.amount, 10)
  assert.equal(paramAtBeat(state, 'tfX', 0), 10)
  computeAtBeat(6)
  computeAtBeat(0)
  assert.equal(getObjectState(object.id)!.params.tfX, 10)
  state = load([lanes[1], lanes[0], lanes[3], lanes[2]])
  assert.equal(state.params.tfX, 8)
  assert.equal(state.effectOverrides?.fx.amount, 8)
  assert.equal(paramAtBeat(state, 'tfX', 0), 8)
  state = load([lanes[0], { ...lanes[1], muted: true }])
  assert.equal(state.params.tfX, 5)
  state = load([lanes[0], { ...lanes[1], solo: true }])
  assert.equal(state.params.tfX, 6)
  state = load([lane('old', 'tfX', undefined)])
  assert.equal(state.params.tfX, 2)
})
