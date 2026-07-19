'use client'

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { PALETTES } from '../instruments/PixelBlast'
import { ParamControl } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Pixel Blast, styled like the instrument renders: everything
// square, everything stepped. Numeric params are chunky cell meters (a row of
// discrete pixels instead of a smooth track), the blink toggle is a square pixel
// switch, and the six baked pitch palettes are shown as swatch strips. Groups:
// BLAST (power), LIFE (timing), GRID + SPREAD (layout).
// Presentation only - every control routes through the passed parameter bindings.

interface NumBinding { def: NumberParamDef; value: number; set: (v: number) => void }

function bind(parameters: readonly UserInterfaceParameter[]) {
  const pool = new Map(parameters.map((p) => [p.definition.key, p]))
  return {
    num(key: string): NumBinding | null {
      const b = pool.get(key)
      if (!b || !isNumberParam(b.definition) || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    bool(key: string): { label: string; on: boolean; set: (v: number) => void } | null {
      const b = pool.get(key)
      if (!b || b.definition.type !== 'boolean' || typeof b.value !== 'number') return null
      pool.delete(key)
      return { label: b.definition.label, on: b.value >= 0.5, set: b.setValue }
    },
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

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
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]" title={def.label}>{def.label}</span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{value.toFixed(decimals)}</span>
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
        className="flex h-[11px] cursor-pointer touch-none gap-[2px] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        {Array.from({ length: CELLS }, (_, index) => (
          <span
            key={index}
            className={`h-full flex-1 ${index < filled ? 'bg-[var(--accent-muted)]' : 'bg-[var(--border)]'}`}
          />
        ))}
      </div>
    </div>
  )
}

/** Square pixel switch: a filled block when on, hollow when off. */
function PixelSwitch({ label, on, set }: { label: string; on: boolean; set: (v: number) => void }) {
  return (
    <div className="mb-2.5 flex items-center justify-between">
      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)] select-none">{label}</span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => set(on ? 0 : 1)}
        className={`flex h-[16px] w-[16px] items-center justify-center border transition-colors active:scale-90 cursor-pointer ${on
          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]'
          : 'border-[var(--border-strong)] bg-[var(--bg-app)]'}`}
      >
        {on && <span className="h-[8px] w-[8px] bg-[var(--accent-muted)]" />}
      </button>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-2.5 border border-[var(--border)] bg-[var(--bg-app)] p-2.5 pb-0.5">
      <p className="mb-2 text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] select-none">{title}</p>
      {children}
    </div>
  )
}

/** 8-bit blast glyph - a scatter of squares around a hollow core. */
function BlastGlyph() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" className="fill-current">
      <rect x="6.5" y="6.5" width="3" height="3" className="fill-none stroke-current" strokeWidth="1.2" />
      <rect x="7" y="1" width="2" height="2" /><rect x="7" y="13" width="2" height="2" />
      <rect x="1" y="7" width="2" height="2" /><rect x="13" y="7" width="2" height="2" />
      <rect x="2.5" y="2.5" width="2" height="2" /><rect x="11.5" y="11.5" width="2" height="2" />
      <rect x="11.5" y="2.5" width="2" height="2" /><rect x="2.5" y="11.5" width="2" height="2" />
    </svg>
  )
}

export const PixelBlastUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bind(parameters)
  const speed = b.num('speed')
  const count = b.num('count')
  const flashScale = b.num('flashScale')
  const sizeScale = b.num('sizeScale')
  const life = b.num('life')
  const blinkOut = b.bool('blinkOut')
  const pixelSize = b.num('pixelSize')
  const spreadX = b.num('spreadX')
  const spreadY = b.num('spreadY')
  const gravity = b.num('gravity')
  const rest = b.rest()

  return (
    <section data-testid="pixel-blast-user-interface" className="mb-4">
      <header className="mb-2.5 flex items-center justify-between select-none">
        <div className="flex items-center gap-2 text-[var(--accent)]">
          <BlastGlyph />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">Pixel Blast</span>
        </div>
        {/* checkerboard flourish */}
        <svg aria-hidden="true" width="24" height="8" viewBox="0 0 24 8" className="fill-[var(--border-strong)]">
          <rect x="0" y="0" width="4" height="4" /><rect x="8" y="0" width="4" height="4" /><rect x="16" y="0" width="4" height="4" />
          <rect x="4" y="4" width="4" height="4" /><rect x="12" y="4" width="4" height="4" /><rect x="20" y="4" width="4" height="4" />
        </svg>
      </header>

      <Panel title="Blast">
        <PixelMeter b={speed} />
        <PixelMeter b={count} />
        <PixelMeter b={flashScale} />
        <PixelMeter b={sizeScale} />
      </Panel>

      <Panel title="Life">
        <PixelMeter b={life} />
        {blinkOut && <PixelSwitch label={blinkOut.label} on={blinkOut.on} set={blinkOut.set} />}
      </Panel>

      <Panel title="Grid + Spread">
        <div className="mb-2 flex items-center gap-2">
          {/* live pixel-size preview cell */}
          {pixelSize && (
            <span
              aria-hidden="true"
              className="flex-shrink-0 bg-[var(--accent-muted)]"
              style={{
                width: `${4 + ((pixelSize.value - pixelSize.def.min) / (pixelSize.def.max - pixelSize.def.min)) * 10}px`,
                height: `${4 + ((pixelSize.value - pixelSize.def.min) / (pixelSize.def.max - pixelSize.def.min)) * 10}px`,
              }}
            />
          )}
          <span className="text-[8px] uppercase tracking-[0.1em] text-[var(--text-muted)] select-none">one grid cell</span>
        </div>
        <PixelMeter b={pixelSize} />
        <PixelMeter b={spreadX} />
        <PixelMeter b={spreadY} />
        <PixelMeter b={gravity} />
      </Panel>

      {/* The six baked palettes, keyed by pitch class - reference, not a control. */}
      <div className="mb-2.5 border border-[var(--border)] bg-[var(--bg-app)] p-2.5">
        <p className="mb-1.5 text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] select-none">Pitch Palettes</p>
        <div className="grid grid-cols-6 gap-1">
          {PALETTES.map((palette, index) => (
            <div key={index} className="flex flex-col gap-px" title={`Palette ${index + 1} · pitch classes ${index} and ${index + 6}`}>
              {palette.map((hex) => (
                <span key={hex} className="h-[5px] w-full" style={{ background: hex }} />
              ))}
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[8px] leading-3 text-[var(--text-muted)]">pitch class picks the palette · octave picks the row</p>
      </div>

      {rest.length > 0 && (
        <div className="border-t border-[var(--border)] pt-3">
          {rest.map((p) => {
            const numeric = typeof p.value === 'number'
            return (
              <ParamControl
                key={p.definition.key}
                param={p.definition}
                numValue={numeric ? (p.value as number) : undefined}
                strValue={numeric ? undefined : (p.value as string)}
                onNum={p.setValue}
                onStr={p.setValue}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
