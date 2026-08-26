// The creation defaults an automation lane starts with, keyed by its target:
// a COUNT param (NumberParamDef.integer - copies, rows, mirrors...) starts on
// the whole-number row grid with STEPPED interpolation, everything else on the
// full fractional span with the spline. Retargeting resets the range the same
// way, because the old config speaks the old param's units.

import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from './ProjectStore'

const splitter = (id: string): Track => ({
  id,
  name: id,
  type: 'splitter',
  instrumentId: '',
  splitterId: 'radial',
  color: '#fff',
  muted: false,
  solo: false,
  blocks: [],
  childIds: [],
})

const st = () => useProjectStore.getState()
const laneUnder = (parentId: string) => st().tracks[st().tracks[parentId].childIds[0]]

test('a lane on a count param starts on the integer grid with stepped interpolation', () => {
  hydrate(emptyDocument())
  st().addTrack(splitter('s'))
  st().addAutomationTrack('s', 'copies', 'Copies', { integer: true })
  const lane = laneUnder('s')
  assert.equal(lane.interpolation, 'step')
  assert.deepEqual(lane.automationRange, { integer: true })
})

test('a lane on an ordinary param keeps the spline and the full fractional span', () => {
  hydrate(emptyDocument())
  st().addTrack(splitter('s'))
  st().addAutomationTrack('s', 'radius', 'Radius')
  const lane = laneUnder('s')
  assert.equal(lane.interpolation, 'spline')
  assert.equal(lane.automationRange, undefined)
})

test('retargeting resets the range to the new param: integer grid on, fractional off', () => {
  hydrate(emptyDocument())
  st().addTrack(splitter('s'))
  st().addAutomationTrack('s', 'radius', 'Radius')
  const laneId = laneUnder('s').id

  st().setAutomationTarget(laneId, 'copies', 'Copies', true, { integer: true })
  assert.deepEqual(st().tracks[laneId].automationRange, { integer: true })
  // Interpolation is the user's own choice and survives a retarget.
  assert.equal(st().tracks[laneId].interpolation, 'spline')

  st().setAutomationTarget(laneId, 'sweep', 'Sweep', true)
  assert.equal(st().tracks[laneId].automationRange, undefined)
})

test('a drag-remap onto a count param seeds the integer grid too', () => {
  hydrate(emptyDocument())
  st().addTrack(splitter('s'))
  st().addAutomationTrack('s', 'radius', 'Radius')
  const laneId = laneUnder('s').id
  // The lane's current target is not available under the "new" parent, so it
  // falls to the first free option - a count param carrying the flag.
  st().remapAutomationTarget(laneId, [{ key: 'copies', label: 'Copies', integer: true }], true)
  assert.equal(st().tracks[laneId].targetParam, 'copies')
  assert.deepEqual(st().tracks[laneId].automationRange, { integer: true })
})
