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
  /** Note-activity pulse overlay colors (screen-blended, see Block.tsx). */
  outline: string
  selectedOutline: string
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
    selectedBloom: [
      `inset 0 0 14px ${oklchCss(0.66, c(0.21), h, 0.85)}`,
      `0 0 4px ${oklchCss(0.97, c(0.03), h, 0.95)}`,
      `0 0 14px ${oklchCss(0.68, c(0.22), h, 0.95)}`,
      `0 0 36px ${oklchCss(0.64, c(0.22), h, 0.7)}`,
      `0 0 76px ${oklchCss(0.58, c(0.21), h, 0.45)}`,
      `0 0 140px ${oklchCss(0.55, c(0.2), h, 0.3)}`,
    ].join(', '),
    selectedNote: oklchToHex(0.18, c(0.06), h),
    selectedNoteWrap: oklchCss(0.84, c(0.15), h, 0.7),
    selectedRepeatedNote: oklchToHex(0.48, c(0.09), h),
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
    `radial-gradient(ellipse ${Math.round(widthPx * 2.4)}px 185% at ${Math.round(centerPx)}px 50%, ` +
    `${oklchCss(0.55, c(0.19), h, 0.5)}, ${oklchCss(0.48, c(0.16), h, 0.18)} 52%, transparent 78%)`
  )
}
