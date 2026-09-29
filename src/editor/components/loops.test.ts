import assert from 'node:assert/strict'
import test from 'node:test'
import { VISUAL_LOOPS } from './loops'
import { addVisualLoop } from './useLoopBlockDrag'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { useHistoryStore } from '../store/HistoryStore'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import { resolveProject } from '../core/visual/resolve'
import { getMoverOrSplitterDefinition } from '../core/visualCopies/registry'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { resolveVisualCopies } from '../core/visualCopies/resolveVisualCopies'

const loop = VISUAL_LOOPS[0]

test('the library contains one complete loop; each insertion owns independent IDs and settings', () => {
  assert.equal(VISUAL_LOOPS.length, 1)
  const first = loop.createTracks(3, 3)
  const second = loop.createTracks()
  const ids = (tracks: typeof first) => tracks.flatMap(t => [t.id, ...t.blocks.flatMap(b => [b.id, ...b.notes.map(n => n.id)])])
  assert.equal(new Set([...ids(first), ...ids(second)]).size, ids(first).length + ids(second).length)
  assert.deepEqual(first[0].childIds, first.slice(1).map(t => t.id))
  for (const track of first) {
    if (track !== first[0]) assert.equal(track.parentId, first[0].id)
    const block = track.blocks[0]
    assert.equal(block.startBar, 3)
    assert.equal(block.loopLengthBars, 4)
    assert.ok(block.loop)
    assert.ok(block.notes.every(note => note.startBeat + note.durationBeats <= 12))
    if (track.type !== 'base') {
      const def = getMoverOrSplitterDefinition(track.splitterId ?? track.moverId)!
      const pitches = def.midiRows!(mergeDefinitionSettings(def, track.inputValues), { priorCount: 0 }).map(row => row.pitch)
      assert.ok(block.notes.every(note => pitches.includes(note.pitch)), `${track.name} MIDI must drive real rows`)
    }
  }
  first[0].params!.size = 8
  assert.notEqual(second[0].params!.size, 8)
})

test('the complete chain resolves and both Tunnel and Twist change its copies', () => {
  const tree = loop.createTracks()
  const snapshot = { tracks: Object.fromEntries(tree.map(t => [t.id, t])), rootTrackIds: [tree[0].id], bpm: 120, beatsPerBar: 4, totalBars: 4 }
  const object = resolveProject(snapshot).objects[0]
  const copies = resolveVisualCopies(object.moverAndSplitterChain, 2)
  assert.equal(copies.length, 48)
  assert.ok(copies.every(copy => copy.transform.elements.every(Number.isFinite)))
  const withoutTwist = resolveProject({ ...snapshot, tracks: { ...snapshot.tracks, [tree[2].id]: { ...tree[2], muted: true } } }).objects[0]
  assert.notDeepEqual(copies.map(c => c.transform.elements), resolveVisualCopies(withoutTwist.moverAndSplitterChain, 2).map(c => c.transform.elements))
  assert.notDeepEqual(copies.map(c => c.transform.elements), resolveVisualCopies(object.moverAndSplitterChain, 3).map(c => c.transform.elements))
})

test('adding preserves existing tracks and transport, grows the timeline and undoes together', () => {
  hydrate(emptyDocument())
  const before = useProjectStore.getState()
  const existing = before.tracks
  const beat = useTimeStore.getState().currentBeat
  useHistoryStore.getState().reset()
  addVisualLoop(loop, before.totalBars - 1)
  const after = useProjectStore.getState()
  assert.equal(Object.keys(after.tracks).length, Object.keys(existing).length + 3)
  for (const id of Object.keys(existing)) assert.deepEqual(after.tracks[id], existing[id])
  assert.equal(after.totalBars, before.totalBars + 3)
  assert.equal(useTimeStore.getState().currentBeat, beat)
  useHistoryStore.getState().undo()
  assert.deepEqual(useProjectStore.getState().tracks, existing)
  assert.equal(useProjectStore.getState().totalBars, before.totalBars)
})
