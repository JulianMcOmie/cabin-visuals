import test from 'node:test'
import assert from 'node:assert/strict'
import { isUntouchedScriptNote, noteHash } from './provenance'

test('a note is untouched while its content matches the hash it was written with', () => {
  const h = noteHash(12.5, 60, 0.25, 100)
  assert.equal(h, noteHash(12.50000001, 60, 0.25, 100))
  assert.notEqual(h, noteHash(12.75, 60, 0.25, 100))
  const note = { startBeat: 4.5, durationBeats: 0.25, pitch: 60, velocity: 100, src: { by: 'script:x', h } }
  assert.ok(isUntouchedScriptNote(note, 8))
  assert.ok(!isUntouchedScriptNote({ ...note, pitch: 61 }, 8))
  assert.ok(!isUntouchedScriptNote(note, 12))           // its block moved
  assert.ok(!isUntouchedScriptNote({ ...note, src: undefined }, 8))
})
