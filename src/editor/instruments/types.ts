// Instrument schema types. Kept separate from the core project types.ts (Track/
// Block/Note) since "what an instrument exposes" is a different concern from "what
// a project is". Each instrument owns its own InstrumentDef, colocated with its
// visual component; the registry (./index) just collects them.

export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

export interface InstrumentDef {
  id: string
  name: string
  params: ParamDef[]
}

/** A param's schema default (no track/registry lookup). */
export function paramDefault(def: InstrumentDef, key: string): number {
  return def.params.find((p) => p.key === key)?.default ?? 0
}
