import { defaultSceneGradient, sceneBackdropMode, type Scene } from '../../types'
import { midiNoteHueColor } from '../../utils/midiEditorPalette'
import { colorToOklch, type Oklch } from '../../utils/oklch'

// A scene-bound MIDI row's color comes from the scene it switches to: the row
// wears its scene's BACKDROP HUE, re-voiced at the note palette's fixed
// lightness and chroma. So the piano roll reads like the frames it produces -
// the row you write a note in is the color the screen turns - instead of an
// arbitrary hue cycle that has to be learned per project.
//
// Only the hue carries over. Lightness and chroma are the editor's (a black
// room and a pale sky room would otherwise come out invisible and washed out
// respectively, and notes have to stay readable on the dark grid).

/** Below this OKLCH chroma a backdrop is black/white/grey - it has no hue to
 *  lend, so the row keeps its fallback color. Same guard, same reason, as
 *  `utils/trackDisplayColor.ts`'s achromatic instrument identities. */
const ACHROMATIC_CHROMA = 0.02

/** The two stops averaged in OKLab, which is a chroma-WEIGHTED hue average:
 *  black and white pull chroma down without dragging the hue around, so a
 *  navy→black backdrop still reads navy, and a backdrop fading between two
 *  real hues lands between them. */
function blendStops(from: Oklch, to: Oklch): Oklch {
  const rad = Math.PI / 180
  const a = (from.c * Math.cos(from.h * rad) + to.c * Math.cos(to.h * rad)) / 2
  const b = (from.c * Math.sin(from.h * rad) + to.c * Math.sin(to.h * rad)) / 2
  return {
    l: (from.l + to.l) / 2,
    c: Math.hypot(a, b),
    h: ((Math.atan2(b, a) / rad) + 360) % 360,
  }
}

/** The scene backdrop's color, as the one OKLCH a row can be voiced from.
 *  Null when the backdrop can't lend a hue: transparency has no color at all,
 *  and an unparseable one says nothing. */
function backdropOklch(scene: Scene): Oklch | null {
  const mode = sceneBackdropMode(scene)
  if (mode === 'transparent') return null
  if (mode === 'gradient') {
    const gradient = scene.backgroundGradient ?? defaultSceneGradient()
    const from = colorToOklch(gradient.from)
    const to = colorToOklch(gradient.to)
    if (!from || !to) return from ?? to
    const blended = blendStops(from, to)
    // Complementary stops (red→cyan) cancel to grey in the average, which
    // says nothing about a backdrop that is anything but colorless - so the
    // more saturated stop speaks for the pair.
    if (blended.c > ACHROMATIC_CHROMA) return blended
    return from.c >= to.c ? from : to
  }
  return colorToOklch(scene.backgroundColor)
}

/**
 * The MIDI row color for a row bound to `scene`: the scene's backdrop hue in
 * the note voice, or `fallback` when that backdrop has no hue to give
 * (transparent, or a black/white/grey room). The fallback keeps rows telling
 * each other apart in a project whose scenes are still on the default black.
 */
export function sceneRowColor(scene: Scene | undefined, fallback: string): string {
  const backdrop = scene && backdropOklch(scene)
  if (!backdrop || backdrop.c <= ACHROMATIC_CHROMA) return fallback
  return midiNoteHueColor(backdrop.h)
}
