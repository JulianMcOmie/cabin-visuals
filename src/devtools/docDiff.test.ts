import test from 'node:test'
import assert from 'node:assert/strict'
import { diffDocs, formatDiff, isEmptyDiff } from './docDiff'

const doc = (notes: Array<[number, number]>, params: Record<string, number> = {}) => ({
  bpm: 120, beatsPerBar: 4, totalBars: 8, sceneOrder: ['s'],
  scenes: { s: { id: 's', name: 'A', tracks: { t: { id: 't', name: 'Kick', type: 'base', instrumentId: 'x', params, blocks: [{ id: 'b', startBar: 0, durationBars: 8, loop: false, notes: notes.map(([beat, pitch], i) => ({ id: `n${i}${Math.random()}`, startBeat: beat, durationBeats: 0.25, pitch, velocity: 100 })) }] } } } },
}) as never

test('notes compare by content, not id; params and tempo are reported', () => {
  assert.ok(isEmptyDiff(diffDocs(doc([[0, 60], [1, 60]]), doc([[1, 60], [0, 60]]))))
  const d = diffDocs(doc([[0, 60], [1, 60]], { size: 1 }), doc([[0, 60], [2, 62], [3, 62]], { size: 2 }))
  assert.equal(d.tracks.length, 1)
  assert.equal(d.tracks[0].notesAdded.length, 2)
  assert.equal(d.tracks[0].notesRemoved.length, 1)
  assert.deepEqual(d.tracks[0].paramsChanged, ['size'])
  assert.match(formatDiff(d), /~ A\/Kick {2}\+2 notes \(bars 0–0\) · -1 notes .* · params: size/)
})
