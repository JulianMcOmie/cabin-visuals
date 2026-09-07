import test from 'node:test'
import assert from 'node:assert/strict'
import { midiBlockLanes, midiBlockPreviewNotes, type MidiBlockView } from './multiBlock'
const view = (id: string, start: number, duration: number): MidiBlockView => ({
  name: id, trackId: 'track', color: '#fa0',
  block: { id, startBar: start, durationBars: duration, loop: false, notes: [] },
})
test('overlapping blocks get separate selectable headers, adjacent and gapped blocks reuse lanes', () => {
  const source = [view('later', 4, 1), view('overlap', 1, 2), view('first', 0, 2), view('adjacent', 2, 2)]
  assert.deepEqual(midiBlockLanes(source).map(({ block, lane }) => [block.id, lane]), [
    ['first', 0], ['overlap', 1], ['adjacent', 0], ['later', 0],
  ])
  assert.equal(source[0].block.id, 'later')
})
test('loop context is tiled from its own pattern and retains note identity without mutating source notes', () => {
  const source = view('loop', 8, 2).block
  source.loop = true
  source.loopLengthBars = 1
  source.notes = [{ id: 'hit', pitch: 60, startBeat: 1, durationBeats: 1, velocity: 80 }]
  const notes = midiBlockPreviewNotes(source, 4)
  assert.deepEqual(notes.map(n => [n.id, n.startBeat, n.repeat]), [['hit', 1, 0], ['hit', 5, 1]])
  assert.equal(source.notes[0].startBeat, 1)
  assert.notEqual(notes[0], source.notes[0])
})
