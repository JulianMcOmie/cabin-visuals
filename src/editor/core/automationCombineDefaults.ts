import type { Track } from '../types'

export type AutomationCombine = NonNullable<Track['automationCombine']>

/** Creation policy only: never use this as a missing-field playback fallback.
 * Saved lanes without a combination mode are legacy Override lanes.
 * Stable parameter keys identify semantic families; integer metadata wins over
 * dimensional names (Grid's depth is a count, Approach's depth a distance).
 * Unknown controls are absolute settings until their semantics are known. */
export function defaultAutomationCombine(
  targetKey: string,
  parameter: { integer?: boolean; default?: number; min?: number } = {},
): AutomationCombine {
  // Effect instance ids are opaque; classify only the final parameter key.
  const key = targetKey.slice(targetKey.lastIndexOf(':') + 1)
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_\d]+/)
  const has = (...parts: string[]) => words.some(word => parts.includes(word))

  if (parameter.integer
    || /^(?:copies|rows|columns|segments|mirrors|sides|rings|facets|divisions|slices|seed|enabled)\d*$/i.test(key)
    || /count\d*$/i.test(key) || /^copiesPer/.test(key)) return 'override'
  if (has('beats', 'rate', 'speed', 'frequency', 'duration')) return 'override'

  // Dimensional and level controls compose as proportions. Do not multiply a
  // zero-default control (e.g. a disabled light) into permanent zero.
  if (has('size', 'scale', 'width', 'height', 'depth', 'radius', 'spacing', 'distance', 'length', 'span', 'separation', 'wavelength', 'reach', 'zoom', 'opacity', 'gain', 'volume', 'intensity', 'amplitude')) {
    return parameter.default === 0 ? 'override' : 'multiply'
  }

  if (/^(?:tf)?[xyz]$/i.test(key)
    || has('pos', 'position', 'center', 'pivot', 'offset', 'rot', 'rotate', 'rotation', 'angle', 'yaw', 'pitch', 'roll', 'tilt', 'hue', 'phase', 'shift', 'scroll')) {
    return 'sum'
  }

  // Signed controls describe offsets/directions: lightness, exposure, spin...
  if (parameter.min !== undefined && parameter.min < 0) return 'sum'
  return 'override'
}
