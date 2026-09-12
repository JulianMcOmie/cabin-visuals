'use client'

import { percentEntry } from './knobValueParsing'

// Bespoke settings for the Gradient colorizer, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console),
// borrowing Figma's gradient editor as the mental model: the hero is the RAMP
// ITSELF - a strip drawn from the definition's own gradientStops(), with the
// two stop swatches sitting ON its ends and a flip button between them. What
// the strip shows is byte-for-byte what the stage samples, because both call
// the same function.
//
// Below the ramp: mapping mode, relevant geometry controls, and shared amount.
// Line and curve paths have numeric XYZ editing plus a transient stage overlay.
//
// The accent is DERIVED: mid-ramp of the current blend, so the console lights
// with the gradient itself (the same spirit as accent-follows-color-param).

import { useMemo } from 'react'
import { gradientAccent } from '../utils/gradientAccent'
import { GradientPathEditor } from './GradientPathEditor'
import { ArrowLeftRight } from 'lucide-react'
import {
  gradientStops,
} from '../core/visualCopies/gradientColorizer'
import {
  bindPanel,
  ColorPicker,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  Segmented,
  type ColorBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** A gradient stop uses the same picker as Colorizer, without its caption. */
function StopSwatch({ bound, label, align }: {
  bound: ColorBinding
  label: string
  align: 'left' | 'right'
}) {
  return <ColorPicker value={bound.value} onChange={bound.set} ariaLabel={`Gradient color ${label}`} align={align} size={20} pillTestId={`gradient-stop-${label.toLowerCase()}`} wheelTestId={`gradient-wheel-${label.toLowerCase()}`} />
}

export const GradientColorizerUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters, targetId }) => {
  const pool = bindPanel(parameters)
  const mode = pool.select('mode')
  const near = pool.num('near')
  const far = pool.num('far')
  const mapping = pool.select('mapping')
  const width = pool.num('width')
  pool.string('path')
  const path = parameters.find(p => p.definition.key === 'path')
  const amount = pool.num('amount')
  const angle = pool.num('angle')
  const span = pool.num('span')
  const offset = pool.num('offset')
  const flip = pool.select('flip')
  const colorA = pool.color('colorA')
  const colorB = pool.color('colorB')

  // Hooks before the fallback return, unconditionally.
  const a = colorA?.value ?? '#ffffff'
  const b = colorB?.value ?? '#ffffff'
  const flipped = (flip?.value ?? 0) >= 0.5
  const ramp = useMemo(() => {
    // 33 OKLCH stops is visually continuous at panel widths; the strip runs
    // A→B or B→A exactly as FLIP orders the stage's ramp.
    const stops = gradientStops(a, b, 33)
    const ordered = flipped ? [...stops].reverse() : stops
    return `linear-gradient(90deg, ${ordered.map((hex, i) => `${hex} ${(i / (ordered.length - 1)) * 100}%`).join(', ')})`
  }, [a, b, flipped])
  // The console lights with the blend itself: mid-ramp is the panel's accent.
  const accent = useMemo(() => gradientAccent(a, b), [a, b])

  if (!mode || !amount || !angle || !span || !offset || !flip || !colorA || !colorB) {
    return <ParameterList parameters={parameters} />
  }

  const byPosition = mode.value === 0
  const byPath = mode.value === 3 || mode.value === 4

  return (
    <Console accent={accent} testId="gradient-user-interface">
      {/* The ramp. Swatches sit ON its ends, the flip button between them.
          It stands where a preview window would - it IS the preview, and the
          input. */}
      <div className="px-3 pb-1 pt-3">
        <div
          data-testid="gradient-ramp"
          className="relative h-9 rounded-lg border border-[color-mix(in_srgb,var(--text)_15%,transparent)]"
          style={{ background: ramp }}
        >
          <div className="absolute inset-y-0 left-1.5 flex items-center">
            <StopSwatch bound={flipped ? colorB : colorA} label={flipped ? 'B' : 'A'} align="left" />
          </div>
          <div className="absolute inset-y-0 right-1.5 flex items-center">
            <StopSwatch bound={flipped ? colorA : colorB} label={flipped ? 'A' : 'B'} align="right" />
          </div>
          {/* The centering wrapper spans the whole ramp and sits over the stop
              swatches in stacking order - it must not swallow their clicks. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <button
              aria-label="Flip gradient direction"
              aria-pressed={flipped}
              title="Flip A ↔ B"
              onClick={() => flip.set(flipped ? 0 : 1)}
              className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--text)_25%,transparent)] bg-[color-mix(in_srgb,var(--bg-canvas-deep)_45%,transparent)] text-[var(--text)] backdrop-blur-sm hover:bg-[color-mix(in_srgb,var(--bg-canvas-deep)_60%,transparent)] active:scale-95"
            >
              <ArrowLeftRight size={10} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
        {/* APPLY BY: which axis the ramp spreads along - the world, or the
            chain's copy order. */}
        <label className="flex items-center justify-between text-xs text-[var(--text-3)]">Color by
          <select aria-label="Color by" className="rounded bg-[var(--bg-panel)] px-2 py-1 text-[var(--text)]" value={mode.value} onChange={e => mode.set(Number(e.target.value))}>
            {mode.def.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {mode.value === 2 && near && far && <ControlRow><Knob b={near} label="NEAR Z" /><Knob b={far} label="FAR Z" /></ControlRow>}
        {byPath && mapping && <Segmented b={mapping} name="Mapping" />}
        {byPath && mapping?.value === 1 && width && <Knob b={width} label="WIDTH" />}
        {byPath && path && <GradientPathEditor targetId={targetId} bound={path} curved={mode.value === 4} colorA={flipped ? b : a} colorB={flipped ? a : b} />}

        <ControlRow className="justify-between gap-1 px-1">
          {/* Position controls only affect the original planar mode. */}
          {byPosition && <div className="flex items-end gap-1">
            <Knob b={angle} label="ANGLE" ariaLabel="Gradient angle" suffix="°" format={(v) => v.toFixed(0)} />
            <Knob b={span} label="SPAN" ariaLabel="Gradient span in world units" />
            <Knob b={offset} label="OFFSET" ariaLabel="Gradient center offset" />
          </div>}
          <Knob b={amount} label="AMOUNT" ariaLabel="Gradient amount" large entry={percentEntry} format={(v) => `${Math.round(v * 100)}%`} />
        </ControlRow>

        <More parameters={pool.rest()} label="MORE" className="" />
      </div>
    </Console>
  )
}
