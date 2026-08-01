import assert from 'node:assert/strict'
import test from 'node:test'
import type { Block, Track } from '../../types'
import { resolveProject, type ProjectSnapshot } from './resolve'

// Per-track resolve reuse: resolveProject may keep a track's resolved entry
// when neither the track, its subtree, nor the tempo changed (identity
// compares - the store updates immutably). These tests pin the reuse rules:
// what must keep identity across resolves, and what must invalidate.

function block(notes: { pitch: number; startBeat: number }[]): Block {
  return {
    id: crypto.randomUUID(),
    startBar: 0,
    durationBars: 4,
    loop: false,
    notes: notes.map((n) => ({
      id: crypto.randomUUID(),
      pitch: n.pitch,
      startBeat: n.startBeat,
      durationBeats: 0.5,
      velocity: 100,
    })),
  }
}

function track(partial: Partial<Track> & { id: string }): Track {
  return {
    name: partial.id,
    type: 'base',
    instrumentId: '',
    color: '#fff',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    ...partial,
  }
}

function snapshot(tracks: Track[], rootTrackIds: string[], beatsPerBar = 4): ProjectSnapshot {
  return {
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    rootTrackIds,
    beatsPerBar,
    bpm: 120,
  }
}

const findObj = (p: ProjectSnapshot, id: string) => {
  const obj = resolveProject(p).objects.find((o) => o.trackId === id)
  assert.ok(obj, `object ${id} resolved`)
  return obj
}

test('an unchanged track reuses its resolution but never its emitted wrapper', () => {
  const a = track({ id: 'a', instrumentId: 'cube', blocks: [block([{ pitch: 60, startBeat: 0 }])] })
  const p = snapshot([a], ['a'])
  const first = findObj(p, 'a')
  const second = findObj(p, 'a')
  // The expensive inner resolution is shared by identity...
  assert.equal(first.notes, second.notes)
  assert.equal(first.automations, second.automations)
  // ...but each resolve owns its chain array (global movers append into it)
  // and its scratch state.
  assert.notEqual(first, second)
  assert.notEqual(first.moverAndSplitterChain, second.moverAndSplitterChain)
  assert.notEqual(first.scratchBase, second.scratchBase)
})

test('editing one track re-resolves it and only it', () => {
  const a = track({ id: 'a', instrumentId: 'cube', blocks: [block([{ pitch: 60, startBeat: 0 }])] })
  const b = track({ id: 'b', instrumentId: 'cube', blocks: [block([{ pitch: 64, startBeat: 1 }])] })
  const before = resolveProject(snapshot([a, b], ['a', 'b']))
  // Immutable-store edit: track `a` is replaced, `b` keeps its reference.
  const a2 = { ...a, blocks: [block([{ pitch: 62, startBeat: 2 }])] }
  const after = resolveProject(snapshot([a2, b], ['a', 'b']))
  const notesOf = (g: ReturnType<typeof resolveProject>, id: string) =>
    g.objects.find((o) => o.trackId === id)!.notes
  assert.notEqual(notesOf(before, 'a'), notesOf(after, 'a'))
  assert.equal(notesOf(after, 'a')[0].pitch, 62)
  assert.equal(notesOf(before, 'b'), notesOf(after, 'b'))
})

test('replacing a child lane re-resolves the parent object', () => {
  const lane = track({ id: 'lane', type: 'automation', parentId: 'a', targetParam: 'size', blocks: [block([{ pitch: 60, startBeat: 0 }])] })
  const a = track({ id: 'a', instrumentId: 'cube', childIds: ['lane'] })
  const before = findObj(snapshot([a, lane], ['a']), 'a')
  // The child's ref changes; the parent's does not (childIds holds ids).
  const lane2 = { ...lane, blocks: [block([{ pitch: 72, startBeat: 1 }])] }
  const after = findObj(snapshot([a, lane2], ['a']), 'a')
  assert.notEqual(before.automations, after.automations)
})

test('a solo elsewhere mutes a reused entry via its emitted wrapper', () => {
  const a = track({ id: 'a', instrumentId: 'cube' })
  const b = track({ id: 'b', instrumentId: 'cube' })
  assert.equal(findObj(snapshot([a, b], ['a', 'b']), 'a').muted, false)
  // Solo `b` (only its ref changes): the reused `a` must now come out muted.
  const b2 = { ...b, solo: true }
  const after = findObj(snapshot([a, b2], ['a', 'b']), 'a')
  assert.equal(after.muted, true)
})

test('a tempo change invalidates every reused resolution', () => {
  const a = track({ id: 'a', instrumentId: 'cube', blocks: [block([{ pitch: 60, startBeat: 0 }])] })
  const p4 = snapshot([a], ['a'], 4)
  const p3 = snapshot([a], ['a'], 3)
  const at4 = findObj(p4, 'a')
  const at3 = findObj(p3, 'a')
  assert.notEqual(at4.notes, at3.notes)
})

test('an unchanged global mover keeps one shared instance across resolves', () => {
  const a = track({ id: 'a', instrumentId: 'cube', tags: ['t'] })
  const mover = track({
    id: 'm',
    type: 'mover',
    moverId: 'visibility',
    targets: [{ port: 'mover', scope: { kind: 'tag', tag: 't' }, amount: 1 }],
  })
  const p = snapshot([a, mover], ['a', 'm'])
  const first = findObj(p, 'a')
  const second = findObj(p, 'a')
  assert.equal(first.moverAndSplitterChain.length, 1)
  assert.equal(first.moverAndSplitterChain[0], second.moverAndSplitterChain[0])
})
