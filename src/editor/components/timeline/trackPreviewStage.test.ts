import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisualEngine } from '../../core/visual/VisualEngine'
import type { Track } from '../../types'
import { trackPreviewStage } from './trackPreviewStage'

const track = (id: string, values: Partial<Track> = {}): Track => ({
  id, name: id, type: 'base', instrumentId: '', childIds: [], blocks: [], color: '#f00', muted: false, solo: false, ...values,
})
const cube = track('cube', { instrumentId: 'cube', childIds: ['split', 'hue'], params: { size: 1 }, stringParams: { baseColor: '#ff0000' } })
const split = track('split', { type: 'splitter', splitterId: 'line', parentId: 'cube', inputValues: { copies: 3, spacing: 1, size: 0.5 } })
const hue = track('hue', { type: 'mover', moverId: 'hueRotate', parentId: 'cube', inputValues: { rotate: 0.5, mode: 1, spread: 0 } })
const project = { tracks: { cube, split, hue }, rootTrackIds: ['cube'], bpm: 120, beatsPerBar: 4, totalBars: 8 }
const evaluate = (row: string, source = project) => {
  const stage = trackPreviewStage(row, source)
  const engine = createVisualEngine()
  engine.setProject(stage.snapshot)
  engine.computeAtBeat(1)
  return engine
}

test('instrument, splitter and colorizer show successive stages instead of the final result', () => {
  const base = evaluate('cube'), copies = evaluate('split'), color = evaluate('hue')
  assert.equal(base.getVisualCopies('cube').length, 1)
  assert.equal(copies.getVisualCopies('cube').length, 3)
  assert.equal(color.getVisualCopies('cube').length, 3)
  assert.equal(copies.getVisualCopy('cube', 0)?.colorShift.hue, 0)
  assert.equal(color.getVisualCopy('cube', 0)?.colorShift.hue, 0.5)
  assert.equal(base.getVisualCopy('cube', 0)?.colorShift.hue, 0, 'later evaluation never contaminates an earlier evaluator')
})

test('reordering devices changes only the appropriate chain stages', () => {
  const reordered = { ...project, tracks: { ...project.tracks, cube: { ...cube, childIds: ['hue', 'split'] } } }
  assert.equal(evaluate('hue', reordered).getVisualCopies('cube').length, 1)
  assert.equal(evaluate('split', reordered).getVisualCopy('cube', 0)?.colorShift.hue, 0.5)
})

test('later automation cannot leak into earlier stages, even when nested inside a splitter', () => {
  const automation = track('size', { type: 'automation', parentId: 'split', targetParam: 'copies' })
  const source = { ...project, tracks: { ...project.tracks, split: { ...split, childIds: ['size'] }, size: automation } }
  assert.equal(trackPreviewStage('split', source).snapshot.tracks.size, undefined)
  assert.deepEqual([...trackPreviewStage('size', source).targets], ['cube'])
  assert.ok(trackPreviewStage('size', source).snapshot.tracks.size)
})

test('foreign instruments and their note edits are excluded from an instrument preview', () => {
  const foreign = track('foreign', { instrumentId: 'cube' })
  const source = { ...project, tracks: { ...project.tracks, foreign }, rootTrackIds: ['foreign', 'cube'] }
  assert.deepEqual(Object.keys(trackPreviewStage('cube', source).snapshot.tracks), ['cube'])
})

test('preview evaluation leaves the main evaluator unchanged and keeps pause deterministic', () => {
  const main = createVisualEngine()
  main.setProject(project); main.computeAtBeat(3)
  const before = main.getVisualCopies('cube')
  const stage = evaluate('split')
  stage.computeAtBeat(7)
  assert.equal(main.getObjectState('cube')?.beat, 3)
  assert.equal(main.getVisualCopies('cube'), before)
  const transforms = stage.getVisualCopies('cube').map(copy => [...copy.transform.elements])
  stage.computeAtBeat(7)
  assert.deepEqual(stage.getVisualCopies('cube').map(copy => [...copy.transform.elements]), transforms)
})
