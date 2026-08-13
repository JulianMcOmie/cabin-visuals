'use client'

// The bound knob and color pill: `UserInterfaceParameter` bindings in,
// LaserKnob / ColorWheelPill out. Seventeen panels each carried this adapter
// under a different name (ParamKnob, MoverKnob, StrobeKnob, EmberKnob…); the
// plain-number primitives stay where they are for non-param callers (ADSR
// fields, mover inputs) and this is the one wrapper for everyone else.

import { LaserKnob, formatKnobValue } from '../laserKnob'
import { ColorWheelPill } from '../colorWheel'
import { useConsoleAccent } from './Console'
import type { ColorBinding, NumBinding } from './bindings'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** The index of the detent nearest to `value`. */
function nearestDetent(detents: readonly number[], value: number): number {
  let best = 0
  for (let index = 1; index < detents.length; index++) {
    if (Math.abs(detents[index] - value) < Math.abs(detents[best] - value)) best = index
  }
  return best
}

export function Knob({ b, label, accent, large, bipolar, suffix, format, detents, ariaLabel }: {
  /** Null renders nothing — panels pass lookups through without narrowing. */
  b: NumBinding | null | undefined
  /** Short all-caps caption; defaults to the def's label uppercased, '' drops
   *  the caption row (grid panels that label rows and columns instead). */
  label?: string
  /** Overrides the Console accent — for a second voice in a two-color panel. */
  accent?: string
  /** The panel's primary param reads one step larger. */
  large?: boolean
  /** Mandatory for a SIGNED param whose zero is mid-travel (see the guide). */
  bipolar?: boolean
  suffix?: string
  format?: (value: number) => string
  /**
   * Uneven allowed stops (a musical-rate ladder): the knob runs in INDEX units
   * so clicks space evenly on the arc regardless of how non-uniform the values
   * are, converting index ⟷ value at the boundary. `bipolar` still works when
   * the zero detent is the middle index. (RadialMotion settled this pattern.)
   */
  detents?: readonly number[]
  ariaLabel?: string
}) {
  const consoleAccent = useConsoleAccent()
  if (!b) return null
  const def = b.def

  if (detents && detents.length > 0) {
    const show = format ?? ((value: number) => formatKnobValue(value, def.step))
    return (
      <LaserKnob
        value={nearestDetent(detents, b.value)}
        min={0}
        max={detents.length - 1}
        step={1}
        defaultValue={nearestDetent(detents, def.default)}
        label={label ?? def.label.toUpperCase()}
        ariaLabel={ariaLabel ?? def.label}
        accent={accent ?? consoleAccent}
        large={large}
        bipolar={bipolar}
        suffix={suffix}
        format={(index) => show(detents[clamp(Math.round(index), 0, detents.length - 1)])}
        onChange={(index) => b.set(detents[clamp(Math.round(index), 0, detents.length - 1)])}
      />
    )
  }

  return (
    <LaserKnob
      value={b.value}
      min={def.min}
      max={def.max}
      step={def.step}
      defaultValue={def.default}
      curve={def.curve ?? 1}
      label={label ?? def.label.toUpperCase()}
      ariaLabel={ariaLabel ?? def.label}
      accent={accent ?? consoleAccent}
      large={large}
      bipolar={bipolar}
      suffix={suffix}
      format={format}
      onChange={b.set}
    />
  )
}

/** The bound color pill. The halo is the host's call (it decides what glow
 *  means — usually `emitterHalo(accent, strength)`); everything else is the
 *  shared wheel. Typically pushed to the row's far right with `ml-auto` on a
 *  wrapper. */
export function ColorPill({ b, label = 'COLOR', halo, align = 'right', dimmed, pillTestId, wheelTestId }: {
  b: ColorBinding | null | undefined
  label?: string
  halo?: string
  align?: 'left' | 'right'
  dimmed?: boolean
  pillTestId?: string
  wheelTestId?: string
}) {
  if (!b) return null
  return (
    <ColorWheelPill
      value={b.value}
      onChange={b.set}
      label={label}
      ariaLabel={b.def.label}
      halo={halo}
      align={align}
      dimmed={dimmed}
      pillTestId={pillTestId}
      wheelTestId={wheelTestId}
    />
  )
}
