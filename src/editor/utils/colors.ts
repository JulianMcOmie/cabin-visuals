export function lighten(color: string, amount: number): string {
  const hslMatch = color.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/)
  if (hslMatch) {
    const h = parseFloat(hslMatch[1])
    const s = parseFloat(hslMatch[2])
    const l = Math.min(100, parseFloat(hslMatch[3]) + amount)
    return `hsl(${h}, ${s}%, ${l}%)`
  }
  const hex = color.replace('#', '')
  const r = Math.min(255, parseInt(hex.substring(0, 2), 16) + Math.round(amount))
  const g = Math.min(255, parseInt(hex.substring(2, 4), 16) + Math.round(amount))
  const b = Math.min(255, parseInt(hex.substring(4, 6), 16) + Math.round(amount))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export interface MidiBlockPalette {
  fill: string
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function colorToHsl(color: string): HslColor | null {
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

const hsl = ({ hue, saturation, lightness }: HslColor) =>
  `hsl(${hue.toFixed(1)}, ${(saturation * 100).toFixed(1)}%, ${(lightness * 100).toFixed(1)}%)`

/** Opaque timeline colors derived from the track hue. Notes sit much darker
 *  than their region while selection/activity can intensify the same hue. */
export function midiBlockPalette(color: string): MidiBlockPalette {
  const source = colorToHsl(color) ?? { hue: 205, saturation: 0.48, lightness: 0.42 }
  const colored = source.saturation > 0.04
  const saturation = colored ? clamp(source.saturation * 0.76, 0.36, 0.62) : 0
  const fillLightness = clamp(source.lightness * 0.52, 0.22, 0.34)
  const base = { hue: source.hue, saturation }
  return {
    fill: hsl({ ...base, lightness: fillLightness }),
    outline: hsl({ ...base, lightness: Math.min(0.48, fillLightness + 0.1) }),
    selectedOutline: hsl({ ...base, lightness: Math.min(0.62, fillLightness + 0.22) }),
    note: hsl({ ...base, saturation: saturation * 0.82, lightness: Math.max(0.055, fillLightness * 0.34) }),
    repeatedNote: hsl({ ...base, saturation: saturation * 0.75, lightness: Math.max(0.04, fillLightness * 0.25) }),
  }
}
