'use client'

// Bespoke settings for the Gradient colorizer, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console),
// borrowing Figma's gradient editor as the mental model: the hero is the RAMP
// ITSELF - a strip drawn from the definition's own gradientStops(), with the
// two stop swatches sitting ON its ends and a flip button between them. What
// the strip shows is byte-for-byte what the stage samples, because both call
// the same function.
//
// Below the ramp, the placement console: a segmented APPLY BY (position /
// copy index) and the kit knobs for ANGLE / SPAN / OFFSET / AMOUNT. The
// position knobs stay visible but dimmed in index mode - the layout holds
// still, and the dimming says "currently without effect" (the shared
// ColorWheelPill idiom) rather than hiding the controls.
//
// The accent is DERIVED: mid-ramp of the current blend, so the console lights
// with the gradient itself (the same spirit as accent-follows-color-param).

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import {
  GRADIENT_MODE_INDEX,
  gradientStops,
} from '../core/visualCopies/gradientColorizer'
import {
  bindPanel,
  ColorWheelPopover,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  Segmented,
  type ColorBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** One gradient stop: a round swatch anchored to an end of the ramp, opening
 *  the shared color wheel. Open state + outside-click close follow the
 *  ColorWheelPill idiom (the pill itself brings its own caption layout, which
 *  the ramp's ends have no room for). */
function StopSwatch({ bound, label, align }: {
  bound: ColorBinding
  label: string
  align: 'left' | 'right'
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    window.addEventListener('pointerdown', (event) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false)
    }, { signal: controller.signal, capture: true })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false)
    }, { signal: controller.signal })
    return () => controller.abort()
  }, [open])

  return (
    <div ref={hostRef} className="relative">
      <button
        data-testid={`gradient-stop-${label.toLowerCase()}`}
        aria-label={`Gradient color ${label}`}
        aria-expanded={open}
        title={`Color ${label} · ${bound.value}`}
        onClick={() => setOpen((o) => !o)}
        className="h-5 w-5 cursor-pointer rounded-full border-2 border-white/85 shadow-[0_1px_4px_rgba(0,0,0,.6)] active:scale-95"
        style={{ background: bound.value }}
      />
      {/* Below the swatch: the stops sit at the very top of the panel, so an
          upward popover would be clipped against the inspector's edge. */}
      {open && <ColorWheelPopover value={bound.value} onChange={bound.set} align={align} edge="bottom" testId={`gradient-wheel-${label.toLowerCase()}`} />}
    </div>
  )
}

export const GradientColorizerUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bindPanel(parameters)
  const mode = pool.select('mode')
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
  const accent = useMemo(() => gradientStops(a, b, 3)[1], [a, b])

  if (!mode || !amount || !angle || !span || !offset || !flip || !colorA || !colorB) {
    return <ParameterList parameters={parameters} />
  }

  const byPosition = mode.value !== GRADIENT_MODE_INDEX

  return (
    <Console accent={accent} testId="gradient-user-interface">
      {/* The ramp. Swatches sit ON its ends, the flip button between them.
          It stands where a preview window would - it IS the preview, and the
          input. */}
      <div className="px-3 pb-1 pt-3">
        <div
          data-testid="gradient-ramp"
          className="relative h-9 rounded-lg border border-white/15"
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
              className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white/85 backdrop-blur-sm hover:bg-black/60 active:scale-95"
            >
              <ArrowLeftRight size={10} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
        {/* APPLY BY: which axis the ramp spreads along - the world, or the
            chain's copy order. */}
        <Segmented b={mode} name="Apply by" />

        <ControlRow className="justify-between gap-1 px-1">
          {/* Dimmed, not hidden, in index mode: still editable, currently
              without effect - and the panel doesn't reflow on a mode switch. */}
          <div className={`flex items-end gap-1 transition-opacity ${byPosition ? '' : 'opacity-40'}`}>
            <Knob b={angle} label="ANGLE" ariaLabel="Gradient angle" suffix="°" format={(v) => v.toFixed(0)} />
            <Knob b={span} label="SPAN" ariaLabel="Gradient span in world units" />
            <Knob b={offset} label="OFFSET" ariaLabel="Gradient center offset" />
          </div>
          <Knob b={amount} label="AMOUNT" ariaLabel="Gradient amount" large format={(v) => `${Math.round(v * 100)}%`} />
        </ControlRow>

        <More parameters={pool.rest()} label="MORE" className="" />
      </div>
    </Console>
  )
}
