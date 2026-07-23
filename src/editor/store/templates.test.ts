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

  // The placement lanes are CHILDREN of Lyrics, and applyTemplate remints every
  // id including parentId/childIds - so this is really asserting that the
  // re-parenting survived the clone, not just that the lanes exist.
  const lyrics = s.rootTrackIds.map((id) => s.tracks[id]).find((t) => t.name === 'Lyrics')
  assert.ok(lyrics)
  const lanes = lyrics.childIds.map((id) => s.tracks[id])
  assert.equal(lanes.length, 3, 'all three lanes came across')
  for (const lane of lanes) {
    assert.equal(lane.type, 'automation')
    assert.equal(lane.parentId, lyrics.id, 'lane re-parented to the cloned Lyrics track')
    // Step, not linear: ramping would slide a fading word across the frame -
    // and now resize it mid-fade too - which is the whole thing per-word
    // latching exists to avoid.
    assert.equal(lane.interpolation, 'step')
  }
  assert.deepEqual(lanes.map((l) => l.targetParam).sort(), ['fontSize', 'posX', 'posY'])
  // The Font Size lane is pointless unless Size latches per word: Live mode would
  // resize every word on screen together on each step, instead of each word
  // keeping the size it was born at.
  assert.equal(lyrics.params?.sizeMode, 1, 'Size latches per word')
  // NO offset effect. It used to lift the words off centre; the reference dropped
  // it and the placement lanes do the positioning. Asserted rather than deleted
  // so re-adding an offset has to be a deliberate act.
  assert.equal(lyrics.effects?.length ?? 0, 0, 'positioning is the lanes, not an offset effect')
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
  assert.deepEqual(LYRIC_STYLES.map((s) => s.id), ['lyricVideo', 'darkRed', 'silentFilm', 'wormhole', 'neonPsychedelic', 'monochrome'])
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

