import { Color } from 'three'
import { applyColorShiftToColor, HEX_COLOR } from './colorShift'
import type { VisualCopy } from '../visualCopies/types'

/** Resolved copy objects are refreshed every beat, but their color inputs often
 * repeat across a layout and across frames. Cache by value, never copy identity.
 * Retain a bounded palette so animated colors cannot grow the cache forever. */
export function createCopyColorSampler(capacity = 2048) {
  const source = new Color(), tint = new Color(), cache = new Map<string, Color>()
  let sourceHex: string | undefined
  return (hex: string, shift: VisualCopy['colorShift'] | undefined, out: Color) => {
    const cacheable = hex === sourceHex || HEX_COLOR.test(hex)
    if (cacheable) {
      if (sourceHex !== hex) { source.set(hex); sourceHex = hex; cache.clear() }
      out.copy(source)
    } else out.set(hex)
    if (!shift) return out
    if (!cacheable) return applyColorShiftToColor(out, shift, tint)
    const key = `${shift.tint}|${shift.tintAmount}|${shift.hue}|${shift.saturation}|${shift.lightness}|${!!shift.tintPerceptual}|${!!shift.huePerceptual}`
    const cached = cache.get(key)
    if (cached) return out.copy(cached)
    applyColorShiftToColor(out, shift, tint)
    if (cache.size >= capacity) cache.clear()
    cache.set(key, out.clone())
    return out
  }
}
