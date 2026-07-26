import { colorToHsl } from './colors'

// The audio identity: deep sapphire, enforced at render so every project
// shows the same colour. The waveform is a lighter tint of the same hue.
export const AUDIO_TRACK_COLOR = '#1f4e86'
export const AUDIO_WAVEFORM_COLOR = '#7fc0ee'

// ── Track hue cycle ───────────────────────────────────────────────────────
// A new track's hue is a small step past the previously created track's,
// seeded by the deep-sapphire audio hue, so the timeline drifts slowly
// around the wheel as an analogous family. 24° keeps neighbours clearly
// related but distinguishable, and 15 tracks pass before hues revisit.
const TRACK_HUE_STEP = 24
const TRACK_CYCLE_SATURATION = 0.85
const TRACK_CYCLE_LIGHTNESS = 0.56
const TRACK_CYCLE_SEED_HUE = colorToHsl(AUDIO_TRACK_COLOR)?.hue ?? 212

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = (((hue % 360) + 360) % 360) / 60
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs((h % 2) - 1))
  const [r, g, b] =
    h < 1 ? [chroma, x, 0]
      : h < 2 ? [x, chroma, 0]
        : h < 3 ? [0, chroma, x]
          : h < 4 ? [0, x, chroma]
            : h < 5 ? [x, 0, chroma]
              : [chroma, 0, x]
  const m = lightness - chroma / 2
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** The next colour in the track hue cycle: the previous track's hue rotated
 *  by the step - seeded by deep sapphire for the very first track -
 *  at the family's shared saturation and lightness. */
export function nextTrackColor(previousColor?: string): string {
  const previousHue = previousColor ? colorToHsl(previousColor)?.hue : undefined
  const hue = ((previousHue ?? TRACK_CYCLE_SEED_HUE - TRACK_HUE_STEP) + TRACK_HUE_STEP) % 360
  return hslToHex(hue, TRACK_CYCLE_SATURATION, TRACK_CYCLE_LIGHTNESS)
}
