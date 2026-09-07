import { colorToOklch, oklchCss, oklchToHex } from './oklch'

export interface MidiBlockPalette {
  /** Resting pane: near-black, faintly tinted toward the track hue. */
  fill: string
  /** The resting pane's inset hairline edge - the only line a block draws. */
  edge: string
  /** Resting note dash: the piano roll's neon voice (bright AND charged). */
  note: string
  /** The glow each resting note dash casts. */
  noteGlow: string
  /** Loop-repeat dashes dim by lightness, staying unlit. */
  repeatedNote: string
  /** Selected body: "star anatomy" - three temperature shells from a white
   *  heart through a hot photosphere to a saturated corona (CSS image). */
  selectedBody: string
  /** Selected rim + bloom stack (CSS box-shadow list). Deliberately NO ring:
   *  the contrast between the lit body and the dark lane is the border. */
  selectedBloom: string
  /** Notes on the selected body read DARK - outshone by the block itself. */
  selectedNote: string
  /** The body's light visibly wraps around each dark note (its glow color). */
  selectedNoteWrap: string
  /** Outshone loop repeats: dimmer via lower contrast (a mid tint). */
  selectedRepeatedNote: string
  // ── Note-activity endpoints ───────────────────────────────────────────────
  // The playing pulse is a MATTE colour walk, not light: each surface below is
  // where its resting colour lands at full activity, and Block.tsx interpolates
  // with `color-mix` driven by the activity var. This is the piano roll's own
  // move - `midiNoteColor` lifts LIGHTNESS for selection rather than glowing -
  // so a playing block reads like the editor rather than like a lamp.
  /** Resting pane at full activity: the block fills IN with its hue. */
  activeFill: string
  /** Resting note dash at full activity: lifted toward white, chroma easing
   *  off so the peak reads as brightness rather than a hue shift. */
  activeNote: string
  /** Loop repeats stay a step behind the first pass at every activity level. */
  activeRepeatedNote: string
  /** On a SELECTED block the notes are dark on a lit body, so their pulse runs
   *  the other way - deeper and more saturated, never toward white (which
   *  would dissolve them into the body). */
  activeSelectedNote: string
  activeSelectedRepeatedNote: string
  /** Project-card chrome (ProjectsDisplay). These were the pulse's overlay
   *  colours before it went matte; the timeline no longer reads them. */
  outline: string
  selectedOutline: string
}

/** `#rrggbb` → 0-255 channels. Anything that isn't a 6-digit hex yields
 *  `fallback` (a 24-bit packed color) instead of NaNs. */
export function hexToRgb(hex: string, fallback = 0x000000): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : fallback
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

interface HslColor {
  hue: number
  saturation: number
  lightness: number
}

export function colorToHsl(color: string): HslColor | null {
  const hslMatch = color.match(/^hsl\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)$/i)
  if (hslMatch) {
    return {
      hue: Number(hslMatch[1]) % 360,
      saturation: Number(hslMatch[2]) / 100,
      lightness: Number(hslMatch[3]) / 100,
    }
  }

  const hex = color.replace(/^#/, '')
  const expanded = hex.length === 3
    ? hex.split('').map((digit) => digit + digit).join('')
    : hex
  if (!/^[\da-f]{6}$/i.test(expanded)) return null
  const value = Number.parseInt(expanded, 16)
  const red = ((value >> 16) & 255) / 255
  const green = ((value >> 8) & 255) / 255
  const blue = (value & 255) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const chroma = max - min
  const lightness = (max + min) / 2
  let hue = 0
  if (chroma > 0) {
    if (max === red) hue = ((green - blue) / chroma) % 6
    else if (max === green) hue = (blue - red) / chroma + 2
    else hue = (red - green) / chroma + 4
    hue = (hue * 60 + 360) % 360
  }
  const saturation = chroma === 0
    ? 0
    : chroma / (1 - Math.abs(2 * lightness - 1))
  return { hue, saturation, lightness }
}

/** Vivid solid timeline MIDI: the editor's track hue on an opaque, saturated
 *  body (OKLCH 0.73 / 0.175), with dark ink and quieter loop repeats.
 *  Selection keeps the fill; Block draws a crisp outline above loop sections.
 *  Audio retains its existing palette below. */
export function vividMidiBlockPalette(color: string): MidiBlockPalette {
  const source = colorToOklch(color) ?? { l: 0.5, c: 0.08, h: 240 }
  const c = (target: number) => source.c > 0.02 ? target : 0
  const tone = (l: number, chroma: number) => oklchToHex(l, c(chroma), source.h)
  const fill = tone(0.73, 0.175)
  const note = tone(0.23, 0.035)
  const repeat = tone(0.43, 0.055)
  return {
    fill,
    edge: tone(0.80, 0.175),
    note,
    noteGlow: 'transparent',
    repeatedNote: repeat,
    selectedBody: fill,
    selectedBloom: 'none',
    selectedNote: note,
    selectedNoteWrap: 'transparent',
    selectedRepeatedNote: repeat,
    activeFill: tone(0.78, 0.16),
    activeNote: tone(0.16, 0.025),
    activeRepeatedNote: tone(0.32, 0.04),
    activeSelectedNote: tone(0.16, 0.025),
    activeSelectedRepeatedNote: tone(0.32, 0.04),
    outline: tone(0.80, 0.175),
    selectedOutline: '#e2e6ee',
  }
}

