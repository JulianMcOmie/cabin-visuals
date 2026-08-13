'use client'

// PanelSpec: the declarative layer over the console kit. A panel that is pure
// composition - accent, an optional preview, rows of knobs/segments, MORE -
// can be written as DATA and interpreted by one renderer, instead of a new
// component file plus a registry entry. Two entry points use it:
//
//  - a registry entry can be `consolePanel(spec)` (Laser Sphere);
//  - an instrument def can carry `panelSpec` and skip ids.ts / index.ts
//    registration entirely (Laser Line) - TrackEditor prefers it over
//    `userInterfaceRenderer`.
//
// The spec deliberately covers only the chassis and rows. Previews and one-off
// controls stay COMPONENTS (the `preview` slot, `custom` rows): per the design
// guide they are the instrument speaking, and flattening them into config
// would just be a worse component syntax. A panel that outgrows the spec
// becomes a bespoke file - that is the intended pressure valve, not a failure.

import { type ComponentType } from 'react'
import { bindPanel } from './bindings'
import { emitterHalo } from './accent'
import { Console, ControlRow, GutterRow } from './Console'
import { ColorPill, Knob } from './Knob'
import { Segmented } from './Segmented'
import { More } from './More'
import { ParameterList } from '../ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from '../types'

/** What a spec'd panel's preview component receives: every param's live value
 *  by key, plus the resolved accent. */
export interface PanelPreviewProps {
  values: Record<string, number>
  strings: Record<string, string>
  accent: string
}

export interface KnobSpec {
  param: string
  /** Short caps caption; defaults to the def's label uppercased. */
  label?: string
  large?: boolean
  /** Mandatory for a SIGNED param whose zero is mid-travel (see the guide). */
  bipolar?: boolean
  suffix?: string
  format?: (value: number) => string
  /** Absence doesn't trip the fallback - REQUIRED for showIf-gated keys on
   *  the instrument branch (TrackEditor filters those before the panel). */
  optional?: boolean
}

/** A color pill in the row. Pushed to the row's far right (the guide's
 *  layout). `haloParam` names the number whose value drives the emitter halo,
 *  normalized by that param's max (Laser Sphere's GLOW). */
export interface PillSpec {
  pill: string
  label?: string
  haloParam?: string
}

/**
 * A knob-row item: a spec object, or the string shorthand
 * `"key"` / `"key*"` (large) / `"key?"` (optional) / `"key:CAPTION"` -
 * combinable as `"key*:CAPTION"`, `"key?:CAPTION"`.
 */
export type KnobItem = string | KnobSpec | PillSpec

export type PanelRowSpec =
  /** A ControlRow (or GutterRow when `gutter` is set) of knobs and pills. */
  | { row: KnobItem[]; spill?: boolean; gutter?: string; className?: string }
  /** The kit's segmented control bound to a select param. */
  | { segmented: string; name?: string; className?: string }
  /** Escape hatch: a component rendered as its own row. `claims` names the
   *  param keys it owns, so they leave the MORE disclosure; the component
   *  finds them in `parameters` itself. */
  | { custom: ComponentType<{ parameters: readonly UserInterfaceParameter[]; accent: string }>; claims?: string[] }

export interface PanelSpec {
  /** A fixed hex, or a color param the accent follows live. */
  accent: string | { param: string; fallback: string }
  testId?: string
  bleed?: 'top' | 'full'
  /** The live preview - always a component, never config (see above). */
  preview?: ComponentType<PanelPreviewProps>
  rows: PanelRowSpec[]
  /** Caption on the unclaimed-params disclosure (default MORE). */
  moreLabel?: string
}

function parseKnobItem(item: KnobItem): KnobSpec | PillSpec {
  if (typeof item !== 'string') return item
  const match = /^(\w+)([*?]*)(?::(.+))?$/.exec(item)
  if (!match) return { param: item }
  return {
    param: match[1],
    large: match[2].includes('*') || undefined,
    optional: match[2].includes('?') || undefined,
    label: match[3],
  }
}

const isPill = (item: KnobSpec | PillSpec): item is PillSpec => 'pill' in item

