import type { Color } from 'three'
import { mixOklabLinearRgb, rotateHueOklabLinearRgb } from '../../utils/oklch'
import type { VisualCopy } from '../visualCopies/types'

export const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Mutates color in place: absolute tint first, then relative HSL/OKLCH offsets.
 * Shared by instrument params, instanced colors and scene backdrops. */
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
  // Perceptual hue preserves OKLCH lightness/chroma; saturation and lightness
  // offsets still use the controls' HSL units.
  if (shift.huePerceptual) {
    rotateHueOklabLinearRgb(color, shift.hue)
    color.offsetHSL(0, shift.saturation, shift.lightness)
  } else {
    color.offsetHSL(shift.hue, shift.saturation, shift.lightness)
  }
  return color
}