test('the Neon Psychedelic style ships its lanes, its latching and its kaleidoscope', () => {
  const style = getTemplate('neonPsychedelic')
  assert.ok(style)
  const scene = Object.values(style.document.scenes).find((s) => !s.isMain)
  assert.ok(scene)
  const roots = scene.rootTrackIds.map((id) => scene.tracks[id])

  const lyrics = roots.find((t) => t.name === 'Lyrics')
  assert.ok(lyrics)
  // Both latches on: without them the lanes below would move and resize every
  // word on screen at once instead of per word.
  assert.equal(lyrics.params?.sizeMode, 1, 'Size latches per word')
  assert.equal(lyrics.params?.flightEnabled, 0, 'words hold still - the tunnel moves')
  assert.equal(lyrics.params?.rainbowEnabled, 0, 'one fixed green, not a hue cycle')
  assert.equal(lyrics.stringParams?.color, '#54e316')

  const lanes = lyrics.childIds.map((id) => scene.tracks[id])
  assert.deepEqual(
    lanes.map((l) => l.targetParam).sort(),
    ['fontSize', 'posX', 'posY'],
    'all three automation lanes came across',
  )
  for (const lane of lanes) assert.equal(lane.interpolation, 'step', `${lane.name} steps, never ramps`)

  const tunnel = roots.find((t) => t.instrumentId === 'wormhole')
  assert.ok(tunnel)
  // The pairing that IS the look - near-dark walls at the speed ceiling.
  assert.equal(tunnel.params?.speed, 200)
  assert.equal(tunnel.params?.brightness, 0.1)

  const radial = tunnel.childIds.map((id) => scene.tracks[id]).find((t) => t.type === 'splitter')
  assert.ok(radial, 'the kaleidoscope is a child of the tunnel')
  assert.equal(radial.splitterId, 'radial')
  assert.equal(radial.inputValues?.copies, 13)
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

test('a particle-words style gets a dash lead-in when the song starts late', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  const late = transcribedLyrics()
  late.blocks[0].notes = [{ id: 'w1', startBeat: 13, durationBeats: 1, pitch: 48, velocity: 100 }]
  useProjectStore.getState().addTrack(late)

  const wormholeStyle = getTemplate('wormhole')
  assert.ok(wormholeStyle)
  useProjectStore.getState().applyTemplate(wormholeStyle.document)

  // The cloud opens as a dash and streams into the first sung word.
  let lyrics = findLyrics()
  assert.equal(lyrics.stringParams?.text, '- real transcribed words')
  let wordNotes = lyrics.blocks[0].notes.filter((n) => n.pitch === 48)
  assert.equal(wordNotes.length, 2)
  assert.equal(Math.min(...wordNotes.map((n) => n.startBeat)), 0)

  // Idempotent: a re-apply sees the beat-0 note it added and does not stack.
  useProjectStore.getState().applyTemplate(wormholeStyle.document)
  lyrics = findLyrics()
  assert.equal(lyrics.stringParams?.text, '- real transcribed words')
  wordNotes = lyrics.blocks[0].notes.filter((n) => n.pitch === 48)
  assert.equal(wordNotes.length, 2)
})

test('no dash lead-in when a word already opens the song, nor for plane-text styles', () => {
  // First sung word already at beat 0: nothing to bridge.
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  useProjectStore.getState().addTrack(transcribedLyrics())
  const wormholeStyle = getTemplate('wormhole')
  assert.ok(wormholeStyle)
  useProjectStore.getState().applyTemplate(wormholeStyle.document)
  assert.equal(findLyrics().stringParams?.text, 'real transcribed words')

  // Plane-text style with a late start: the dash is particle-words-only - a
  // dash hanging on screen at t=0 is noise when words render as glyphs.
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  const late = transcribedLyrics()
  late.blocks[0].notes = [{ id: 'w1', startBeat: 13, durationBeats: 1, pitch: 48, velocity: 100 }]
  useProjectStore.getState().addTrack(late)
  useProjectStore.getState().applyTemplate(silentFilm.document)
  assert.equal(findLyrics().stringParams?.text, 'real transcribed words')
})

test('the Monochrome invert strobe follows the carried words, not a free clock', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  // Two sung phrases with a long instrumental gap between them.
  const lyrics = transcribedLyrics()
  lyrics.blocks[0].notes = [
    { id: 'w1', startBeat: 0, durationBeats: 1, pitch: 48, velocity: 100 },
    { id: 'w2', startBeat: 1.2, durationBeats: 1, pitch: 48, velocity: 100 },
    { id: 'w3', startBeat: 20, durationBeats: 1, pitch: 48, velocity: 100 },
    { id: 'w4', startBeat: 21.4, durationBeats: 1, pitch: 48, velocity: 100 },
  ]
  useProjectStore.getState().addTrack(lyrics)

  const mono = getTemplate('monochrome')
  assert.ok(mono)
  useProjectStore.getState().applyTemplate(mono.document)

  const s = useProjectStore.getState()
  const strobe = s.rootTrackIds.map((id) => s.tracks[id])
    .find((t) => t.instrumentId === 'colorFilters' && t.name === 'Invert Strobe')
  assert.ok(strobe, 'the style ships an Invert Strobe track')
  const notes = strobe.blocks[0].notes
  assert.ok(notes.length > 0, 'the strobe was rebuilt from the words')
  assert.ok(notes.every((n) => n.pitch === 72), 'strobe notes sit on the Invert row')
  // Every strobe span lives inside a sung phrase - nothing strobes in the
  // instrumental gap (beats ~2.2 through 20).
  for (const n of notes) {
    const end = n.startBeat + n.durationBeats
    const inFirst = n.startBeat >= 0 && end <= 2.3
    const inSecond = n.startBeat >= 20 && end <= 22.5
    assert.ok(inFirst || inSecond, `strobe span ${n.startBeat}-${end} stays inside a sung phrase`)
  }
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
