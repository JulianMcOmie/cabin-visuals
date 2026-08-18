// The lighting formulas of docs/instrument-panel-design-guide.md, extracted so
// a panel states its accent once and the wash/spill/halo math cannot drift
// per-panel. Before this module, the shade computation alone had nine hand
// copies; a tweak to the visual language meant a fifteen-file sweep.

import { hexToHsv, hsvToHex, withAlpha } from '../colorWheel'
import { clamp01 } from '../../utils/math'

/** The section background: a hue-true DARK SHADE of the accent, never an alpha
 *  tint — low-alpha color over the panel's mid-gray desaturates into mud
 *  (tried and reverted; see the design guide). Keeps the accent's hue, caps
 *  saturation at 0.5, value ≈ 0.075. */
export function shadeOf(accent: string): string {
  const { h, s } = hexToHsv(accent)
  return hsvToHex(h, Math.min(s, 0.5), 0.075)
}

/** The one earned gradient: the preview's light spilling through the seam onto
 *  the controls row — the room is lit by the instrument, not painted. */
export function spillOf(accent: string): string {
  return `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)`
}

/** The emitter halo — the box-shadow the panel's ONE emitter (usually the color
 *  pill) wears. `strength` is 0..1; the host maps its own param range onto it
 *  (Laser Sphere passes glow/12), so the reach and alpha ramps live here and
 *  the meaning of "how lit" stays the panel's. */
export function emitterHalo(accent: string, strength: number): string {
  const t = clamp01(strength)
  return `0 0 ${Math.round(5 + t * 21.6)}px ${withAlpha(accent, 0.18 + t * 0.55)}`
}
