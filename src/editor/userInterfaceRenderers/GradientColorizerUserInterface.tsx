'use client'

// Bespoke settings for the Gradient colorizer, borrowing Figma's gradient
// editor as the mental model: the hero is the RAMP ITSELF - a strip drawn from
// the definition's own gradientStops(), with the two stop swatches sitting ON
// its ends and a flip button between them. What the strip shows is byte-for-
// byte what the stage samples, because both call the same function.
//
// Below the ramp, the placement console: a segmented APPLY BY (position /
// copy index) and the guide's laser knobs for ANGLE / SPAN / OFFSET / AMOUNT.
// The position knobs stay visible but dimmed in index mode - the layout
// holds still, and the dimming says "currently without effect" (the shared
// ColorWheelPill idiom) rather than hiding the controls.
//
// Presentation only: every control routes through the passed parameter
// bindings, never the stores.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, RotateCcw } from 'lucide-react'
import {
  GRADIENT_MODE_INDEX,
  GRADIENT_MODE_POSITION,
  gradientStops,
} from '../core/visualCopies/gradientColorizer'
import { isNumberParam, type NumberParamDef, type SelectParamDef } from '../instruments/types'
import { ColorWheelPopover } from './colorWheel'
import { LaserKnob } from './laserKnob'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

interface NumBinding { def: NumberParamDef; value: number; set: (v: number) => void }
interface SelectBinding { def: SelectParamDef; value: number; set: (v: number) => void }
interface ColorBinding { value: string; set: (v: string) => void }

function bind(parameters: readonly UserInterfaceParameter[]) {
  const pool = new Map(parameters.map((p) => [p.definition.key, p]))
  return {
    num(key: string): NumBinding | null {
      const b = pool.get(key)
      if (!b || !isNumberParam(b.definition) || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    select(key: string): SelectBinding | null {
      const b = pool.get(key)
      if (!b || b.definition.type !== 'select' || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    color(key: string): ColorBinding | null {
      const b = pool.get(key)
      if (!b || b.definition.type !== 'color' || typeof b.value !== 'string') return null
      pool.delete(key)
      return { value: b.value, set: b.setValue }
    },
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

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
        className="h-5 w-5 cursor-pointer rounded-full border-2 border-white/85 shadow-[0_1px_4px_rgba(0,0,0,.6)] transition-transform active:scale-95"
        style={{ background: bound.value }}
      />
      {/* Below the swatch: the stops sit at the very top of the panel, so an
          upward popover would be clipped against the inspector's edge. */}
      {open && <ColorWheelPopover value={bound.value} onChange={bound.set} align={align} edge="bottom" testId={`gradient-wheel-${label.toLowerCase()}`} />}
    </div>
  )
}

function GradientGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
      <defs>
        <linearGradient id="gradient-glyph-ramp" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <rect x="2" y="4" width="16" height="12" rx="2.5" fill="url(#gradient-glyph-ramp)" />
    </svg>
  )
}

export const GradientColorizerUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bind(parameters)
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
  const rest = pool.rest()

  const byPosition = mode.value !== GRADIENT_MODE_INDEX
  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  return (
    <section
      data-testid="gradient-user-interface"
      // No overflow-hidden (unlike the Radial chassis): the stop swatches'
      // color wheels must escape the panel; nothing else reaches the corners.
      className="-mx-1 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_14px_34px_rgba(0,0,0,.35)]"
    >
      <header className="flex h-9 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]" style={{ color: accent }}>
            <GradientGlyph />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text)]">Gradient</span>
        </div>
        <button
          aria-label="Reset all Gradient parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-2)]"
        >
          <RotateCcw size={11} />
        </button>
      </header>

      {/* The ramp. Swatches sit ON its ends, the flip button between them. */}
      <div className="px-2.5 pb-1 pt-0.5">
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
              className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white/85 backdrop-blur-sm transition-transform hover:bg-black/60 active:scale-95"
            >
              <ArrowLeftRight size={10} />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2 p-2">
        {/* APPLY BY: which axis the ramp spreads along - the world, or the
            chain's copy order. */}
        <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
          {mode.def.options.map((option) => {
            const active = option.value === mode.value
            return (
              <button
                key={option.value}
                aria-pressed={active}
                title={option.value === GRADIENT_MODE_INDEX
                  ? 'Spread the ramp over the chain\'s copies: first copy = A, last = B'
                  : 'Paint by world position: an axis, a length, a center'}
                onClick={() => mode.set(option.value)}
                className={`flex-1 py-1 text-[9px] font-semibold uppercase tracking-[0.1em] transition-colors ${active
                  ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
                  : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-2)]'}`}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-end justify-between px-1">
          {/* Dimmed, not hidden, in index mode: still editable, currently
              without effect - and the panel doesn't reflow on a mode switch. */}
          <div className={`flex gap-1 transition-opacity ${byPosition ? '' : 'opacity-40'}`}>
            <LaserKnob
              value={angle.value} min={angle.def.min} max={angle.def.max} step={angle.def.step}
              defaultValue={angle.def.default} curve={angle.def.curve} label="ANGLE"
              ariaLabel="Gradient angle" accent={accent} suffix="°"
              format={(v) => v.toFixed(0)} onChange={angle.set}
            />
            <LaserKnob
              value={span.value} min={span.def.min} max={span.def.max} step={span.def.step}
              defaultValue={span.def.default} curve={span.def.curve} label="SPAN"
              ariaLabel="Gradient span in world units" accent={accent} onChange={span.set}
            />
            <LaserKnob
              value={offset.value} min={offset.def.min} max={offset.def.max} step={offset.def.step}
              defaultValue={offset.def.default} curve={offset.def.curve} label="OFFSET"
              ariaLabel="Gradient center offset" accent={accent} onChange={offset.set}
            />
          </div>
          <LaserKnob
            value={amount.value} min={amount.def.min} max={amount.def.max} step={amount.def.step}
            defaultValue={amount.def.default} curve={amount.def.curve} label="AMOUNT"
            ariaLabel="Gradient amount" accent={accent} large
            format={(v) => `${Math.round(v * 100)}%`} onChange={amount.set}
          />
        </div>

        {rest.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] pt-2">
            <ParameterList parameters={rest} />
          </div>
        )}
      </div>
    </section>
  )
}
