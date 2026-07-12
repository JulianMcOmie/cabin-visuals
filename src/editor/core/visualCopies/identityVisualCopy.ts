import { Matrix4 } from 'three'
import type { VisualCopy } from './types'

/** The copy every chain starts from: render the output once, unchanged. It must
 *  render pixel-equivalently to the current one-object path. */
export function identityVisualCopy(): VisualCopy {
  return {
    transform: new Matrix4(),
    opacity: 1,
    colorShift: {
      hue: 0,
      saturation: 0,
      lightness: 0,
    },
  }
}
