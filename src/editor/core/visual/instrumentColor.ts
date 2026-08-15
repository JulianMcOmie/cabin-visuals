import { createContext } from 'react'
import { Color } from 'three'
import { mixOklabLinearRgb, rotateHueOklabLinearRgb } from '../../utils/oklch'
import type { VisualCopy } from '../visualCopies/types'

export interface InstrumentColorParam {
  key: string
  defaultColor: string
}

/** Static occurrence metadata supplied by ObjectRenderer. The live color shift
 * stays in the imperative VisualCopy cache and is sampled by useInstrumentFrame. */
export interface InstrumentCopyContextValue {
  visualCopyIndex: number
  colorParams: readonly InstrumentColorParam[]
}

export const InstrumentCopyContext = createContext<InstrumentCopyContextValue | null>(null)

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** The one colorShift application: tint mix FIRST (absolute pull), HSL/OKLCH
 * offsets on top. `color` is shifted in place and returned. Shared by the
 * string-param path below and the instanced path's per-instance colors, so a
 * copy renders the same shifted color whichever renderer draws it. */
export function applyColorShiftToColor(
  color: Color,
  shift: Readonly<VisualCopy['colorShift']>,
  scratchTint: Color,
): Color {
  const tintMix = shift.tint && HEX_COLOR.test(shift.tint)
    ? Math.max(0, Math.min(1, shift.tintAmount))
    : 0
  if (tintMix > 0) {
    scratchTint.set(shift.tint as string)
    if (shift.tintPerceptual) mixOklabLinearRgb(color, scratchTint, tintMix)
    else color.lerp(scratchTint, tintMix)
  }
  // `huePerceptual` turns the hue in OKLCH first and leaves offsetHSL only
  // the saturation and lightness offsets - those are dialled in against HSL's
  // own scale, so they keep reading it. See the field's note in visualCopies/
  // types.ts for why an HSL hue sweep pulses in brightness.
  if (shift.huePerceptual) {
    rotateHueOklabLinearRgb(color, shift.hue)
    color.offsetHSL(0, shift.saturation, shift.lightness)
  } else {
    color.offsetHSL(shift.hue, shift.saturation, shift.lightness)
  }
  return color
}

/** Rebuilds the string-param view an instrument receives for one visual copy.
 * Only schema-declared color params are changed; text, asset ids, geometry ids,
 * and every other string param pass through byte-for-byte. The output object is
 * caller-owned and reused to avoid per-frame garbage.
 *
 * Order matters: the absolute `tint` is mixed in FIRST and the relative HSL
 * offsets ride on top of the result. This is the only place that knows both the
 * object's own color and the copy's target, which is why the mix lives here
 * rather than in the mover that asked for it.
 *
 * `tintPerceptual` picks how the mix walks: straight channel lerp (the historic
 * behaviour, still the default) or OKLab, which keeps a partial mix looking
 * like the color it is heading for instead of sagging through a desaturated
 * middle. Both run on three's LINEAR working values, so neither round-trips
 * through hex. */
export function applyColorShiftToInstrumentParams(
  stringParams: Readonly<Record<string, string>>,
  colorParams: readonly InstrumentColorParam[],
  shift: Readonly<VisualCopy['colorShift']>,
  output: Record<string, string>,
  scratchColor: Color,
  scratchTint: Color,
): Record<string, string> {
  for (const key in output) delete output[key]
  Object.assign(output, stringParams)

  for (const param of colorParams) {
    const hasStoredValue = Object.prototype.hasOwnProperty.call(stringParams, param.key)
    const source = hasStoredValue ? stringParams[param.key] : param.defaultColor
    // Empty is a meaningful value for optional colors such as Text stroke.
    // Unknown legacy formats are preserved rather than guessed at.
    if (!HEX_COLOR.test(source)) {
      output[param.key] = source
      continue
    }
    scratchColor.set(source)
    applyColorShiftToColor(scratchColor, shift, scratchTint)
    output[param.key] = `#${scratchColor.getHexString()}`
  }
  return output
}