// One component per spec OBJECT: TrackEditor resolves the renderer on every
// render, and minting a new component type each time would remount the whole
// panel (killing preview state) on every keystroke.
const RENDERERS = new WeakMap<PanelSpec, UserInterfaceRendererDefinition>()

/** Build (or fetch) the renderer a spec describes. */
export function consolePanel(spec: PanelSpec): UserInterfaceRendererDefinition {
  const cached = RENDERERS.get(spec)
  if (cached) return cached

  const SpecPanel: UserInterfaceRendererDefinition = ({ parameters }) => {
    const b = bindPanel(parameters)

    // Claim everything the rows name, in declaration order, so rest() is
    // exactly the unplaced params. Custom rows claim via `claims`.
    const knobs = new Map<string, ReturnType<typeof b.num>>()
    const pills = new Map<string, ReturnType<typeof b.color>>()
    const selects = new Map<string, ReturnType<typeof b.select>>()
    for (const row of spec.rows) {
      if ('row' in row) {
        for (const raw of row.row) {
          const item = parseKnobItem(raw)
          if (isPill(item)) pills.set(item.pill, b.color(item.pill))
          else knobs.set(item.param, b.num(item.param, { optional: item.optional }))
        }
      } else if ('segmented' in row) {
        selects.set(row.segmented, b.select(row.segmented))
      }
    }
    // Custom rows claim by name only - the component reads `parameters`
    // itself, so the keys just need to stay out of the MORE disclosure.
    const claimed = new Set(spec.rows.flatMap((row) => ('custom' in row ? row.claims ?? [] : [])))
    const rest = b.rest().filter((parameter) => !claimed.has(parameter.definition.key))

    const accentColor = typeof spec.accent === 'string'
      ? spec.accent
      : (pills.get(spec.accent.param)?.value
        ?? (parameters.find((p) => p.definition.key === (spec.accent as { param: string }).param)?.value as string | undefined)
        ?? spec.accent.fallback)

    if (b.missing) return <ParameterList parameters={parameters} />

    const values: Record<string, number> = {}
    const strings: Record<string, string> = {}
    for (const parameter of parameters) {
      if (typeof parameter.value === 'number') values[parameter.definition.key] = parameter.value
      else strings[parameter.definition.key] = parameter.value
    }

    const Preview = spec.preview

    return (
      <Console accent={accentColor} bleed={spec.bleed} testId={spec.testId}>
        {Preview && <Preview values={values} strings={strings} accent={accentColor} />}
        {spec.rows.map((row, index) => {
          if ('segmented' in row) {
            return (
              <div key={index} className={row.className ?? 'px-4 pt-2'}>
                <Segmented b={selects.get(row.segmented)} name={row.name} />
              </div>
            )
          }
          if ('custom' in row) {
            const Custom = row.custom
            return <Custom key={index} parameters={parameters} accent={accentColor} />
          }
          const items = row.row.map(parseKnobItem)
          const controls = items.map((item, itemIndex) => {
            if (isPill(item)) {
              const halo = item.haloParam ? knobs.get(item.haloParam) ?? null : null
              return (
                <div key={itemIndex} className="ml-auto">
                  <ColorPill
                    b={pills.get(item.pill)}
                    label={item.label}
                    halo={halo ? emitterHalo(accentColor, halo.value / (halo.def.max || 1)) : undefined}
                  />
                </div>
              )
            }
            return (
              <Knob
                key={itemIndex}
                b={knobs.get(item.param)}
                label={item.label}
                large={item.large}
                bipolar={item.bipolar}
                suffix={item.suffix}
                format={item.format}
              />
            )
          })
          // The first knob row after the preview catches its spilled light
          // unless the spec says otherwise.
          const spill = row.spill ?? (index === 0 && !!spec.preview)
          if (row.gutter) return <GutterRow key={index} label={row.gutter}>{controls}</GutterRow>
          return <ControlRow key={index} spill={spill} className={row.className}>{controls}</ControlRow>
        })}
        <More parameters={rest} label={spec.moreLabel} />
      </Console>
    )
  }

  RENDERERS.set(spec, SpecPanel)
  return SpecPanel
}
