'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Pixelate settings: a live mosaic swatch — an accent gradient quantized into a
// true checker grid whose cell size IS the pixel-size param (drag across it to
// coarsen/refine), a chunky notched slider underneath, and power-of-two preset
// chips for the classic retro sizes.

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

type NumberBound = { definition: NumberParamDef; value: number; setValue: (value: number | string) => void }

function findNumber(parameters: readonly UserInterfaceParameter[], key: string): NumberBound | null {
  const bound = parameters.find((p) => p.definition.key === key)
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  return bound as NumberBound
}

function snap(raw: number, d: NumberParamDef): number {
  return clamp(d.min + Math.round((raw - d.min) / d.step) * d.step, d.min, d.max)
}

function MosaicSwatch({ pixelSize }: { pixelSize: NumberBound }) {
  const swatchRef = useRef<HTMLDivElement>(null)
  const d = pixelSize.definition
  const cell = Math.round(clamp(pixelSize.value, 2, 64))

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = swatchRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    pixelSize.setValue(snap(d.min + t * (d.max - d.min), d))
  }

  return (
    <div
      ref={swatchRef}
      data-testid="pixelate-swatch"
      role="slider"
      tabIndex={0}
      aria-label={d.label}
      aria-valuemin={d.min}
      aria-valuemax={d.max}
      aria-valuenow={pixelSize.value}
      title="Drag across to change pixel size · double-click to reset"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      onDoubleClick={() => pixelSize.setValue(d.default)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        pixelSize.setValue(snap(pixelSize.value + (event.key === 'ArrowRight' ? d.step : -d.step), d))
      }}
      className="relative h-[72px] cursor-ew-resize touch-none select-none overflow-hidden rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)] outline-none focus-visible:border-[var(--accent)]"
    >
      {/* the "image": a soft accent gradient blob */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(circle at 32% 40%, var(--accent) 0%, var(--accent-muted) 34%, var(--bg-canvas) 78%)', opacity: 0.75 }}
      />
      {/* quantization: checker at the exact cell size + gridlines at cell pitch */}
      <div
        className="absolute inset-0"
        style={{
          background: 'repeating-conic-gradient(rgba(0,0,0,.28) 0% 25%, transparent 0% 50%)',
          backgroundSize: `${cell * 2}px ${cell * 2}px`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(rgba(0,0,0,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.4) 1px, transparent 1px)',
          backgroundSize: `${cell}px ${cell}px`,
        }}
      />
      <span className="absolute bottom-1 right-1.5 rounded-[2px] bg-[rgba(0,0,0,.55)] px-1 font-mono text-[9px] tabular-nums text-[var(--text-2)]">
        {cell} px
      </span>
    </div>
  )
}

/** Chunky stepped slider: tall notched track, fill quantized into blocks. */
function ChunkySlider({ pixelSize }: { pixelSize: NumberBound }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const d = pixelSize.definition
  const pct = ((pixelSize.value - d.min) / (d.max - d.min)) * 100

  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = clamp((clientX - rect.left) / rect.width, 0, 1)
    pixelSize.setValue(snap(d.min + t * (d.max - d.min), d))
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={d.label}
      aria-valuemin={d.min}
      aria-valuemax={d.max}
      aria-valuenow={pixelSize.value}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromClientX(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromClientX(event.clientX)
      }}
      className="relative mt-1.5 h-[16px] cursor-pointer touch-none select-none overflow-hidden rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)]"
    >
      {/* blocky fill: hard cells, no smooth ramp — the control speaks pixel */}
      <div
        className="absolute left-0 top-0 h-full"
        style={{
          width: `${pct}%`,
          background: 'repeating-linear-gradient(90deg, var(--accent-muted) 0 6px, rgba(0,0,0,.35) 6px 8px)',
        }}
      />
      <div
        className="absolute top-0 h-full w-[5px] border-x border-[var(--border-strong)] bg-[var(--text-2)]"
        style={{ left: `calc(${pct}% - 2px)` }}
      />
    </div>
  )
}

function PresetChips({ pixelSize }: { pixelSize: NumberBound }) {
  const d = pixelSize.definition
  const current = Math.round(pixelSize.value)
  return (
    <div className="mt-1.5 grid grid-cols-5 gap-1">
      {[4, 8, 16, 32, 64].map((size) => {
        const active = current === size
        return (
          <button
            key={size}
            aria-label={`Pixel size ${size}`}
            aria-pressed={active}
            onClick={() => pixelSize.setValue(clamp(size, d.min, d.max))}
            className={`cursor-pointer rounded-[3px] border py-1 font-mono text-[9px] tabular-nums transition-all active:scale-95 ${active
              ? 'border-[var(--accent-muted)] bg-[var(--accent-muted)]/20 text-[var(--text-2)]'
              : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
          >
            {size}
          </button>
        )
      })}
    </div>
  )
}

function Leftovers({ parameters, placed }: { parameters: readonly UserInterfaceParameter[]; placed: readonly string[] }) {
  const placedSet = new Set(placed)
  const rest = parameters.filter((p) => !placedSet.has(p.definition.key))
  if (rest.length === 0) return null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
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
  )
}

export const PixelateEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pixelSize = findNumber(parameters, 'pixelSize')
  if (!pixelSize) return <ParameterList parameters={parameters} />

  return (
    <section data-testid="pixelate-effect-user-interface">
      <MosaicSwatch pixelSize={pixelSize} />
      <ChunkySlider pixelSize={pixelSize} />
      <PresetChips pixelSize={pixelSize} />
      <Leftovers parameters={parameters} placed={['pixelSize']} />
    </section>
  )
}
