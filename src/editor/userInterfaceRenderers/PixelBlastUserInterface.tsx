'use client'

// Bespoke settings for Pixel Blast, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console) while
// keeping its own control vocabulary: everything square, everything stepped,
// because that is what the instrument renders (the guide's "the panel should
// look like what it controls"). Numeric params are chunky cell meters - the
// 8-bit answer to a knob - the blink toggle is a square pixel switch, and the
// six baked pitch palettes are shown as swatch strips. The old card groups
// became gutter-labelled sections; the header went (identity lives on the tab
// rail).

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PALETTES } from '../instruments/PixelBlast'
import {
  bindPanel,
  Console,
  More,
  ParameterList,
  withAlpha,
  type BooleanBinding,
  type NumBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** The instrument's declared identity (PixelBlast.tsx `identityColor`). */
const ACCENT = '#ff3d81'

const CELLS = 14

/** A stepped cell meter - the 8-bit answer to a slider. Click or drag across the
 *  cells; the value snaps to the param's own step. Double-click resets. */
function PixelMeter({ b }: { b: NumBinding | null }) {
  const trackRef = useRef<HTMLDivElement>(null)
  if (!b) return null
  const { def, value, set } = b
  const frac = (value - def.min) / (def.max - def.min)
  const filled = Math.round(frac * CELLS)

  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = def.min + t * (def.max - def.min)
    set(Math.max(def.min, Math.min(def.max, Number((def.min + Math.round((raw - def.min) / def.step) * def.step).toFixed(4)))))
  }

  const decimals = def.step < 1 ? 2 : 0
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-baseline justify-between select-none">
        <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/40" title={def.label}>{def.label}</span>
        <span className="font-mono text-[9px] tabular-nums text-white/70">{value.toFixed(decimals)}</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        title="Click or drag · double-click to reset"
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromClientX(event.clientX)
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromClientX(event.clientX)
        }}
        onDoubleClick={() => set(def.default)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); set(Math.max(def.min, Number((value - def.step).toFixed(4)))) }
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); set(Math.min(def.max, Number((value + def.step).toFixed(4)))) }
        }}
        className="flex h-[11px] cursor-pointer touch-none gap-[2px] outline-none focus-visible:ring-1 focus-visible:ring-white/50"
      >
        {Array.from({ length: CELLS }, (_, index) => (
          <span
            key={index}
            className="h-full flex-1"
            style={{ background: index < filled ? withAlpha(ACCENT, 0.75) : 'rgba(255,255,255,0.08)' }}
          />
        ))}
      </div>
    </div>
  )
}

/** Square pixel switch: a filled block when on, hollow when off. */
function PixelSwitch({ b }: { b: BooleanBinding | null }) {
  if (!b) return null
  const on = b.value >= 0.5
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="text-[8px] font-semibold uppercase tracking-[0.12em] text-white/40 select-none">{b.def.label}</span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={b.def.label}
        onClick={() => b.set(on ? 0 : 1)}
        className="flex h-[16px] w-[16px] items-center justify-center border active:scale-90 cursor-pointer"
        style={on
          ? { borderColor: withAlpha(ACCENT, 0.8), background: withAlpha(ACCENT, 0.14) }
          : { borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)' }}
      >
        {on && <span className="h-[8px] w-[8px]" style={{ background: withAlpha(ACCENT, 0.85) }} />}
      </button>
    </div>
  )
}

/** A gutter-labelled section in the meters' own full-width idiom. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-3 pt-2">
      <p className="mb-1.5 text-[7px] font-bold uppercase tracking-[0.22em] text-white/25 select-none">{title}</p>
      {children}
    </div>
  )
}

export const PixelBlastUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const speed = b.num('speed')
  const count = b.num('count')
  const flashScale = b.num('flashScale')
  const sizeScale = b.num('sizeScale')
  const life = b.num('life')
  const blinkOut = b.boolean('blinkOut')
  const pixelSize = b.num('pixelSize')
  const spreadX = b.num('spreadX')
  const spreadY = b.num('spreadY')
  const gravity = b.num('gravity')

  if (!speed || !count || !pixelSize) return <ParameterList parameters={parameters} />

  return (
    <Console accent={ACCENT} testId="pixel-blast-user-interface">
      {/* The six baked palettes, keyed by pitch class, ARE this instrument's
          face - they stand where a preview window would. Reference, not a
          control. */}
      <div className="border-b border-white/[0.06] bg-[#05070c] px-3 pb-2 pt-2.5">
        <div className="grid grid-cols-6 gap-1">
          {PALETTES.map((palette, index) => (
            <div key={index} className="flex flex-col gap-px" title={`Palette ${index + 1} · pitch classes ${index} and ${index + 6}`}>
              {palette.map((hex) => (
                <span key={hex} className="h-[5px] w-full" style={{ background: hex }} />
              ))}
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[8px] leading-3 text-white/30">pitch class picks the palette · octave picks the row</p>
      </div>

      <Section title="Blast">
        <PixelMeter b={speed} />
        <PixelMeter b={count} />
        <PixelMeter b={flashScale} />
        <PixelMeter b={sizeScale} />
      </Section>

      <Section title="Life">
        <PixelMeter b={life} />
        <PixelSwitch b={blinkOut} />
      </Section>

      <Section title="Grid + Spread">
        <div className="mb-2 flex items-center gap-2">
          {/* live pixel-size preview cell */}
          {pixelSize && (
            <span
              aria-hidden="true"
              className="flex-shrink-0"
              style={{
                background: withAlpha(ACCENT, 0.75),
                width: `${4 + ((pixelSize.value - pixelSize.def.min) / (pixelSize.def.max - pixelSize.def.min)) * 10}px`,
                height: `${4 + ((pixelSize.value - pixelSize.def.min) / (pixelSize.def.max - pixelSize.def.min)) * 10}px`,
              }}
            />
          )}
          <span className="text-[8px] uppercase tracking-[0.1em] text-white/30 select-none">one grid cell</span>
        </div>
        <PixelMeter b={pixelSize} />
        <PixelMeter b={spreadX} />
        <PixelMeter b={spreadY} />
        <PixelMeter b={gravity} />
      </Section>

      <More parameters={b.rest()} label="MORE" className="px-3 pb-3 pt-1" />
    </Console>
  )
}
