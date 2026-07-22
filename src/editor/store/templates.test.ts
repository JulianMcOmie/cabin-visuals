import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from './ProjectStore'
import { silentFilm } from '../../templates/library-silent-film'
import { getTemplate, GALLERY_TEMPLATES, LYRIC_STYLES } from '../../templates'

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

test('the Wormhole style ships a tunnel looping to the song end, not the ceiling', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  useProjectStore.getState().addTrack(transcribedLyrics())

  const wormholeStyle = getTemplate('wormhole')
  assert.ok(wormholeStyle)
  useProjectStore.getState().applyTemplate(wormholeStyle.document)

  const s = useProjectStore.getState()
  const tunnel = s.rootTrackIds.map((id) => s.tracks[id]).find((t) => t.instrumentId === 'wormhole')
  assert.ok(tunnel, 'the style ships a Wormhole track')
  const [b] = tunnel.blocks
  assert.equal(b.loop, true)
  assert.equal(b.loopLengthBars, 1, 'a one-bar pulse window')
  assert.equal(b.startBar + b.durationBars, 40, 'trimmed to the song end, not 512')
  // Four on the floor alternating the top of the pulse ladder with the middle.
  assert.deepEqual(b.notes.map((n) => n.pitch), [67, 64, 67, 64])
})

test('shortening the audio pulls looping visuals back with it', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  useProjectStore.getState().addTrack(transcribedLyrics())
  useProjectStore.getState().applyTemplate(silentFilm.document)

  // A track added BY HAND after the template was applied: the two older trim
  // sites (transcribe, apply) have both already fired, so nothing else would
  // ever cut this back.
  useProjectStore.getState().addTrack({
    id: 'manual', name: 'Hand Added', type: 'base', instrumentId: 'wormhole',
    color: '#fff', muted: false, solo: false, childIds: [],
    blocks: [{ id: 'mb', startBar: 0, durationBars: 512, loop: true, loopLengthBars: 1, notes: [] }],
  })

  // Trim the song down to 20 bars (40s at 120bpm).
  useProjectStore.getState().updateAudioBlock('aud', 'ab', { trimEnd: 40 })

  const s = useProjectStore.getState()
  const manual = s.tracks['manual']
  assert.equal(manual.blocks[0].durationBars, 40, 'the hand-added loop follows the lyrics end')

  // One-way: pushing the audio back out does NOT regrow it.
  useProjectStore.getState().updateAudioBlock('aud', 'ab', { trimEnd: 80 })
  assert.equal(useProjectStore.getState().tracks['manual'].blocks[0].durationBars, 40)
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

test('the lyric styles are exactly the looks the setup flow offers', () => {
  assert.deepEqual(LYRIC_STYLES.map((s) => s.id), ['lyricVideo', 'darkRed', 'silentFilm', 'wormhole'])
  for (const style of LYRIC_STYLES) {
    assert.ok(style.styleName, `${style.id} needs a style name for the picker`)
    // Every style must ship the contract the carry-over and refill depend on.
    const scene = Object.values(style.document.scenes).find((s) => !s.isMain)
    assert.ok(scene)
    const lyrics = scene.rootTrackIds
      .map((id) => scene.tracks[id])
      .find((t) => t.instrumentId === 'textDisplay' && t.name === 'Lyrics')
    assert.ok(lyrics, `${style.id} must ship a root track named 'Lyrics'`)
  }
})

test('the gallery advertises one lyric entry, not every style', () => {
  const lyricIds = GALLERY_TEMPLATES.filter((t) => t.lyricFlow).map((t) => t.id)
  assert.deepEqual(lyricIds, ['lyricVideo'])
  // The styles stay reachable, just not from the "start from a template" grid.
  assert.equal(GALLERY_TEMPLATES.some((t) => t.id === 'silentFilm'), false)
  assert.equal(GALLERY_TEMPLATES.some((t) => t.id === 'darkRed'), false)
})

test('the bare Lyric Video template really is bare', () => {
  const lyricVideo = getTemplate('lyricVideo')
  assert.ok(lyricVideo)
  const scene = Object.values(lyricVideo.document.scenes).find((s) => !s.isMain)
  assert.ok(scene)
  assert.deepEqual(Object.values(scene.tracks).map((t) => t.name), ['Lyrics'])
  assert.equal(scene.tracks[scene.rootTrackIds[0]].stringParams?.color, '#ffffff')
})

test('switching between lyric styles keeps the words and swaps the look', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  useProjectStore.getState().addTrack(transcribedLyrics())

  // Silent Film, then change your mind and go to Dark Red.
  useProjectStore.getState().applyTemplate(silentFilm.document)
  assert.equal(findLyrics().params?.font, 4)

  const darkRed = getTemplate('darkRed')
  assert.ok(darkRed)
  useProjectStore.getState().applyTemplate(darkRed.document)

  const lyrics = findLyrics()
  assert.equal(lyrics.stringParams?.text, 'real transcribed words')
  assert.equal(lyrics.lyricTiming?.[0]?.word, 'real')
  assert.equal(lyrics.params?.font, 2) // Dark Red's mono face, not Silent Film's
  // Silent Film's film layers must not linger under the new style.
  const s = useProjectStore.getState()
  const names = s.rootTrackIds.map((id) => s.tracks[id].name)
  assert.equal(names.includes('Film Stock'), false)
  assert.equal(names.includes('Scribbles'), false)
})
