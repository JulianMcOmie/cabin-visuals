// Instrument schema types. Kept separate from the core project types.ts (Track/
// Block/Note) since "what an instrument exposes" is a different concern from "what
// a project is". Each instrument owns its own def, colocated with its visual
// component; the registry (./index) just collects them.

import type { FC } from 'react'

export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

/**
 * A modulation input on an object — a curated, shared vocabulary (scale, energy,
 * hue…) that modulator instruments target. NOT a user-facing knob: it's internal
 * plumbing, bound onto the render in code. `combine` decides how multiple
 * modulators stack on the same port. Unused until the matrix lands.
 */
export interface PortDef {
  key: string
  label: string
  combine: 'add' | 'multiply' | 'max' | 'replace'
  default: number
  range?: [number, number]
}

/** An object / source / shape instrument — renders something. */
export interface ObjectInstrumentDef {
  id: string
  name: string
  kind: 'object'
  params: ParamDef[]
  ports: PortDef[]
  /** The R3F visual; pulls its per-frame state by trackId from the engine. */
  component: FC<{ trackId: string }>
}

/** A modulator / shaper instrument — renders nothing; its trigger notes drive a
 *  port on the object(s) it's routed to. `kind` selects the engine's evaluate fn;
 *  `port` is the (internal, never user-visible) port it drives. */
export interface ModulatorInstrumentDef {
  id: string
  name: string
  kind: 'modulator'
  signal: 'pulse'
  port: string
}

/** A param's schema default (no track/registry lookup). */
export function paramDefault(def: ObjectInstrumentDef, key: string): number {
  return def.params.find((p) => p.key === key)?.default ?? 0
}
