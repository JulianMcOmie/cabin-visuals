// The one param binder for bespoke panels. Every panel used to grow its own —
// half of them `parameter()`/`numericValue()` lookups, the other half a
// Map-based `bind()` — and each carried the same latent bugs (unclaimed keys
// leaking into MORE, gated keys breaking the fallback check). This merges the
// two styles: typed lookups that CLAIM keys out of a pool, `rest()` for the
// disclosure, and `missing` for the fallback branch.
//
// Lookups return null when the key is absent or the wrong shape, and the kit's
// controls all accept null bindings (rendering nothing) — so a panel only
// narrows the bindings it reads values from directly.
//
// The showIf trap (see this directory's CLAUDE.md): TrackEditor filters gated
// params BEFORE the instrument branch's renderer sees them. A gated key must
// therefore be looked up with `{ optional: true }` — otherwise the panel falls
// back to the generic list whenever the gate is off, which looks exactly like
// the registration having failed.

import {
  isNumberParam,
  type BooleanParamDef,
  type ColorParamDef,
  type NumberParamDef,
  type SelectParamDef,
  type StringParamDef,
} from '../../instruments/types'
import type { UserInterfaceParameter } from '../types'

export interface NumBinding { def: NumberParamDef; value: number; set: (value: number) => void }
export interface SelectBinding { def: SelectParamDef; value: number; set: (value: number) => void }
export interface BooleanBinding { def: BooleanParamDef; value: number; set: (value: number) => void }
export interface ColorBinding { def: ColorParamDef; value: string; set: (value: string) => void }
export interface StringBinding { def: StringParamDef; value: string; set: (value: string) => void }

interface LookupOptions {
  /** Absence does not trip `missing` — for showIf-gated keys (always, on the
   *  instrument branch) and genuinely optional bindings. */
  optional?: boolean
}

export interface PanelBindings {
  num(key: string, options?: LookupOptions): NumBinding | null
  select(key: string, options?: LookupOptions): SelectBinding | null
  boolean(key: string, options?: LookupOptions): BooleanBinding | null
  color(key: string, options?: LookupOptions): ColorBinding | null
  string(key: string, options?: LookupOptions): StringBinding | null
  /** Everything not claimed by a lookup, in definition order — feed to <More>. */
  rest(): UserInterfaceParameter[]
  /** True once any non-optional lookup came back empty: render the generic
   *  ParameterList instead of a half-empty custom layout. */
  readonly missing: boolean
}

export function bindPanel(parameters: readonly UserInterfaceParameter[]): PanelBindings {
  const pool = new Map(parameters.map((parameter) => [parameter.definition.key, parameter]))
  let missing = false

  // Claims the key either way: a present-but-wrong-shape param should not
  // reappear in rest() after its lookup failed.
  function claim(key: string, options: LookupOptions | undefined, matches: (bound: UserInterfaceParameter) => boolean): UserInterfaceParameter | null {
    const bound = pool.get(key)
    if (bound) pool.delete(key)
    if (bound && matches(bound)) return bound
    if (!options?.optional) missing = true
    return null
  }

  return {
    num(key, options) {
      const bound = claim(key, options, (candidate) => isNumberParam(candidate.definition) && typeof candidate.value === 'number')
      return bound ? { def: bound.definition as NumberParamDef, value: bound.value as number, set: bound.setValue } : null
    },
    select(key, options) {
      const bound = claim(key, options, (candidate) => candidate.definition.type === 'select' && typeof candidate.value === 'number')
      return bound ? { def: bound.definition as SelectParamDef, value: bound.value as number, set: bound.setValue } : null
    },
    boolean(key, options) {
      const bound = claim(key, options, (candidate) => candidate.definition.type === 'boolean' && typeof candidate.value === 'number')
      return bound ? { def: bound.definition as BooleanParamDef, value: bound.value as number, set: bound.setValue } : null
    },
    color(key, options) {
      const bound = claim(key, options, (candidate) => candidate.definition.type === 'color' && typeof candidate.value === 'string')
      return bound ? { def: bound.definition as ColorParamDef, value: bound.value as string, set: bound.setValue } : null
    },
    string(key, options) {
      const bound = claim(key, options, (candidate) => candidate.definition.type === 'string' && typeof candidate.value === 'string')
      return bound ? { def: bound.definition as StringParamDef, value: bound.value as string, set: bound.setValue } : null
    },
    rest() {
      return [...pool.values()]
    },
    get missing() {
      return missing
    },
  }
}
