import assert from 'node:assert/strict'
import test from 'node:test'
import type { Block, Track } from '../../types'
import { resolveProject, type ProjectSnapshot } from './resolve'
import { WORD_FORMATION_PITCH, activeFormation } from './wordFormation'

// The wiring between a `wordFormation` child track and the resolved object the
// instrument reads: which lanes reach it, with what settings and onsets, and how
// mute/solo and the lanes' own automation children behave. The geometry itself
// is pinned in wordFormation.test.ts.

function block(startBar: number, beats: number[]): Block {
  return {
    id: crypto.randomUUID(),
    startBar,
    durationBars: 4,
    loop: false,
    notes: beats.map((b) => ({
      id: crypto.randomUUID(),
      pitch: WORD_FORMATION_PITCH,
      startBeat: b,
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

function snapshot(tracks: Track[], rootTrackIds: string[]): ProjectSnapshot {
  return {
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    rootTrackIds,
    beatsPerBar: 4,
    bpm: 120,
  }
}

/** A text track with formation lanes under it. */
function textWithLanes(lanes: Track[]): ProjectSnapshot {
  const text = track({
    id: 'text',
    instrumentId: 'textDisplay',
    childIds: lanes.map((l) => l.id),
  })
  return snapshot([text, ...lanes], ['text'])
}

const laneTrack = (id: string, extra: Partial<Track> = {}) => track({
  id,
  type: 'wordFormation',
  instrumentId: '',
  parentId: 'text',
  ...extra,
})

const resolvedText = (p: ProjectSnapshot) => {
  const obj = resolveProject(p).objects.find((o) => o.trackId === 'text')
  assert.ok(obj, 'the text track resolved')
  return obj
}

test('a formation lane reaches the object with its settings and note onsets', () => {
  const p = textWithLanes([
    laneTrack('a', { inputValues: { columns: 3, rows: 2, radius: 2.5 }, blocks: [block(0, [0, 8])] }),
  ])
  const obj = resolvedText(p)
  assert.equal(obj.wordFormations?.length, 1)
  const lane = obj.wordFormations![0]
  assert.equal(lane.trackId, 'a')
  assert.equal(lane.settings.columns, 3)
  assert.equal(lane.settings.rows, 2)
  assert.equal(lane.settings.radius, 2.5)
  // Unset params fall through to the schema defaults rather than leaving holes.
  assert.equal(lane.settings.spacing, 1.55)
  assert.equal(lane.settings.cycle, 0)
  // Note beats are absolute (block-relative in the document).
  assert.deepEqual(lane.onsets, [0, 8])
})

test('a text track with no formation lanes carries none', () => {
  assert.equal(resolvedText(textWithLanes([])).wordFormations, undefined)
})

test('onsets arrive ascending even when blocks are written out of order', () => {
  // countOnsets walks the list once and stops at the first onset past the beat,
  // so an unsorted stream would silently under-count.
  const p = textWithLanes([
    laneTrack('a', { blocks: [block(2, [1, 0]), block(0, [3, 1])] }),
  ])
  const onsets = resolvedText(p).wordFormations![0].onsets
  assert.deepEqual(onsets, [...onsets].sort((x, y) => x - y))
  assert.deepEqual(onsets, [1, 3, 8, 9])
})

test('several lanes resolve in child order, and the latest note wins the beat', () => {
  const p = textWithLanes([
    laneTrack('a', { inputValues: { columns: 2 }, blocks: [block(0, [0])] }),
    laneTrack('b', { inputValues: { columns: 6 }, blocks: [block(2, [0])] }),
  ])
  const lanes = resolvedText(p).wordFormations!
  assert.deepEqual(lanes.map((l) => l.trackId), ['a', 'b'])
  assert.equal(activeFormation(lanes, 4)?.lane.trackId, 'a')
  assert.equal(activeFormation(lanes, 9)?.lane.trackId, 'b')
})

test('a muted lane drops out; the remaining ones still resolve', () => {
  const p = textWithLanes([
    laneTrack('a', { blocks: [block(0, [0])] }),
    laneTrack('b', { muted: true, blocks: [block(0, [1])] }),
  ])
  assert.deepEqual(resolvedText(p).wordFormations?.map((l) => l.trackId), ['a'])
})

test('soloing a lane silences its siblings', () => {
  const p = textWithLanes([
    laneTrack('a', { blocks: [block(0, [0])] }),
    laneTrack('b', { solo: true, blocks: [block(0, [1])] }),
  ])
  assert.deepEqual(resolvedText(p).wordFormations?.map((l) => l.trackId), ['b'])
})

test('every lane muted leaves the object with no formations at all', () => {
  // Not an empty array: the instrument treats absence as "keep the ordinary
  // layout", and a lane you muted should give exactly that back.
  const p = textWithLanes([laneTrack('a', { muted: true, blocks: [block(0, [0])] })])
  assert.equal(resolvedText(p).wordFormations, undefined)
})

test("a lane's automation child resolves onto the lane, not onto the text track", () => {
  const auto = track({
    id: 'auto',
    type: 'automation',
    instrumentId: '',
    parentId: 'a',
    targetParam: 'radius',
    interpolation: 'linear',
    blocks: [block(0, [0])],
  })
  const lane = laneTrack('a', { childIds: ['auto'], blocks: [block(0, [0])] })
  const text = track({ id: 'text', instrumentId: 'textDisplay', childIds: ['a'] })
  const p = snapshot([text, lane, auto], ['text'])
  const obj = resolvedText(p)
  assert.equal(obj.wordFormations![0].automations.length, 1)
  assert.equal(obj.wordFormations![0].automations[0].param, 'radius')
  // The text track's own lanes are untouched - a formation's automation must not
  // leak onto the instrument's params.
  assert.equal(obj.automations.some((a) => a.param === 'radius'), false)
})

test('editing a formation lane re-resolves its parent object', () => {
  // resolveDeps walks the whole subtree, so a lane edit must invalidate the
  // per-track resolve cache. Without this the panel's knobs would move nothing
  // until some unrelated edit happened to bust the cache.
  const lane = laneTrack('a', { inputValues: { columns: 2 }, blocks: [block(0, [0])] })
  const text = track({ id: 'text', instrumentId: 'textDisplay', childIds: ['a'] })
  const before = resolvedText(snapshot([text, lane], ['text']))
  assert.equal(before.wordFormations![0].settings.columns, 2)
  const edited = { ...lane, inputValues: { columns: 5 } }
  const after = resolvedText(snapshot([text, edited], ['text']))
  assert.equal(after.wordFormations![0].settings.columns, 5)
})
