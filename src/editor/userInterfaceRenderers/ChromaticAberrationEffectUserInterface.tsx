'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Chromatic aberration settings: a black swatch where a lens glyph splits into
// live R/G/B ghost copies — red pushed along the fringe direction, blue pulled
// opposite, exactly like the shader. Drag anywhere in the swatch to set both
// params at once (direction = angle, distance = offset); fine-tune sliders sit
// below.

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const TAU = Math.PI * 2

type NumberBound = { definition: NumberParamDef; value: number; setValue: (value: number | string) => void }

function findNumber(parameters: readonly UserInterfaceParameter[], key: string): NumberBound | null {
  const bound = parameters.find((p) => p.definition.key === key)
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  return bound as NumberBound
}

function snap(raw: number, d: NumberParamDef): number {
  return clamp(d.min + Math.round((raw - d.min) / d.step) * d.step, d.min, d.max)
}

/** The lens glyph: a ring, an inner dot, and a crosshair — enough edges for the fringe to read. */
function LensGlyph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 48 48" className="h-9 w-9" aria-hidden="true">
      <circle cx="24" cy="24" r="15" fill="none" stroke={color} strokeWidth="2.5" />
      <circle cx="24" cy="24" r="4" fill={color} />
      <path d="M24 3v8M24 37v8M3 24h8M37 24h8" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function FringePad({ offset, angle }: { offset: NumberBound; angle: NumberBound }) {
  const padRef = useRef<HTMLDivElement>(null)
  const od = offset.definition
  const ad = angle.definition
  // Map offset 0..max onto 0..MAX_PX of on-screen separation.
  const MAX_PX = 26
  const k = od.max > 0 ? (offset.value / od.max) * MAX_PX : 0
  // Screen y grows downward; show the angle as counter-clockwise-positive like a math axis.
  const dx = Math.cos(angle.value) * k
  const dy = -Math.sin(angle.value) * k

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = event.clientX - (rect.left + rect.width / 2)
    const py = event.clientY - (rect.top + rect.height / 2)
    const dist = Math.hypot(px, py)
    offset.setValue(snap((clamp(dist, 0, MAX_PX + 14) / MAX_PX) * od.max, od))
    if (dist > 3) {
      const theta = ((Math.atan2(-py, px) % TAU) + TAU) % TAU
      angle.setValue(snap(Math.min(theta, ad.max), ad))
    }
  }

  return (
    <div
      ref={padRef}
      data-testid="chromatic-fringe-pad"
      role="group"
      aria-label="Fringe direction and amount"
      title="Drag to aim and strengthen the fringe · double-click to reset"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      onDoubleClick={() => { offset.setValue(od.default); angle.setValue(ad.default) }}
      className="relative h-[88px] cursor-crosshair touch-none select-none overflow-hidden rounded-[3px] border border-[var(--border)] bg-black"
    >
      {/* faint direction ray from center */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-0 border-t border-dashed border-white/20"
        style={{
          width: `${(k * 1.7).toFixed(1)}px`,
          transform: `rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)}deg)`,
          transformOrigin: '0 50%',
        }}
      />
      {/* R pushed along the direction, B pulled opposite, G in place — screen-blended like light */}
      <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, mixBlendMode: 'screen' }}>
        <LensGlyph color="#ff2b2b" />
      </div>
      <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(calc(-50% - ${dx}px), calc(-50% - ${dy}px))`, mixBlendMode: 'screen' }}>
        <LensGlyph color="#2b5bff" />
      </div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ mixBlendMode: 'screen' }}>
        <LensGlyph color="#2bff5b" />
      </div>
      <span className="absolute bottom-1 left-1.5 font-mono text-[7px] text-white/35">OFF {offset.value.toFixed(3)}</span>
      <span className="absolute bottom-1 right-1.5 font-mono text-[7px] text-white/35">{Math.round((angle.value * 180) / Math.PI)}°</span>
    </div>
  )
}

/** ParamSlider twin with a 3-decimal readout — the offset range is 0..0.1, so
 *  the stock 2-decimal display would flatten every useful value to 0.00/0.01. */
function FineSlider({ bound }: { bound: NumberBound }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const d = bound.definition
  const pct = ((bound.value - d.min) / (d.max - d.min)) * 100

  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = clamp((clientX - rect.left) / rect.width, 0, 1)
    bound.setValue(snap(d.min + t * (d.max - d.min), d))
  }

  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr_44px] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={d.label}>{d.label}</span>
      <div
        ref={trackRef}
        role="slider"
        aria-label={d.label}
        aria-valuemin={d.min}
        aria-valuemax={d.max}
        aria-valuenow={bound.value}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromClientX(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromClientX(event.clientX)
        }}
        className="relative h-[3px] cursor-pointer touch-none select-none bg-[var(--border)]"
      >
        <div className="absolute left-0 top-0 h-full bg-[var(--accent-muted)]" style={{ width: `${pct}%` }} />
        <div
          className="absolute top-1/2 h-[9px] w-[9px] -translate-y-1/2 border border-[var(--border-strong)] bg-[var(--text-2)]"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{bound.value.toFixed(3)}</span>
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

export const ChromaticAberrationEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const offset = findNumber(parameters, 'offset')
  const angle = findNumber(parameters, 'angle')
  if (!offset || !angle) return <ParameterList parameters={parameters} />

  return (
    <section data-testid="chromatic-aberration-effect-user-interface">
      <div className="mb-2.5">
        <FringePad offset={offset} angle={angle} />
      </div>
      <FineSlider bound={offset} />
      <ParamSlider
        label={angle.definition.label}
        value={angle.value}
        min={angle.definition.min}
        max={angle.definition.max}
        step={angle.definition.step}
        onChange={angle.setValue}
      />
      <Leftovers parameters={parameters} placed={['offset', 'angle']} />
    </section>
  )
}
