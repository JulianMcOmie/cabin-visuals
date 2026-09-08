import test from 'node:test'
import assert from 'node:assert/strict'
import { midiBlocksToOpen } from './midiBlockSelection'
import { useUIStore } from '../store/UIStore'
import type { Track } from '../types'

const tracks = Object.fromEntries(['first', 'second', 'audio'].map((id, i) => [id, {
  id, name: id, type: id === 'audio' ? 'audio' : 'base', instrumentId: 'cube', color: '#fff',
  muted: false, solo: false, childIds: [],
  blocks: [{ id: `${id}-a`, startBar: i, durationBars: 2, loop: false, notes: [] },
    { id: `${id}-b`, startBar: i + 4, durationBars: 1, loop: false, notes: [] }],
}])) as Record<string, Track>

test('opening a selected clip preserves distinct MIDI blocks across tracks and excludes audio/stale IDs', () => {
  const clicked = { trackId: 'first', blockId: 'first-b' }
  assert.deepEqual(midiBlocksToOpen(tracks, new Set(['first-a', 'first-b', 'second-a', 'audio-a', 'deleted']), clicked), [
    { trackId: 'first', blockId: 'first-a' }, { trackId: 'second', blockId: 'second-a' }, clicked,
  ])
})
test('opening outside a selection edits only the new clip', () => {
  const clicked = { trackId: 'second', blockId: 'second-b' }
  assert.deepEqual(midiBlocksToOpen(tracks, new Set(['first-a', 'first-b']), clicked), [clicked])
})
test('MIDI focus preserves the opened group, ignores foreign clips, and single-open/close clear it', () => {
  const previous = useUIStore.getState()
  try {
    const a = { trackId: 'first', blockId: 'first-a' }, b = { trackId: 'second', blockId: 'second-b' }
    previous.setEditingBlocks([a, b, a], b)
    const group = useUIStore.getState().editingBlocks
    assert.deepEqual(group, [a, b])
    assert.deepEqual(useUIStore.getState().editingBlock, b)
    previous.focusEditingBlock(a)
    assert.equal(useUIStore.getState().editingBlocks, group)
    previous.focusEditingBlock({ trackId: 'wrong-owner', blockId: a.blockId })
    assert.deepEqual(useUIStore.getState().editingBlock, a)
    previous.setEditingBlock(b)
    assert.deepEqual(useUIStore.getState().editingBlocks, [b])
    previous.setEditingBlock(null)
    assert.equal(useUIStore.getState().editingBlock, null)
    assert.deepEqual(useUIStore.getState().editingBlocks, [])
  } finally { useUIStore.setState(previous) }
})
