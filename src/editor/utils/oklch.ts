import { colorToHsl } from './colors'

// OKLCH is the editor's color-mixing space: equal L values LOOK equally bright
// across every hue (unlike HSL, where 55%-lightness yellow reads murky while
// 55% blue reads neon). All derived UI colors - note fills, block palettes,
// the track cycle - are computed here and emitted as sRGB hex so existing
// consumers (color inputs, colorToHsl, tests) keep parsing them.

export interface Oklch {
  /** Perceptual lightness 0..1 */
  l: number
  /** Chroma, 0 = grey; sRGB tops out around 0.25-0.37 depending on hue */
  c: number
  /** Hue angle in degrees */
  h: number
}

const cbrt = Math.cbrt

function srgbToLinear(u: number): number {
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(u: number): number {
  return u <= 0.0031308 ? u * 12.92 : 1.055 * u ** (1 / 2.4) - 0.055
}

function oklchToLinearRgb(l: number, c: number, h: number): [number, number, number] {
  const hr = (h * Math.PI) / 180
  const a = c * Math.cos(hr)
  const b = c * Math.sin(hr)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const inGamut = (rgb: [number, number, number]) =>
  rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/**
 * OKLCH → sRGB hex. Out-of-gamut colors keep their lightness and hue and give
 * up chroma (bisection) - the standard CSS gamut-mapping intent - so a ramp
 * never visibly kinks where one hue clips before its neighbours.
 */
export function oklchToHex(l: number, c: number, h: number): string {
  let rgb = oklchToLinearRgb(l, c, h)
  if (!inGamut(rgb)) {
    let lo = 0
    let hi = c
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinearRgb(l, mid, h))) lo = mid
      else hi = mid
    }
    rgb = oklchToLinearRgb(l, lo, h)
  }
  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`
}

/** Parse a hex or hsl() color string into OKLCH. Null when unparseable. */
export function colorToOklch(color: string): Oklch | null {
  const hsl = colorToHsl(color)
  if (!hsl) return null
  // HSL → sRGB
  const { hue, saturation, lightness } = hsl
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const hp = (((hue % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [chroma, x, 0]
      : hp < 2 ? [x, chroma, 0]
        : hp < 3 ? [0, chroma, x]
          : hp < 4 ? [0, x, chroma]
            : hp < 5 ? [x, 0, chroma]
              : [chroma, 0, x]
  const m = lightness - chroma / 2
  // sRGB → OKLab (via LMS)
  const r = srgbToLinear(r1 + m)
  const g = srgbToLinear(g1 + m)
  const b = srgbToLinear(b1 + m)
  const l_ = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const c = Math.sqrt(a * a + bb * bb)
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
  return { l: L, c, h }
}

/** CSS oklch() string for DOM-only colors (supports alpha, which hex can't
 *  carry through the palette helpers). */
export function oklchCss(l: number, c: number, h: number, alpha?: number): string {
  const a = alpha == null ? '' : ` / ${alpha}`
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h.toFixed(1)}${a})`
}
