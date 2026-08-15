import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STYLE_PITCH_TOP,
  laneIndexForPitch,
  styleLanePitch,
  defaultStyleLanes,
  resolveStyleLanes,
  parseTextEntries,
  resolveLyricWords,
  clipSlotOffset,
  sortedClips,
  clipsFromNotes,
  trackLyricClips,
  isLyricClipNote,
  PITCH_LYRIC_CLIP,
  MAX_STYLE_LANES,
} from './lyricClips'
import type { LyricClip } from '../../types'

const clip = (id: string, startBeat: number, durationBeats: number, words: string[], layout: LyricClip['layout'] = { kind: 'one' }): LyricClip =>
  ({ id, startBeat, durationBeats, words, layout })

test('lane pitch mapping is a frozen involution around STYLE_PITCH_TOP', () => {
  for (let i = 0; i < 8; i++) assert.equal(laneIndexForPitch(styleLanePitch(i), 8), i)
  assert.equal(STYLE_PITCH_TOP, 60) // stored in projects - never renumber
  assert.equal(laneIndexForPitch(60, 5), 0)
  assert.equal(laneIndexForPitch(56, 5), 4)
  assert.equal(laneIndexForPitch(55, 5), -1) // below the band
  assert.equal(laneIndexForPitch(61, 5), -1) // above the band
  assert.equal(laneIndexForPitch(47, 8), -1) // pop row never reads as a lane
})

test('default lanes: five, PLAIN at index 2 (the legacy migration target)', () => {
  const lanes = defaultStyleLanes()
  assert.equal(lanes.length, 5)
  assert.equal(lanes[2].name, 'PLAIN')
  assert.equal(lanes[2].size, 1)
})

test('resolveStyleLanes defaults absent, clamps stored', () => {
  assert.equal(resolveStyleLanes(undefined).length, 5)
  assert.equal(resolveStyleLanes([]).length, 5)
  const lanes = resolveStyleLanes([{ name: '', font: -2, color: '', size: 99 }])
  assert.equal(lanes.length, 1)
  assert.equal(lanes[0].name, 'LANE 1')
  assert.equal(lanes[0].font, 0)
  assert.equal(lanes[0].color, '#ffffff')
  assert.equal(lanes[0].size, 4)
})

test('parseTextEntries keeps the classic grammar', () => {
  assert.deepEqual(parseTextEntries('WHO YOU').map((e) => e.text), ['WHO', 'YOU'])
  assert.deepEqual(parseTextEntries('!ONE PHRASE! NEXT').map((e) => e.text), ['ONE PHRASE', 'NEXT'])
  const syl = parseTextEntries('FOO|LIN')
  assert.deepEqual(syl.map((e) => e.text), ['FOO', 'LIN'])
  assert.equal(syl[0].layoutText, 'FOOLIN')
  assert.equal(syl[1].syllableStart, 3)
})

test('notes bind to the clip containing their beat, consuming words in order', () => {
  const clips = [clip('a', 0, 4, ['WHO', 'YOU']), clip('b', 4, 4, ['NOBODY', 'KNOWS'])]
  const res = resolveLyricWords(
    [{ beat: 0, pitch: 60 }, { beat: 1, pitch: 58 }, { beat: 4, pitch: 58 }, { beat: 5.5, pitch: 57 }],
    clips, 5,
  )
  assert.deepEqual(res.map((r) => r.entry?.text), ['WHO', 'YOU', 'NOBODY', 'KNOWS'])
  assert.deepEqual(res.map((r) => r.laneIndex), [0, 2, 2, 3])
  assert.deepEqual(res.map((r) => r.clipIndex), [0, 0, 1, 1])
  assert.deepEqual(res.map((r) => r.slotIndex), [0, 1, 0, 1])
})

test('a clip that runs out starves later notes instead of cycling', () => {
  const res = resolveLyricWords(
    [{ beat: 0, pitch: 58 }, { beat: 1, pitch: 58 }],
    [clip('a', 0, 4, ['ONLY'])], 5,
  )
  assert.equal(res[0].entry?.text, 'ONLY')
  assert.equal(res[1].entry, null)
  assert.equal(res[1].slotIndex, -1)
  assert.equal(res[1].clipIndex, 0)
})

test('a note outside every clip is an orphan; pasting notes cannot re-index', () => {
  const clips = [clip('a', 0, 2, ['A', 'B']), clip('b', 4, 2, ['C'])]
  const base = resolveLyricWords(
    [{ beat: 0, pitch: 58 }, { beat: 1, pitch: 58 }, { beat: 4, pitch: 58 }],
    clips, 5,
  )
  assert.deepEqual(base.map((r) => r.entry?.text), ['A', 'B', 'C'])
  // Paste two notes into the GAP (beats 2-4): they orphan, and every
  // pre-existing note keeps its word - the requirement the redesign exists for.
  const pasted = resolveLyricWords(
    [
      { beat: 0, pitch: 58 }, { beat: 1, pitch: 58 },
      { beat: 2.5, pitch: 58 }, { beat: 3, pitch: 58 },
      { beat: 4, pitch: 58 },
    ],
    clips, 5,
  )
  assert.deepEqual(pasted.map((r) => r.entry?.text ?? null), ['A', 'B', null, null, 'C'])
})

