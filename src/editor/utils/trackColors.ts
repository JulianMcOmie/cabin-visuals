import { colorToOklch, oklchToHex } from './oklch'

// The audio identity: deep sapphire, enforced at render so every project
// shows the same colour. The waveform is a lighter tint of the same hue.
export const AUDIO_TRACK_COLOR = '#1f4e86'
export const AUDIO_WAVEFORM_COLOR = '#7fc0ee'

// ── Track hue cycle ───────────────────────────────────────────────────────
// A new track's hue is a small step past the previously created track's,
// seeded by the deep-sapphire audio hue, so the timeline drifts slowly
// around the wheel as an analogous family. 24° keeps neighbours clearly
// related but distinguishable, and 15 tracks pass before hues revisit.
// The cycle walks OKLCH, not HSL: fixed perceptual lightness and chroma
// mean every stop on the wheel reads equally bright - no neon/murky swings
// between neighbouring tracks. (The 4a Console spec keeps rainbow clip
// hues; only the NOTES inside clips stay neutral.)
const TRACK_HUE_STEP = 24
const TRACK_CYCLE_CHROMA = 0.2
const TRACK_CYCLE_LIGHTNESS = 0.73
const TRACK_CYCLE_SEED_HUE = colorToOklch(AUDIO_TRACK_COLOR)?.h ?? 258

/** The next colour in the track hue cycle: the previous track's hue rotated
 *  by the step - seeded by deep sapphire for the very first track -
 *  at the family's shared perceptual lightness and chroma. */
export function nextTrackColor(previousColor?: string): string {
  const previousHue = previousColor ? colorToOklch(previousColor)?.h : undefined
  const hue = ((previousHue ?? TRACK_CYCLE_SEED_HUE - TRACK_HUE_STEP) + TRACK_HUE_STEP) % 360
  return oklchToHex(TRACK_CYCLE_LIGHTNESS, TRACK_CYCLE_CHROMA, hue)
}
