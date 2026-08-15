import assert from 'node:assert/strict'
import test from 'node:test'
import type { Scene, Track } from '../editor/types'
import { CURRENT_VERSION, upgradeDocument } from './upgrade'

// v14 → v15: the Text Display clips redesign. Words move off the `text` param
// onto one whole-song lyric clip; pitch-48 word notes revoice to 58 (PLAIN
// lane); the 60-72 height band drops; old font/color seed the PLAIN lane;
// wordFormation children convert to a clip layout and disappear.

const note = (pitch: number, startBeat: number) =>
  ({ id: `${pitch}@${startBeat}`, startBeat, durationBeats: 0.5, pitch, velocity: 100 })

function v14Doc(tracks: Record<string, unknown>, rootTrackIds: string[]) {
  const main: Scene = { id: 'main', name: 'Main', isMain: true, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] }
  const visual = { id: 'visual', name: 'Scene 1', isMain: false, backgroundColor: '#000000', backgroundTransparent: false, tracks, rootTrackIds }
  return {
    schemaVersion: 14,
    bpm: 120, beatsPerBar: 4, totalBars: 8,
    scenes: { main, visual },
    sceneOrder: ['main', 'visual'],
    activeSceneId: 'visual',
    audioTracks: {}, audioRootTrackIds: [], audioClips: {},
  }
}

/** The phrases a migrated track carries. Since v16 a clip is a note at pitch
 *  61 inside a block, so the assertions read them back out of the notes. */
const clipsOf = (t: { blocks: { startBar: number; notes: { pitch: number; startBeat: number; durationBeats: number; lyric?: { words: string[]; layout: { kind: string; cols?: number } } }[] }[] }) =>
  t.blocks.flatMap((b) => b.notes
    .filter((n) => n.pitch === 61)
    .map((n) => ({
      startBeat: b.startBar * 4 + n.startBeat,
      durationBeats: n.durationBeats,
      words: n.lyric?.words ?? [],
      layout: n.lyric?.layout ?? { kind: 'one' },
    })))
    .sort((a, b) => a.startBeat - b.startBeat)

const textTrack = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'lyrics', name: 'Lyrics', type: 'base', instrumentId: 'textDisplay',
  color: '#ffffff', muted: false, solo: false, childIds: [],
  params: { font: 6, layoutMode: 2, phraseGap: 2, stackMaxWords: 4, fontSize: 1.2 },
  stringParams: { text: "WHO YOU !ONE PHRASE! FOO|LIN", color: '#ff00aa' },
  blocks: [{
    id: 'b1', startBar: 0, durationBars: 4, loop: false,
    notes: [note(48, 0), note(48, 1), note(47, 1.5), note(46, 2), note(66, 0), note(72, 3)],
  }],
  ...over,
})

test('text param becomes one whole-song clip; grammar tokens survive intact', () => {
  const doc = upgradeDocument(v14Doc({ lyrics: textTrack() }, ['lyrics']))
  assert.equal(doc.schemaVersion, CURRENT_VERSION)
  const t = doc.scenes.visual.tracks.lyrics
  assert.equal(clipsOf(t).length, 1)
  const clip = clipsOf(t)[0]
  assert.equal(clip.startBeat, 0)
  assert.deepEqual(clip.words, ['WHO', 'YOU', '!ONE PHRASE!', 'FOO|LIN'])
  // Stack layout param carried onto the clip.
  assert.equal(clip.layout.kind, 'stack')
  assert.equal(t.stringParams?.text, undefined)
  assert.equal(t.params?.layoutMode, undefined)
  assert.equal(t.params?.font, undefined)
  assert.equal(t.params?.fontSize, 1.2) // untouched params stay
})

test('notes revoice: 48→58, height band dropped, punctuation kept', () => {
  const doc = upgradeDocument(v14Doc({ lyrics: textTrack() }, ['lyrics']))
  const pitches = doc.scenes.visual.tracks.lyrics.blocks[0].notes
    .map((n) => n.pitch).filter((p) => p !== 61).sort((a, b) => a - b)
  assert.deepEqual(pitches, [46, 47, 58, 58])
})

