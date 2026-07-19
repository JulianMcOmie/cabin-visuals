import { createContext } from 'react'
import { Color } from 'three'

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

/** Rebuilds the string-param view an instrument receives for one visual copy.
 * Only schema-declared color params are changed; text, asset ids, geometry ids,
 * and every other string param pass through byte-for-byte. The output object is
 * caller-owned and reused to avoid per-frame garbage. */
export function applyColorShiftToInstrumentParams(
  stringParams: Readonly<Record<string, string>>,
  colorParams: readonly InstrumentColorParam[],
  hue: number,
  saturation: number,
  lightness: number,
  output: Record<string, string>,
  scratchColor: Color,
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
    scratchColor.set(source).offsetHSL(hue, saturation, lightness)
    output[param.key] = `#${scratchColor.getHexString()}`
  }
  return output
}
