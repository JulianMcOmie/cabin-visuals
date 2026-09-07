import { colorToOklch, oklchToHex } from './oklch'

/** Icons and opacity faders: vivid hues, with a readable neutral ramp that
 * preserves the distinction between white, gray, and black identities. */
export function trackChromeColor(color: string): string {
  const source = colorToOklch(color) ?? { l: 0.6, c: 0.1, h: 258 }
  if (source.c <= 0.02) return oklchToHex(0.5 + 0.48 * source.l, 0, 0)
  return oklchToHex(0.8, 0.21, source.h)
}