test('PLAIN lane inherits the authored font and color', () => {
  const doc = upgradeDocument(v14Doc({ lyrics: textTrack() }, ['lyrics']))
  const lanes = doc.scenes.visual.tracks.lyrics.styleLanes!
  assert.equal(lanes.length, 5)
  assert.equal(lanes[2].name, 'PLAIN')
  assert.equal(lanes[2].font, 6)
  assert.equal(lanes[2].color, '#ff00aa')
})

test('line mode: each line becomes one grouped token', () => {
  const doc = upgradeDocument(v14Doc({
    lyrics: textTrack({
      params: { advanceUnit: 1 },
      stringParams: { text: 'FIRST LINE\nSECOND ONE\nLONE' },
    }),
  }, ['lyrics']))
  assert.deepEqual(clipsOf(doc.scenes.visual.tracks.lyrics)[0].words, ['!FIRST LINE!', '!SECOND ONE!', 'LONE'])
})

test('wordFormation children convert to the clip layout and are dropped', () => {
  const formation = {
    id: 'wf', name: 'Formation A', type: 'wordFormation', instrumentId: '',
    color: '#e0a33c', muted: false, solo: false, blocks: [], childIds: [], parentId: 'lyrics',
    inputValues: { columns: 3, rows: 2 },
  }
  const doc = upgradeDocument(v14Doc({
    lyrics: textTrack({ childIds: ['wf'] }),
    wf: formation,
  }, ['lyrics']))
  const t = doc.scenes.visual.tracks.lyrics
  assert.deepEqual(clipsOf(t)[0].layout, { kind: 'grid', cols: 3 })
  assert.equal(t.childIds.length, 0)
  assert.equal(doc.scenes.visual.tracks.wf, undefined)
})

test('a ring formation converts to the circle layout', () => {
  const formation = {
    id: 'wf', name: 'Formation A', type: 'wordFormation', instrumentId: '',
    color: '#e0a33c', muted: false, solo: false, blocks: [], childIds: [], parentId: 'lyrics',
    inputValues: { columns: 6, columnsRing: 1, rows: 1 },
  }
  const doc = upgradeDocument(v14Doc({
    lyrics: textTrack({ childIds: ['wf'] }),
    wf: formation,
  }, ['lyrics']))
  assert.deepEqual(clipsOf(doc.scenes.visual.tracks.lyrics)[0].layout, { kind: 'circle' })
})

test('non-text tracks pass through untouched', () => {
  const cube: Track = {
    id: 'c', name: 'Cube', type: 'base', instrumentId: 'cube',
    color: '#6366f1', muted: false, solo: false, childIds: [],
    params: { finish: 1 },
    blocks: [{ id: 'b', startBar: 0, durationBars: 1, loop: false, notes: [note(60, 0), note(48, 1)] }],
  } as Track
  const doc = upgradeDocument(v14Doc({ c: cube }, ['c']))
  const t = doc.scenes.visual.tracks.c
  assert.equal(clipsOf(t).length, 0)
  assert.deepEqual(t.blocks[0].notes.map((n) => n.pitch), [60, 48])
})

// ── v15 → v16: clips become notes ────────────────────────────────────────────

function v15Doc(tracks: Record<string, unknown>, rootTrackIds: string[]) {
  return { ...v14Doc(tracks, rootTrackIds), schemaVersion: 15 }
}

const v15TextTrack = (clips: unknown[], blocks: unknown[]) => ({
  id: 'lyrics', name: 'Lyrics', type: 'base', instrumentId: 'textDisplay',
  color: '#ffffff', muted: false, solo: false, childIds: [],
  params: {}, stringParams: {},
  lyricClips: clips,
  blocks,
})

