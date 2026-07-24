import assert from 'node:assert/strict'
import test from 'node:test'
import { notePreviewPitchPositions } from './notePreviewLayout'

const notes = (...pitches: number[]) => pitches.map((pitch) => ({ pitch }))

test('semantic MIDI previews follow declared row order instead of raw pitch', () => {
  const positions = notePreviewPitchPositions(
    notes(60, 61, 62, 63, 64),
    [62, 63, 60, 61, 64],
  )
  assert.ok(positions.get(62)! < positions.get(63)!)
  assert.ok(positions.get(63)! < positions.get(60)!)
  assert.ok(positions.get(60)! < positions.get(61)!)
  assert.ok(positions.get(61)! < positions.get(64)!)
})

test('notes from other octaves sit below semantic rows like the MIDI editor', () => {
  const positions = notePreviewPitchPositions(notes(62, 86, 38), [62, 60])
  assert.ok(positions.get(62)! < positions.get(60)!)
  assert.ok(positions.get(60)! < positions.get(86)!)
  assert.ok(positions.get(86)! < positions.get(38)!)
})

test('strict vocabularies omit unmapped pitches', () => {
  const positions = notePreviewPitchPositions(notes(62, 99), [62, 60], true)
  assert.equal(positions.has(99), false)
})

test('plain piano-roll previews continue to put higher pitches on top', () => {
  const positions = notePreviewPitchPositions(notes(48, 60, 72))
  assert.ok(positions.get(72)! < positions.get(60)!)
  assert.ok(positions.get(60)! < positions.get(48)!)
})
