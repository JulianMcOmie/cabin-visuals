import { colorToOklch, gradientStops, oklchToHex } from './oklch'

/** Solid UI accents follow the palette, lifting only very dark midpoints. */
export function gradientAccent(a = '#4dd2ff', b = '#ff4d88'): string {
  const midpoint = gradientStops(a, b, 3)[1]
  const color = colorToOklch(midpoint)
  return color && color.l < 0.45 ? oklchToHex(0.45, color.c, color.h) : midpoint
}
