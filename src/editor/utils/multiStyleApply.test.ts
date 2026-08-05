import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from '../store/ProjectStore'
import { getTemplate } from '../../templates'
import { applyLyricStyles } from './multiStyleApply'

// The lyric flow's N-style apply: one scene per picked look over the same
// words, plus a Scene Switcher cycling between them for the length of the
// song. One pick stays the classic single-scene restyle.

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

function freshProjectWithWords() {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(audio())
  // The setup pipeline lands the words in the active (first visual) scene.
  useProjectStore.getState().addLyricTrack(WORDS, TIMING)
}

test('three picked looks become three named scenes and a cycling switcher', () => {
  freshProjectWithWords()
  const styles = ['wormhole', 'neonPsychedelic', 'silentFilm'].map((id) => getTemplate(id)!)
  assert.ok(styles.every(Boolean))
  applyLyricStyles(styles, WORDS, TIMING)

  const s = useProjectStore.getState()
  const visual = s.sceneOrder.filter((id) => !s.scenes[id]?.isMain)
  const mainId = s.sceneOrder.find((id) => s.scenes[id]?.isMain)
  assert.equal(visual.length, 3, 'one scene per look')
  assert.ok(mainId)

  // Every scene: the SAME transcribed words, its own template marker, and the
  // style's name on the scene itself.
  visual.forEach((sceneId, i) => {
    const scene = s.scenes[sceneId]
    assert.equal(scene.appliedTemplateId, styles[i].id, `scene ${i} wears its own style`)
    assert.equal(scene.name, styles[i].styleName ?? styles[i].name, `scene ${i} named after its look`)
    const lyricsId = scene.rootTrackIds.find((tid) => scene.tracks[tid]?.name === 'Lyrics')
    assert.ok(lyricsId, `scene ${i} has a Lyrics track`)
    const lyrics = scene.tracks[lyricsId]
    assert.match(lyrics.stringParams?.text ?? '', /real words/)
    assert.equal(lyrics.lyricTiming?.length, TIMING.length)
  })

  // Main holds a Scene Switcher bound to all three scenes, with back-to-back
  // held notes cycling through all three rows to the project's end.
  const main = s.scenes[mainId]
  const switcher = Object.values(main.tracks).find((t) => t.instrumentId === 'sceneSwitcher')
  assert.ok(switcher, 'a Scene Switcher director exists on Main')
  const boundScenes = new Set((switcher.sceneBindings ?? []).map((b) => b.sceneId))
  assert.ok(visual.every((id) => boundScenes.has(id)), 'every scene is bound to a row')
  const notes = [...(switcher.blocks[0]?.notes ?? [])].sort((a, b) => a.startBeat - b.startBeat)
  assert.equal(new Set(notes.map((n) => n.pitch)).size, 3, 'the notes cycle all three rows')
  let cursor = 0
  notes.forEach((n, i) => {
    assert.equal(n.startBeat, cursor, 'notes are back-to-back')
    assert.equal(n.pitch, 60 + (i % 3), 'rows cycle in order')
    cursor += n.durationBeats
  })
  assert.equal(cursor, s.totalBars * s.beatsPerBar, 'coverage runs to the project end')

  // The editor lands on Main - the only view where directors composite.
  assert.equal(s.activeSceneId, mainId)
})

test('one picked look stays a single restyled scene, no switcher', () => {
  freshProjectWithWords()
  const wormhole = getTemplate('wormhole')!
  applyLyricStyles([wormhole], WORDS, TIMING)

  const s = useProjectStore.getState()
  const visual = s.sceneOrder.filter((id) => !s.scenes[id]?.isMain)
  const mainId = s.sceneOrder.find((id) => s.scenes[id]?.isMain)!
  assert.equal(visual.length, 1, 'still one scene')
  assert.equal(s.scenes[visual[0]].appliedTemplateId, 'wormhole')
  assert.equal(s.scenes[visual[0]].name, 'Wormhole')
  const main = s.scenes[mainId]
  assert.ok(
    !Object.values(main.tracks).some((t) => t.instrumentId === 'sceneSwitcher'),
    'no switcher for a single look',
  )
})
