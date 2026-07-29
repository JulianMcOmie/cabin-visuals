import { colorToOklch, oklchToHex } from './oklch'

export interface MidiBlockPalette {
  fill: string
  /** Brighter, more saturated fill for the selected/editing block, so selection
   *  reads from the body colour and not just the outline ring. */
  selectedFill: string
  outline: string
  selectedOutline: string
  note: string
  repeatedNote: string
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

/** Opaque timeline colors derived from the track hue, mixed in OKLCH so every
 *  track's blocks sit at the same perceived depth regardless of hue. The
 *  chroma targets run deliberately hot (past what many hues can reach in
 *  sRGB); the gamut clamp in oklchToHex means every hue simply renders as
 *  saturated as the screen allows at its lightness, evenly bright across the
 *  cycle. Notes are a bright charged tint of the same hue. Emitted as hex so
 *  any consumer (and colorToHsl) can keep parsing them. */
export function midiBlockPalette(color: string): MidiBlockPalette {
  const source = colorToOklch(color) ?? { l: 0.5, c: 0.08, h: 240 }
  const colored = source.c > 0.02
  const h = source.h
  const c = (target: number) => (colored ? target : 0)
  return {
    fill: oklchToHex(0.48, c(0.21), h),
    selectedFill: oklchToHex(0.6, c(0.24), h),
    outline: oklchToHex(0.58, c(0.18), h),
    selectedOutline: oklchToHex(0.74, c(0.2), h),
    note: oklchToHex(0.9, c(0.15), h),
    repeatedNote: oklchToHex(0.76, c(0.12), h),
  }
}