/** Timeline block colors derived from the track hue, mixed in OKLCH so every
 *  track's blocks sit at the same perceived depth regardless of hue.
 *
 *  The voice (Tyler's picks from the timeline color lab, 2026-08-02):
 *  - RESTING blocks are "neon signage": a near-black pane with a hue-tinted
 *    inset hairline, and the notes carry all the light - lit tubing at the
 *    same L/C the piano roll's note voice speaks, so both surfaces agree.
 *  - The SELECTED/EDITING block is a "star anatomy" supernova: the body
 *    ignites through three temperature shells (white heart -> hot
 *    photosphere -> saturated corona), a burning rim hands off into a
 *    five-layer bloom, and the notes flip DARK - outshone by the body, with
 *    its light wrapping around each mark. No selection ring of any kind.
 *
 *  Chroma targets run deliberately hot (past what many hues reach in sRGB);
 *  the gamut clamp in oklchToHex renders every hue as saturated as the screen
 *  allows at its lightness, evenly bright across the cycle. Solid colors are
 *  emitted as hex so any consumer (and colorToHsl) keeps parsing them;
 *  translucent glows use oklch() CSS strings. */
export function midiBlockPalette(color: string): MidiBlockPalette {
  const source = colorToOklch(color) ?? { l: 0.5, c: 0.08, h: 240 }
  const colored = source.c > 0.02
  const h = source.h
  const c = (target: number) => (colored ? target : 0)
  return {
    fill: oklchToHex(0.21, c(0.025), h),
    edge: oklchCss(0.58, c(0.13), h, 0.55),
    note: oklchToHex(0.88, c(0.18), h),
    noteGlow: oklchCss(0.78, c(0.19), h, 0.75),
    repeatedNote: oklchToHex(0.6, c(0.09), h),
    selectedBody:
      `radial-gradient(ellipse 78% 150% at 50% 50%, ${oklchToHex(0.98, c(0.01), h)}, ` +
      `${oklchToHex(0.88, c(0.1), h)} 45%, ${oklchToHex(0.72, c(0.19), h)} 100%)`,
    // Tightened 2026-08-18: the old stack reached 140px out at 0.3 alpha and
    // bled across neighbouring rows (and cost the compositor two huge blurs
    // per selected block). Now a close halo that stays with the block.
    selectedBloom: [
      `inset 0 0 10px ${oklchCss(0.66, c(0.21), h, 0.6)}`,
      `0 0 3px ${oklchCss(0.97, c(0.03), h, 0.8)}`,
      `0 0 10px ${oklchCss(0.68, c(0.22), h, 0.6)}`,
      `0 0 24px ${oklchCss(0.64, c(0.22), h, 0.3)}`,
    ].join(', '),
    selectedNote: oklchToHex(0.18, c(0.06), h),
    selectedNoteWrap: oklchCss(0.84, c(0.15), h, 0.7),
    selectedRepeatedNote: oklchToHex(0.48, c(0.09), h),
    // The pane travels far in LIGHTNESS and chroma but stops well short of the
    // note voice (0.88/0.18) - the notes have to stay legible on top of it at
    // the peak, which is the whole reason the old brightness filter (which
    // lifted pane and notes together, so contrast never changed) read as glare.
    activeFill: oklchToHex(0.38, c(0.09), h),
    activeNote: oklchToHex(0.97, c(0.07), h),
    activeRepeatedNote: oklchToHex(0.8, c(0.12), h),
    activeSelectedNote: oklchToHex(0.1, c(0.04), h),
    activeSelectedRepeatedNote: oklchToHex(0.34, c(0.07), h),
    outline: oklchToHex(0.58, c(0.18), h),
    selectedOutline: oklchToHex(0.74, c(0.2), h),
  }
}

/** The light a selected block casts on its lane: a wide wash centered on the
 *  block, clipped to the row (Track renders it behind the lane's blocks). The
 *  cross-lane reach comes free from the block's own bloom shadows. */
export function midiSelectionSpill(color: string, centerPx: number, widthPx: number): string {
  const source = colorToOklch(color) ?? { l: 0.5, c: 0.08, h: 240 }
  const colored = source.c > 0.02
  const h = source.h
  const c = (target: number) => (colored ? target : 0)
  return (
    `radial-gradient(ellipse ${Math.round(widthPx * 1.6)}px 160% at ${Math.round(centerPx)}px 50%, ` +
    `${oklchCss(0.55, c(0.19), h, 0.28)}, ${oklchCss(0.48, c(0.16), h, 0.1)} 52%, transparent 74%)`
  )
}
