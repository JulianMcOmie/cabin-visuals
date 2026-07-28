import { useProjectStore } from '../store/ProjectStore'
import type { Track } from '../types'
import type { LyricWord, TranscribedWord } from './lyricPlacement'
import type { TemplateDef } from '../../templates'

// The Multi-Style Lyric flow's apply step: one song, two looks, cut between
// them through the whole track. Where the single flow restyles the active
// scene once, this builds:
//
//   scene 1  - style A over the transcribed words (the normal applyTemplate
//              carry-over path; the words are already in this scene)
//   scene 2  - a fresh scene, the SAME words refilled into it, then style B
//              applied on top (carry-over restyles them)
//   main     - a Scene Switcher director holding alternating notes, so the
//              video flips look every few bars for the length of the song
//
// Everything uses the ordinary store actions the editor itself exposes, so the
// result is a plain multi-scene project the user can rearrange: retime the
// switcher notes, restyle either scene from the Templates tab, add scenes.

/** Bars per look before the switcher flips to the other scene. */
const SWITCH_BARS = 4

export function applyMultiStyle(
  styleA: TemplateDef,
  styleB: TemplateDef,
  words: LyricWord[],
  timing?: TranscribedWord[],
): void {
  const store = () => useProjectStore.getState()

  // Scene 1: the setup pipeline already put the words here - style A restyles.
  store().applyTemplate(styleA.document)

  // Scene 2: same words, style B. addLyricTrack targets the ACTIVE scene, and
  // applyTemplate's lyric carry-over needs the words in place BEFORE it runs.
  const scene2 = store().addScene()
  store().setActiveScene(scene2)
  store().addLyricTrack(words, timing)
  store().applyTemplate(styleB.document)

  // Main scene: the switcher. setTrackDirector wants the main scene active and
  // binds every visual scene a pitch row (scene 1 -> 60, scene 2 -> 61).
  const s = store()
  const mainId = s.sceneOrder.find((id) => s.scenes[id]?.isMain)
  const scene1 = s.sceneOrder.find((id) => !s.scenes[id]?.isMain)
  if (!mainId || !scene1) return
  s.setActiveScene(mainId)

  const switcherId = crypto.randomUUID()
  const base: Track = {
    id: switcherId,
    name: 'Scene Switcher',
    type: 'base',
    instrumentId: '',
    color: '#818cf8',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
  }
  store().addTrack(base)
  store().setTrackDirector(switcherId, 'sceneSwitcher', 'Scene Switcher')

  // Alternating held notes across the whole song: style A for SWITCH_BARS
  // bars, then style B, and so on. The switcher shows the most recently
  // started held row, so back-to-back notes give clean cuts on the bar line.
  const { totalBars, beatsPerBar } = store()
  const notes = []
  for (let bar = 0; bar < totalBars; bar += SWITCH_BARS) {
    const durationBars = Math.min(SWITCH_BARS, totalBars - bar)
    notes.push({
      id: crypto.randomUUID(),
      startBeat: bar * beatsPerBar,
      durationBeats: durationBars * beatsPerBar,
      pitch: 60 + ((bar / SWITCH_BARS) % 2),
      velocity: 100,
    })
  }
  store().addBlock(switcherId, {
    id: crypto.randomUUID(),
    startBar: 0,
    durationBars: totalBars,
    loop: false,
    notes,
  })

  // Land the editor on the MAIN scene: directors only composite while Main is
  // selected (a visual scene previews solo), so this is the view where the
  // switcher's cutting is actually visible on play.
  store().setActiveScene(mainId)
}
