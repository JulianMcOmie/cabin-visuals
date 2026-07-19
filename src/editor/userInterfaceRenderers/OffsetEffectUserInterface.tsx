'use client'

import { RotateCcw } from 'lucide-react'
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Offset settings: a crosshair XY drag pad (the offset IS a position, so you
// place it) with a bipolar Z rail alongside — depth reads as a vertical send
// fader filling away from center. Mono readouts + reset underneath.

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

function OffsetPad({ x, y }: { x: NumberBound; y: NumberBound }) {
  const padRef = useRef<HTMLDivElement>(null)
  const xd = x.definition
  const yd = y.definition
  const xPct = ((x.value - xd.min) / (xd.max - xd.min)) * 100
  const yPct = 100 - ((y.value - yd.min) / (yd.max - yd.min)) * 100

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const nx = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const ny = clamp((event.clientY - rect.top) / rect.height, 0, 1)
    x.setValue(snap(xd.min + nx * (xd.max - xd.min), xd))
    y.setValue(snap(yd.max - ny * (yd.max - yd.min), yd))
  }

  return (
    <div
      ref={padRef}
      data-testid="offset-xy-pad"
      role="group"
      aria-label="Offset X and Y"
      title="Drag to offset · double-click to recenter"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      onDoubleClick={() => { x.setValue(xd.default); y.setValue(yd.default) }}
      className="relative h-[96px] cursor-crosshair touch-none select-none overflow-hidden rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)]"
      style={{
        backgroundImage: 'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
        backgroundSize: '20% 20%',
        backgroundPosition: 'center center',
      }}
    >
      {/* center crosshair — origin is home, the pad measures displacement from it */}
      <span className="absolute left-1/2 top-0 h-full w-px bg-[var(--border-strong)]" />
      <span className="absolute left-0 top-1/2 h-px w-full bg-[var(--border-strong)]" />
      {/* displacement vector: origin → current offset */}
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full">
        <line x1="50%" y1="50%" x2={`${xPct}%`} y2={`${yPct}%`} stroke="var(--accent-muted)" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
      <span
        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--text-2)] bg-[var(--accent)] shadow-[0_0_10px_rgba(53,167,230,.55)]"
        style={{ left: `${xPct}%`, top: `${yPct}%` }}
      />
      <span className="absolute bottom-1 left-1.5 font-mono text-[7px] text-[var(--text-muted)]">X {x.value.toFixed(1)}</span>
      <span className="absolute right-1.5 top-1 font-mono text-[7px] text-[var(--text-muted)]">Y {y.value.toFixed(1)}</span>
    </div>
  )
}

/** Vertical bipolar depth rail: fill grows away from the center detent. */
function ZRail({ z }: { z: NumberBound }) {
  const railRef = useRef<HTMLDivElement>(null)
  const d = z.definition
  const pct = ((z.value - d.min) / (d.max - d.min)) * 100
  const centerPct = ((0 - d.min) / (d.max - d.min)) * 100

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
    z.setValue(snap(d.min + t * (d.max - d.min), d))
  }

  const fillBottom = Math.min(pct, centerPct)
  const fillTop = Math.max(pct, centerPct)

  return (
    <div className="flex h-[96px] w-[26px] flex-col items-center">
      <div
        ref={railRef}
        role="slider"
        tabIndex={0}
        aria-label="Offset Z"
        aria-valuemin={d.min}
        aria-valuemax={d.max}
        aria-valuenow={z.value}
        aria-orientation="vertical"
        title="Drag for depth · double-click to recenter"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
        }}
        onDoubleClick={() => z.setValue(d.default)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          z.setValue(snap(z.value + (event.key === 'ArrowUp' ? d.step : -d.step), d))
        }}
        className="relative h-full w-[10px] cursor-ns-resize touch-none select-none rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)] outline-none focus-visible:border-[var(--accent)]"
      >
        <span className="absolute left-0 h-px w-full bg-[var(--border-strong)]" style={{ bottom: `${centerPct}%` }} />
        <span
          className="absolute left-[2px] right-[2px] bg-[var(--accent-muted)]"
          style={{ bottom: `${fillBottom}%`, top: `${100 - fillTop}%` }}
        />
        <span
          className="absolute left-[-3px] h-[3px] w-[14px] rounded-[1px] bg-[var(--text-2)] shadow-[0_1px_3px_rgba(0,0,0,.5)]"
          style={{ bottom: `calc(${pct}% - 1px)` }}
        />
      </div>
      <span className="mt-1 text-[7px] font-semibold tracking-[0.1em] text-[var(--text-muted)] select-none">Z</span>
    </div>
  )
}

function Readout({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-1 items-baseline justify-center gap-1 rounded-[3px] border border-[var(--border)] bg-[var(--bg-app)] py-1">
      <span className="text-[8px] font-semibold tracking-[0.1em] text-[var(--text-muted)] select-none">{label}</span>
      <span className="font-mono text-[10px] tabular-nums text-[var(--text-2)]">{value.toFixed(1)}</span>
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

export const OffsetEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const x = findNumber(parameters, 'x')
  const y = findNumber(parameters, 'y')
  const z = findNumber(parameters, 'z')
  if (!x || !y || !z) return <ParameterList parameters={parameters} />

  return (
    <section data-testid="offset-effect-user-interface">
      <div className="flex gap-1.5">
        <div className="min-w-0 flex-1"><OffsetPad x={x} y={y} /></div>
        <ZRail z={z} />
      </div>
      <div className="mt-1.5 flex items-stretch gap-1.5">
        <Readout label="X" value={x.value} />
        <Readout label="Y" value={y.value} />
        <Readout label="Z" value={z.value} />
        <button
          aria-label="Reset offset"
          title="Reset offset"
          onClick={() => { x.setValue(x.definition.default); y.setValue(y.definition.default); z.setValue(z.definition.default) }}
          className="flex w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-all hover:text-[var(--text-2)] active:scale-90"
        >
          <RotateCcw size={10} />
        </button>
      </div>
      <Leftovers parameters={parameters} placed={['x', 'y', 'z']} />
    </section>
  )
}
