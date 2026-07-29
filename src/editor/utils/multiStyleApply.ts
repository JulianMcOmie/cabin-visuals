import { useProjectStore } from '../store/ProjectStore'
import type { Track } from '../types'
import type { LyricWord, TranscribedWord } from './lyricPlacement'
import type { TemplateDef } from '../../templates'

// The lyric flow's apply step, for ANY number of picked looks. One song, one
// set of timed words, N styles:
//
//   one style   - the classic path: restyle the active scene (applyTemplate's
//                 lyric carry-over), nothing else changes
//   N styles    - one scene per style, each named after its look and wearing
//                 it over the SAME words, plus a Scene Switcher director on
//                 Main holding cycling notes, so the video changes look every
//                 few bars for the length of the song
//
// Everything uses the ordinary store actions the editor itself exposes, so the
// result is a plain multi-scene project the user can rearrange: retime the
// switcher notes, restyle any scene from the Templates tab, add scenes.

/** Bars per look before the switcher moves to the next scene. */
const SWITCH_BARS = 4

export function applyLyricStyles(
  styles: TemplateDef[],
  words: LyricWord[],
  timing?: TranscribedWord[],
): void {
  if (styles.length === 0) return
  const store = () => useProjectStore.getState()

  // Scene 1: the setup pipeline already put the words here - the first style
  // restyles it in place.
  store().applyTemplate(styles[0].document)
  {
    const s = store()
    const first = s.sceneOrder.find((id) => !s.scenes[id]?.isMain)
    if (first) s.renameScene(first, styles[0].styleName ?? styles[0].name)
  }
  if (styles.length === 1) return

  // Every further style: a fresh scene, the SAME words refilled into it, the
  // style applied on top (applyTemplate's carry-over needs the words in place
  // BEFORE it runs, and addLyricTrack targets the active scene).
  for (const style of styles.slice(1)) {
    const sceneId = store().addScene()
    store().setActiveScene(sceneId)
    store().addLyricTrack(words, timing)
    store().applyTemplate(style.document)
    store().renameScene(sceneId, style.styleName ?? style.name)
  }

  // Main scene: the switcher. setTrackDirector wants the main scene active and
  // binds every visual scene a pitch row (scene i -> 60 + i, in scene order).
  const s = store()
  const mainId = s.sceneOrder.find((id) => s.scenes[id]?.isMain)
  const visualCount = s.sceneOrder.filter((id) => !s.scenes[id]?.isMain).length
  if (!mainId || visualCount === 0) return
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

  // Cycling held notes across the whole song: look 1 for SWITCH_BARS bars,
  // then look 2, ... wrapping around. The switcher shows the most recently
  // started held row, so back-to-back notes give clean cuts on the bar line.
  const { totalBars, beatsPerBar } = store()
  const notes = []
  for (let bar = 0; bar < totalBars; bar += SWITCH_BARS) {
    const durationBars = Math.min(SWITCH_BARS, totalBars - bar)
    notes.push({
      id: crypto.randomUUID(),
      startBeat: bar * beatsPerBar,
      durationBeats: durationBars * beatsPerBar,
      pitch: 60 + ((bar / SWITCH_BARS) % visualCount),
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

  // Land the editor on MAIN: directors only composite while Main is selected
  // (a visual scene previews solo), so this is the view where the switcher's
  // cutting is actually visible on play.
  store().setActiveScene(mainId)
}
