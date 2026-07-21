import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from './ProjectStore'
import { silentFilm } from '../../templates/library-silent-film'
import { getTemplate } from '../../templates'

// applyTemplate's lyric carry-over contract: switching lyric templates keeps
// the project's transcribed words (text, word notes, timing) while adopting
// the incoming template's styling, and trims the template's ceiling-length
// loop blocks to the song's end when audio is present.

const transcribedLyrics = (): Track => ({
  id: 'lyr',
  name: 'Lyrics',
  type: 'base',
  instrumentId: 'textDisplay',
  color: '#fff',
  muted: false,
  solo: false,
  stringParams: { text: 'real transcribed words', color: '#123456' },
  lyricTiming: [{ word: 'real', start: 0, end: 0.5 }],
  blocks: [{
    id: 'lyr-block',
    startBar: 0,
    durationBars: 40,
    loop: false,
    notes: [{ id: 'w1', startBeat: 0, durationBeats: 1, pitch: 48, velocity: 100 }],
  }],
  childIds: [],
})

const audio = (): Track => ({
  id: 'aud',
  name: 'Song',
  type: 'audio',
  instrumentId: '',
  color: '#fff',
  muted: false,
  solo: false,
  blocks: [],
  childIds: [],
  // 80 seconds at 120bpm = 160 beats = 40 bars of song.
  audioBlocks: [{ id: 'ab', clipRef: 'clip', startBar: 0, trimStart: 0, trimEnd: 80 }],
})

function findLyrics(): Track {
  const s = useProjectStore.getState()
  const id = s.rootTrackIds.find((tid) => s.tracks[tid]?.name === 'Lyrics')
  assert.ok(id, 'a Lyrics track exists after applyTemplate')
  return s.tracks[id]
}

test('applying a lyric template carries the transcribed Lyrics content over', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  useProjectStore.getState().addTrack(transcribedLyrics())

  useProjectStore.getState().applyTemplate(silentFilm.document)

  const lyrics = findLyrics()
  // Content is the project's...
  assert.equal(lyrics.stringParams?.text, 'real transcribed words')
  assert.equal(lyrics.lyricTiming?.[0]?.word, 'real')
  assert.equal(lyrics.blocks.length, 1)
  assert.equal(lyrics.blocks[0].notes.length, 1)
  assert.equal(lyrics.blocks[0].notes[0].pitch, 48)
  // ...styling is the template's (Silent Film: IM Fell SC + Scatter + glow).
  assert.equal(lyrics.params?.font, 4)
  assert.equal(lyrics.params?.layoutMode, 1)
  assert.equal(lyrics.stringParams?.color, '#fdfbfe')
})

test('the template ambience trims to the song end when audio is present', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  useProjectStore.getState().addTrack(transcribedLyrics())

  useProjectStore.getState().applyTemplate(silentFilm.document)

  const s = useProjectStore.getState()
  for (const id of s.rootTrackIds) {
    const t = s.tracks[id]
    if (t.type === 'audio' || t.name === 'Lyrics') continue
    for (const b of t.blocks) {
      if (!b.loop) continue
      assert.equal(b.startBar + b.durationBars, 40, `${t.name} loop block ends at the song end`)
    }
  }
})

test('without an existing Lyrics track the template placeholder ships as-is', () => {
  hydrate(emptyDocument())

  useProjectStore.getState().applyTemplate(silentFilm.document)

  const lyrics = findLyrics()
  assert.ok(lyrics.stringParams?.text?.includes('night'), 'placeholder words remain')
  assert.equal(lyrics.lyricTiming, undefined)
  // No audio: the ceiling loop blocks stay untrimmed for a later transcription.
  const s = useProjectStore.getState()
  const filmStock = s.rootTrackIds.map((id) => s.tracks[id]).find((t) => t.name === 'Film Stock')
  assert.ok(filmStock)
  assert.equal(filmStock.blocks[0].durationBars, 512)
})

test('the Lyric Video template participates in the same carry-over', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  useProjectStore.getState().addTrack(transcribedLyrics())

  const lyricVideo = getTemplate('lyricVideo')
  assert.ok(lyricVideo)
  useProjectStore.getState().applyTemplate(lyricVideo.document)

  const lyrics = findLyrics()
  assert.equal(lyrics.stringParams?.text, 'real transcribed words')
  assert.equal(lyrics.lyricTiming?.[0]?.word, 'real')
})
