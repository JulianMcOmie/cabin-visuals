import { createContext } from 'react'
import type { Color } from 'three'
import { applyColorShiftToColor, HEX_COLOR } from './colorShift'
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

/** Builds a copy's string-param view in caller-owned storage. Only declared
 * color params are shifted; other strings and legacy color formats pass through. */
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
