import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from './ProjectStore'

// remapAutomationTarget: the drag-commit fixup for automation lanes landing
// under a new parent. The available-target list is caller-resolved
// (utils/automationTargets.ts); these tests hand it in directly.

const cube = (id: string): Track => ({ id, name: id, type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] })

const lane = (id: string, parentId: string, targetParam: string): Track => ({
  id, name: id, type: 'automation', instrumentId: '', color: '#fff', muted: false, solo: false,
  blocks: [], childIds: [], parentId, targetParam, interpolation: 'linear',
})

const st = () => useProjectStore.getState()

/** Two object parents and a lane on `a` targeting `size`. */
function seed() {
  hydrate(emptyDocument())
  for (const id of ['a', 'b']) st().addTrack(cube(id))
  st().addTrack(lane('l', 'a', 'size'))
  st().setTrackParent('l', 'a')
}

const A_TARGETS = [{ key: 'tfX', label: 'X' }, { key: 'size', label: 'Size' }]
const B_TARGETS = [{ key: 'tfX', label: 'X' }, { key: 'other', label: 'Other' }]

test('a target the new parent lacks falls to the first free option and is remembered', () => {
  seed()
  st().setTrackParent('l', 'b')
  st().remapAutomationTarget('l', B_TARGETS, true)
  assert.equal(st().tracks.l.targetParam, 'tfX')
  assert.equal(st().tracks.l.previousTargetParam, 'size')
  assert.equal(st().tracks.l.name, 'X', 'auto-name follows the forced target')
})

test('moving back restores the remembered target and forgets it', () => {
  seed()
  st().setTrackParent('l', 'b')
  st().remapAutomationTarget('l', B_TARGETS, true)
  st().setTrackParent('l', 'a')
  st().remapAutomationTarget('l', A_TARGETS, true)
  assert.equal(st().tracks.l.targetParam, 'size')
  assert.equal(st().tracks.l.previousTargetParam, undefined)
  assert.equal(st().tracks.l.name, 'Size')
})

test('a target the new parent has is left untouched', () => {
  seed()
  st().setTrackParent('l', 'b')
  const before = st().tracks.l
  st().remapAutomationTarget('l', [{ key: 'size', label: 'Size' }, ...B_TARGETS], true)
  assert.equal(st().tracks.l, before, 'no write at all')
})

test('a param a sibling lane already drives counts as unavailable', () => {
  seed()
  st().addTrack(lane('m', 'b', 'tfX'))
  st().setTrackParent('m', 'b')
  st().setTrackParent('l', 'b')
  st().remapAutomationTarget('l', B_TARGETS, false)
  // tfX is taken by sibling m - the fallback lands on the next free option.
  assert.equal(st().tracks.l.targetParam, 'other')
  assert.equal(st().tracks.l.name, 'l', 'rename=false keeps the custom name')
})

test('a deliberate retarget forgets the remembered target', () => {
  seed()
  st().setTrackParent('l', 'b')
  st().remapAutomationTarget('l', B_TARGETS, true)
  assert.equal(st().tracks.l.previousTargetParam, 'size')
  st().setAutomationTarget('l', 'other', 'Other', false)
  assert.equal(st().tracks.l.targetParam, 'other')
  assert.equal(st().tracks.l.previousTargetParam, undefined)
})

test('the remembered ORIGINAL survives a second hop that also forces a default', () => {
  seed()
  st().setTrackParent('l', 'b')
  st().remapAutomationTarget('l', B_TARGETS, true) // size → tfX, remembers size
  st().addTrack(cube('c'))
  st().setTrackParent('l', 'c')
  // c offers neither size nor tfX: falls to its first option, still remembering size.
  st().remapAutomationTarget('l', [{ key: 'zap', label: 'Zap' }], true)
  assert.equal(st().tracks.l.targetParam, 'zap')
  assert.equal(st().tracks.l.previousTargetParam, 'size')
  // Back home: size restores.
  st().setTrackParent('l', 'a')
  st().remapAutomationTarget('l', A_TARGETS, true)
  assert.equal(st().tracks.l.targetParam, 'size')
  assert.equal(st().tracks.l.previousTargetParam, undefined)
})
