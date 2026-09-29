import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyDocument } from './types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'
import type { Track } from '../editor/types'

test('Glow rewrite migrates settings and automation in every scene without mutating unrelated tracks', () => {
  const raw = emptyDocument()
  raw.schemaVersion = 20
  const base: Track = {
    id: 'source',
    name: 'Source',
    type: 'base',
    instrumentId: 'cube',
    color: '#fff',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
  }
  for (const scene of Object.values(raw.scenes)) {
    scene.tracks.source = {
      ...base,
      effects: [
        {
          id: 'glow',
          pluginId: 'glow',
          enabled: false,
          settings: { amount: 1.4, size: 0.5, threshold: 0.2 },
        },
      ],
    }
    scene.tracks.unrelated = { ...base, id: 'unrelated' }
    scene.tracks.amount = {
      ...base,
      id: 'amount',
      type: 'automation',
      instrumentId: '',
      targetParam: 'fx:glow:amount',
    }
    scene.tracks.size = {
      ...base,
      id: 'size',
      type: 'automation',
      instrumentId: '',
      targetParam: 'fx:glow:size',
      automationRange: { min: 0.2, max: 0.8, rows: 12 },
    }
  }
  const before = structuredClone(raw),
    doc = upgradeDocument(raw)
  assert.deepEqual(raw, before)
  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  for (const scene of Object.values(doc.scenes)) {
    const e = scene.tracks.source.effects![0]
    assert.equal(e.enabled, false)
    assert.equal(e.id, 'glow')
    assert.equal(e.settings.strength, 1.4)
    assert.equal(e.settings.radius, 27)
    assert.equal(e.settings.coreBrightness, 1)
    assert.equal(e.settings.coreWhite, 0)
    assert.equal(e.settings.threshold, 0.2)
    assert.ok(!('size' in e.settings))
    assert.ok(!('amount' in e.settings))
    assert.equal(scene.tracks.amount.targetParam, 'fx:glow:strength')
    assert.deepEqual(scene.tracks.amount.automationRange, { min: 0, max: 3 })
    assert.equal(scene.tracks.size.targetParam, 'fx:glow:radius')
    assert.equal(scene.tracks.size.automationRange?.rows, 12)
    assert.ok(Math.abs(scene.tracks.size.automationRange!.min! - 9.36) < 1e-10)
    assert.deepEqual(scene.tracks.unrelated, raw.scenes[scene.id].tracks.unrelated)
  }
  assert.deepEqual(upgradeDocument(doc), doc)
})
