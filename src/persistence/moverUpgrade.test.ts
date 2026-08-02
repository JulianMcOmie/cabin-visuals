import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../editor/types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'
import { mergeDefinitionSettings } from '../editor/core/visualCopies/definitions'
import { getMoverOrSplitterDefinition } from '../editor/core/visualCopies/registry'
import { identityVisualCopy } from '../editor/core/visualCopies/identityVisualCopy'
import { constantOrbitMover } from '../editor/core/visualCopies/rotationMovers'
import type { ResolvedNote } from '../editor/core/visual/types'

// v12 → v13: the six single-behavior motion movers collapse onto the unified
// `mover` definition. Shape fidelity here; cell-by-cell behavioural parity of
// the definition itself is pinned in core/visualCopies/mover.test.ts.

const moverTrack = (id: string, moverId: string, inputValues?: Record<string, number>, extra: Partial<Track> = {}): Track => ({
  id, name: id, type: 'mover', instrumentId: '', moverId,
  color: '#6366f1', muted: false, solo: false, blocks: [], childIds: [],
  ...(inputValues ? { inputValues } : {}),
  ...extra,
} as Track)

function v12Doc(tracks: Record<string, Track>, rootTrackIds: string[]) {
  const main: Scene = { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] }
  const visual: Scene = { id: 'visual', name: 'Scene 1', isMain: false, backgroundColor: '#000000', backgroundTransparent: false, tracks, rootTrackIds }
  return {
    schemaVersion: 12,
    bpm: 120, beatsPerBar: 4, totalBars: 8,
    scenes: { main, visual },
    sceneOrder: ['main', 'visual'],
    activeSceneId: 'visual',
    audioTracks: {}, audioRootTrackIds: [], audioClips: {},
  }
}

test('v12 motion movers land on the unified mover with their cell selected', () => {
  const doc = upgradeDocument(v12Doc({
    b: moverTrack('b', 'burst', { distanceX: 2, easing: 3 }),
    rb: moverTrack('rb', 'rotateBurst', { angleZ: 180 }),
    ob: moverTrack('ob', 'orbitBurst', { pivotX: 1.5 }),
    cr: moverTrack('cr', 'constantRotate', { speedX: 120, speed: 1.2, returnBeats: 0.7 }),
    co: moverTrack('co', 'constantOrbit', { speedY: 45, pivotZ: -2 }),
    to: moverTrack('to', 'translationOscillator', { cyclesPerBeat: 1.5, basisXX: 0.8 }),
    // A mover the consolidation does NOT touch.
    vis: moverTrack('vis', 'visibility', { fadeBeats: 0.5 }),
  }, ['b', 'rb', 'ob', 'cr', 'co', 'to', 'vis']))

  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  const tracks = doc.scenes.visual.tracks
  const expect = (id: string, motion: number, mode: number, values: Record<string, number>) => {
    assert.equal(tracks[id].moverId, 'mover', `${id} moverId`)
    assert.deepEqual(tracks[id].inputValues, { motion, mode, ...values }, `${id} inputValues`)
  }
  expect('b', 0, 0, { distanceX: 2, easing: 3 })
  expect('rb', 1, 0, { angleZ: 180 })
  expect('ob', 2, 0, { pivotX: 1.5 })
  // Constant cells rename their per-axis rates onto the angle keys.
  expect('cr', 1, 1, { angleX: 120, angle: 1.2, returnBeats: 0.7 })
  expect('co', 2, 1, { angleY: 45, pivotZ: -2 })
  expect('to', 0, 2, { cyclesPerBeat: 1.5, basisXX: 0.8 })

  assert.equal(tracks.vis.moverId, 'visibility')
  assert.deepEqual(tracks.vis.inputValues, { fadeBeats: 0.5 })
})

test('automation and envelope lanes on a constant mover retarget speed → angle', () => {
  const doc = upgradeDocument(v12Doc({
    cr: moverTrack('cr', 'constantRotate', { speedX: 120 }, { childIds: ['lane', 'env'] }),
    lane: { id: 'lane', name: 'Speed X', type: 'automation', instrumentId: '', parentId: 'cr', targetParam: 'speedX', interpolation: 'linear', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] } as Track,
    env: { id: 'env', name: 'Speed env', type: 'envelope', instrumentId: '', parentId: 'cr', targetParam: 'speed', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] } as Track,
    // A lane on an untouched mover keeps its target.
    vis: moverTrack('vis', 'visibility', undefined, { childIds: ['visLane'] }),
    visLane: { id: 'visLane', name: 'Fade', type: 'automation', instrumentId: '', parentId: 'vis', targetParam: 'fadeBeats', interpolation: 'linear', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] } as Track,
  }, ['cr', 'vis']))

  const tracks = doc.scenes.visual.tracks
  assert.equal(tracks.lane.targetParam, 'angleX')
  assert.equal(tracks.env.targetParam, 'angle')
  assert.equal(tracks.visLane.targetParam, 'fadeBeats')
})

test('an upgraded constant orbit resolves to the exact matrices the retired def produced', () => {
  const stored = { speedX: 150, speedZ: 60, speed: 1.3, returnBeats: 0.5, pivotX: 2, pivotY: -1 }
  const doc = upgradeDocument(v12Doc({ co: moverTrack('co', 'constantOrbit', { ...stored }) }, ['co']))
  const upgraded = doc.scenes.visual.tracks.co

  const notes: ResolvedNote[] = [
    { beat: 0, blockStartBeat: 0, blockEndBeat: 1024, pitch: 62, velocity: 100, durationBeats: 2 },
    { beat: 3, blockStartBeat: 0, blockEndBeat: 1024, pitch: 66, velocity: 1, durationBeats: 1 },
  ]
  const unifiedDef = getMoverOrSplitterDefinition(upgraded.moverId)!
  const unified = unifiedDef.resolve({
    settings: mergeDefinitionSettings(unifiedDef, upgraded.inputValues) as any,
    notes,
  })
  const retired = constantOrbitMover.resolve({
    settings: mergeDefinitionSettings(constantOrbitMover, stored) as any,
    notes,
  })

  for (const beat of [0, 0.7, 1.9, 3.2, 4.5]) {
    const seed = () => {
      const copy = identityVisualCopy()
      copy.transform.setPosition(1, 2, -0.5)
      return copy
    }
    const a = unified.apply(seed(), { beat, index: 0, count: 1 })[0].transform
    const b = retired.apply(seed(), { beat, index: 0, count: 1 })[0].transform
    for (let i = 0; i < 16; i++) {
      assert.ok(Math.abs(a.elements[i] - b.elements[i]) < 1e-9, `beat ${beat} element ${i}`)
    }
  }
})