test('v16: a clip becomes a note in the block that contains it, timing intact', () => {
  const doc = upgradeDocument(v15Doc({
    lyrics: v15TextTrack(
      [{ id: 'c1', startBeat: 6, durationBeats: 4, words: ['A', 'B'], layout: { kind: 'grid', cols: 3 } }],
      [{ id: 'b1', startBar: 1, durationBars: 4, loop: false, notes: [note(58, 2)] }],
    ),
  }, ['lyrics']))
  const t = doc.scenes.visual.tracks.lyrics
  assert.equal((t as unknown as { lyricClips?: unknown }).lyricClips, undefined, 'the track field is gone')
  const clips = clipsOf(t)
  assert.equal(clips.length, 1)
  // Block starts at bar 1 = beat 4, so the phrase stores 2 and still reads 6.
  assert.equal(t.blocks[0].notes.find((n) => n.pitch === 61)!.startBeat, 2)
  assert.equal(clips[0].startBeat, 6)
  assert.equal(clips[0].durationBeats, 4)
  assert.deepEqual(clips[0].words, ['A', 'B'])
  assert.deepEqual(clips[0].layout, { kind: 'grid', cols: 3 })
  // The word notes are untouched.
  assert.equal(t.blocks[0].notes.filter((n) => n.pitch === 58).length, 1)
})

test('v16: a phrase outside every block keeps its timing and overflows', () => {
  // The chosen migration rule: never move a phrase to make it fit. It lands in
  // the nearest block and simply reaches past it - which is why the flattener
  // refuses to cull or truncate a clip note.
  const doc = upgradeDocument(v15Doc({
    lyrics: v15TextTrack(
      [{ id: 'far', startBeat: 40, durationBeats: 8, words: ['LATE'], layout: { kind: 'one' } }],
      [{ id: 'b1', startBar: 0, durationBars: 2, loop: false, notes: [] }],
    ),
  }, ['lyrics']))
  const t = doc.scenes.visual.tracks.lyrics
  assert.equal(t.blocks.length, 1, 'the block was not grown')
  assert.equal(t.blocks[0].durationBars, 2)
  assert.equal(clipsOf(t)[0].startBeat, 40, 'timing preserved exactly')
})

test('v16: a text track with no block at all gets one covering its phrases', () => {
  const doc = upgradeDocument(v15Doc({
    lyrics: v15TextTrack(
      [{ id: 'c1', startBeat: 0, durationBeats: 10, words: ['X'], layout: { kind: 'one' } }],
      [],
    ),
  }, ['lyrics']))
  const t = doc.scenes.visual.tracks.lyrics
  assert.equal(t.blocks.length, 1, 'a note needs a block to live in')
  assert.equal(t.blocks[0].startBar, 0)
  assert.equal(clipsOf(t)[0].startBeat, 0)
  assert.deepEqual(clipsOf(t)[0].words, ['X'])
})

test('v16: several phrases distribute into the blocks that contain them', () => {
  const doc = upgradeDocument(v15Doc({
    lyrics: v15TextTrack(
      [
        { id: 'c1', startBeat: 1, durationBeats: 2, words: ['ONE'], layout: { kind: 'one' } },
        { id: 'c2', startBeat: 17, durationBeats: 2, words: ['TWO'], layout: { kind: 'one' } },
      ],
      [
        { id: 'b1', startBar: 0, durationBars: 2, loop: false, notes: [] },
        { id: 'b2', startBar: 4, durationBars: 2, loop: false, notes: [] },
      ],
    ),
  }, ['lyrics']))
  const t = doc.scenes.visual.tracks.lyrics
  assert.equal(t.blocks[0].notes.length, 1)
  assert.equal(t.blocks[1].notes.length, 1)
  assert.equal(t.blocks[1].notes[0].startBeat, 1, 'block 2 starts at beat 16')
  assert.deepEqual(clipsOf(t).map((c) => c.startBeat), [1, 17])
})

test('v16: a track that never had clips is left alone', () => {
  const doc = upgradeDocument(v15Doc({
    cube: { id: 'cube', name: 'Cube', type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, childIds: [], blocks: [{ id: 'b', startBar: 0, durationBars: 1, loop: false, notes: [note(60, 0)] }] },
  }, ['cube']))
  const t = doc.scenes.visual.tracks.cube
  assert.equal(t.blocks[0].notes.length, 1)
  assert.equal(t.blocks[0].notes[0].pitch, 60)
})
