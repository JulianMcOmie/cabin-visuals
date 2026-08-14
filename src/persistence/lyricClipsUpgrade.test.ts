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
  assert.equal(t.lyricClips?.length, 1)
  const clip = t.lyricClips![0]
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
  const pitches = doc.scenes.visual.tracks.lyrics.blocks[0].notes.map((n) => n.pitch).sort((a, b) => a - b)
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
  assert.deepEqual(doc.scenes.visual.tracks.lyrics.lyricClips![0].words, ['!FIRST LINE!', '!SECOND ONE!', 'LONE'])
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
  assert.deepEqual(t.lyricClips![0].layout, { kind: 'grid', cols: 3 })
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
  assert.deepEqual(doc.scenes.visual.tracks.lyrics.lyricClips![0].layout, { kind: 'circle' })
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
  assert.equal(t.lyricClips, undefined)
  assert.deepEqual(t.blocks[0].notes.map((n) => n.pitch), [60, 48])
})
