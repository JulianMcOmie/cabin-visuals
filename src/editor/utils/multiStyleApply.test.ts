import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from '../store/ProjectStore'
import { getTemplate } from '../../templates'
import { applyMultiStyle } from './multiStyleApply'

// The Multi-Style Lyric apply: two styled scenes over the same words plus a
// Scene Switcher alternating between them for the length of the song.

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

const WORDS = [
  { word: 'real', startBeat: 0, durationBeats: 1 },
  { word: 'words', startBeat: 2, durationBeats: 1 },
]
const TIMING = [
  { word: 'real', start: 0, end: 0.5 },
  { word: 'words', start: 1, end: 1.5 },
]

test('multi-style apply builds two styled scenes and an alternating switcher', () => {
  hydrate(emptyDocument())
  const store = useProjectStore.getState()
  store.addTrack(audio())
  // The setup pipeline lands the words in the active (first visual) scene.
  useProjectStore.getState().addLyricTrack(WORDS, TIMING)

  const wormhole = getTemplate('wormhole')
  const neon = getTemplate('neonPsychedelic')
  assert.ok(wormhole && neon)
  applyMultiStyle(wormhole, neon, WORDS, TIMING)

  const s = useProjectStore.getState()
  const visual = s.sceneOrder.filter((id) => !s.scenes[id]?.isMain)
  const mainId = s.sceneOrder.find((id) => s.scenes[id]?.isMain)
  assert.equal(visual.length, 2, 'two visual scenes')
  assert.ok(mainId)

  // Both scenes carry the SAME transcribed words on a root Lyrics track.
  for (const sceneId of visual) {
    const scene = s.scenes[sceneId]
    const lyricsId = scene.rootTrackIds.find((tid) => scene.tracks[tid]?.name === 'Lyrics')
    assert.ok(lyricsId, `scene ${scene.name} has a Lyrics track`)
    const lyrics = scene.tracks[lyricsId]
    assert.equal(lyrics.instrumentId, 'textDisplay')
    assert.match(lyrics.stringParams?.text ?? '', /real words/)
    assert.equal(lyrics.lyricTiming?.length, TIMING.length)
  }

  // The scenes wear DIFFERENT looks. (Track sets overlap - Neon Psychedelic
  // ships a wormhole-instrument backdrop too - so the discriminator is the
  // Lyrics styling each template stamps: Wormhole sets font 7, Neon font 8.)
  const lyricsFont = (sceneId: string) => {
    const scene = s.scenes[sceneId]
    const id = scene.rootTrackIds.find((tid) => scene.tracks[tid]?.name === 'Lyrics')!
    return scene.tracks[id].params?.font
  }
  assert.equal(lyricsFont(visual[0]), 7, 'scene 1 wears the Wormhole look')
  assert.equal(lyricsFont(visual[1]), 8, 'scene 2 wears the Neon look')

  // Main holds a Scene Switcher bound to both scenes, with alternating held
  // notes covering the whole project.
  const main = s.scenes[mainId]
  const switcher = Object.values(main.tracks).find((t) => t.directorId === 'sceneSwitcher')
  assert.ok(switcher, 'a Scene Switcher director exists on Main')
  const boundScenes = new Set((switcher.sceneBindings ?? []).map((b) => b.sceneId))
  assert.ok(visual.every((id) => boundScenes.has(id)), 'both scenes are bound to rows')
  const notes = switcher.blocks[0]?.notes ?? []
  assert.ok(notes.length >= 2, 'the switcher holds alternating notes')
  const pitches = notes.map((n) => n.pitch)
  assert.ok(pitches.some((p) => p !== pitches[0]), 'the notes alternate between the two rows')
  // Full coverage: back-to-back held notes from bar 0 to the project's end.
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat)
  let cursor = 0
  for (const n of sorted) {
    assert.equal(n.startBeat, cursor, 'notes are back-to-back')
    cursor += n.durationBeats
  }
  assert.equal(cursor, s.totalBars * s.beatsPerBar, 'coverage runs to the project end')

  // The editor lands on Main - the only view where directors composite, so
  // pressing play shows the cutting instead of a solo scene preview.
  assert.equal(s.activeSceneId, mainId)
})
