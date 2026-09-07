import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from './types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'
import { mergeDefinitionSettings } from '../editor/core/visualCopies/definitions'
import { symmetricRotationMover } from '../editor/core/visualCopies/symmetricRotation'

test('v20 preserves implicit rotation defaults and explicit edits in every scene without mutating the save', () => {
  const raw = emptyDocument()
  raw.schemaVersion = 19
  const [main, visual] = Object.values(raw.scenes)
  const base = { id: 'sr', name: 'Rotation', type: 'mover' as const, instrumentId: '', moverId: 'symmetricRotation', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] }
  main.tracks.sr = { ...base }
  visual.tracks.sr = { ...base, inputValues: { axis: 2, fold: 73, falloff: 0, angle: 2 } }
  const before = structuredClone(raw)
  const doc = upgradeDocument(raw)
  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  assert.deepEqual(doc.scenes[main.id].tracks.sr.inputValues, { axis: 1, falloff: 1, anchor: 0, twist: 45, fold: 0 })
  assert.deepEqual(doc.scenes[visual.id].tracks.sr.inputValues, { axis: 2, falloff: 0, anchor: 0, twist: 45, fold: 73, angle: 2 })
  assert.deepEqual(raw, before)
  assert.deepEqual(upgradeDocument(doc), doc)
  const loaded = mergeDefinitionSettings(symmetricRotationMover, doc.scenes[main.id].tracks.sr.inputValues)
  assert.equal(loaded.fold, 0)
  assert.equal(loaded.twist, 45)
})

test('new saves retain the new implicit bow defaults after loading', () => {
  const raw = emptyDocument()
  const doc = upgradeDocument(raw)
  assert.deepEqual(doc, raw)
  const settings = mergeDefinitionSettings(symmetricRotationMover, undefined)
  assert.equal(settings.fold, 45)
  assert.equal(settings.axis, 2)
})