test('overlapping clips: the later-starting clip wins the beat', () => {
  const clips = [clip('a', 0, 8, ['LONG']), clip('b', 2, 2, ['INNER'])]
  const res = resolveLyricWords([{ beat: 2.5, pitch: 58 }], clips, 5)
  assert.equal(res[0].entry?.text, 'INNER')
  assert.equal(res[0].clipIndex, sortedClips(clips).findIndex((c) => c.id === 'b'))
})

test('syllable words cost one note per syllable within their clip', () => {
  const res = resolveLyricWords(
    [{ beat: 0, pitch: 58 }, { beat: 0.5, pitch: 58 }, { beat: 1, pitch: 58 }],
    [clip('a', 0, 4, ['|FOO|LIN|', 'NEXT'])], 5,
  )
  assert.deepEqual(res.map((r) => r.entry?.text), ['FOO', 'LIN', 'NEXT'])
  assert.equal(res[0].totalSlots, 3)
})

test('grid seats fill row-major, centered; circle starts at the top', () => {
  const grid = { kind: 'grid' as const, cols: 2 }
  assert.deepEqual(clipSlotOffset(grid, 0, 4), { x: -0.5, y: 0.5, z: 0 })
  assert.deepEqual(clipSlotOffset(grid, 3, 4), { x: 0.5, y: -0.5, z: 0 })
  const top = clipSlotOffset({ kind: 'circle' }, 0, 4)!
  assert.ok(Math.abs(top.x) < 1e-9 && Math.abs(top.y - 1) < 1e-9)
  const right = clipSlotOffset({ kind: 'circle' }, 1, 4)!
  assert.ok(Math.abs(right.x - 1) < 1e-9 && Math.abs(right.y) < 1e-9)
  assert.equal(clipSlotOffset({ kind: 'stack' }, 0, 4), null)
  assert.equal(clipSlotOffset({ kind: 'one' }, 0, 1), null)
})


// ── Clips as notes (schema v16) ──────────────────────────────────────────────

const clipNote = (id: string, startBeat: number, durationBeats: number, words: string[]) =>
  ({ id, pitch: PITCH_LYRIC_CLIP, startBeat, durationBeats, velocity: 100,
     lyric: { words, layout: { kind: 'one' as const } } })

test('the clip pitch sits outside every style lane, so a clip never sings', () => {
  // The whole no-special-casing story rests on this: word notes are selected by
  // laneIndexForPitch, and it must reject the clip row at the maximum lane count.
  assert.equal(PITCH_LYRIC_CLIP, STYLE_PITCH_TOP + 1)
  assert.equal(laneIndexForPitch(PITCH_LYRIC_CLIP, MAX_STYLE_LANES), -1)
  assert.ok(isLyricClipNote({ pitch: PITCH_LYRIC_CLIP }))
  assert.ok(!isLyricClipNote({ pitch: STYLE_PITCH_TOP }))
})

test('clipsFromNotes reads only clip notes, and defaults a bare one to empty', () => {
  const notes = [
    { id: 'w1', pitch: 58, startBeat: 0, durationBeats: 1, velocity: 100 },
    clipNote('c1', 0, 4, ['HELLO', 'THERE']),
    { id: 'c2', pitch: PITCH_LYRIC_CLIP, startBeat: 8, durationBeats: 2, velocity: 100 },
  ]
  const clips = clipsFromNotes(notes)
  assert.deepEqual(clips.map((c) => c.id), ['c1', 'c2'])
  assert.deepEqual(clips[0].words, ['HELLO', 'THERE'])
  // A clip note drawn on the grid carries no payload yet - it must read as an
  // empty phrase rather than throwing or vanishing.
  assert.deepEqual(clips[1].words, [])
  assert.deepEqual(clips[1].layout, { kind: 'one' })
})

test('trackLyricClips lifts block-relative clips into absolute beats, sorted', () => {
  const clips = trackLyricClips([
    { startBar: 4, notes: [clipNote('late', 2, 4, ['B'])] },
    { startBar: 0, notes: [clipNote('early', 1, 4, ['A'])] },
  ], 4)
  assert.deepEqual(clips.map((c) => c.id), ['early', 'late'])
  assert.equal(clips[0].startBeat, 1)   // bar 0 + 1
  assert.equal(clips[1].startBeat, 18)  // bar 4 (=16 beats) + 2
})

test('a resolved (absolute-beat) note stream feeds the same reader', () => {
  // The engine hands over ResolvedNotes, which carry `beat` rather than
  // `startBeat`; both shapes must land on the same clip.
  const clips = clipsFromNotes([
    { id: 'c1', pitch: PITCH_LYRIC_CLIP, beat: 12, durationBeats: 4,
      lyric: { words: ['X'], layout: { kind: 'one' } } },
  ])
  assert.equal(clips[0].startBeat, 12)
  assert.deepEqual(clips[0].words, ['X'])
})

test('words bind to clips derived from notes exactly as before', () => {
  // End to end: the clips a note stream declares drive resolveLyricWords with
  // no change to the binding rules.
  const clips = trackLyricClips([{ startBar: 0, notes: [
    clipNote('c1', 0, 4, ['ONE', 'TWO']),
    clipNote('c2', 4, 4, ['THREE']),
  ] }], 4)
  const res = resolveLyricWords(
    [{ beat: 0, pitch: 58 }, { beat: 1, pitch: 58 }, { beat: 4, pitch: 58 }, { beat: 5, pitch: 58 }],
    clips, 5,
  )
  assert.deepEqual(res.map((r) => r.entry?.text ?? null), ['ONE', 'TWO', 'THREE', null])
})
