'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Hexagon Dots. The instrument only has two knobs, so the
// panel goes big instead of dense: a live ring preview (six dots on the hexagon,
// sized by Dot Size, slowly orbiting at a rate tied to Dot Speed) above two wide
// lane sliders with hexagonal thumbs - DRIFT for approach speed, DOT for size.
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
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
// One hue per dot - the instrument cycles rainbow hues per ring; the preview
// shows a representative spread.
const DOT_HUES = [0, 55, 110, 180, 250, 310]

function frac(b: NumBinding): number {
  return (b.value - b.def.min) / (b.def.max - b.def.min)
}

/** The ring preview: hexagon guide + six dots, orbiting at a Dot Speed-ish rate. */
function RingPreview({ speed, size }: { speed: NumBinding | null; size: NumBinding | null }) {
  const speedFrac = speed ? frac(speed) : 0.35
  const sizeFrac = size ? frac(size) : 0.25
  const dotRadius = 3 + sizeFrac * 8
  const spinSeconds = 26 - speedFrac * 22 // faster param -> faster orbit
  const vertices = DOT_HUES.map((hueDeg, index) => {
    const angle = (index / 6) * Math.PI * 2 - Math.PI / 2
    return { hueDeg, x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 34 }
  })
  return (
    <div data-testid="hexagon-dots-preview" className="relative mb-3 flex h-[128px] items-center justify-center overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)]">
      <style>{`@keyframes hexagon-dots-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <svg aria-hidden="true" width="112" height="112" viewBox="0 0 100 100" className="overflow-visible">
        {/* static hexagon guide */}
        <polygon
          points={vertices.map((v) => `${v.x},${v.y}`).join(' ')}
          className="fill-none stroke-[var(--border-strong)]"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        {/* orbiting dots */}
        <g style={{ transformOrigin: '50px 50px', animation: `hexagon-dots-orbit ${spinSeconds.toFixed(1)}s linear infinite` }}>
          {vertices.map((v) => (
            <circle key={v.hueDeg} cx={v.x} cy={v.y} r={dotRadius} style={{ fill: `hsl(${v.hueDeg} 85% 62%)` }} />
          ))}
        </g>
      </svg>
      <span className="absolute bottom-1 right-1.5 text-[8px] tracking-[0.06em] text-[var(--text-muted)] select-none">drifts toward camera</span>
    </div>
  )
}

/** A wide lane slider with a hexagonal thumb and tick marks. */
function LaneSlider({ b, title, hint }: { b: NumBinding | null; title: string; hint: string }) {
  const trackRef = useRef<HTMLDivElement>(null)
  if (!b) return null
  const { def, value, set } = b
  const pct = ((value - def.min) / (def.max - def.min)) * 100

  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = def.min + t * (def.max - def.min)
    set(Math.max(def.min, Math.min(def.max, Number((def.min + Math.round((raw - def.min) / def.step) * def.step).toFixed(4)))))
  }

  return (
    <div className="mb-3.5">
      <div className="mb-1 flex items-baseline justify-between select-none">
        <span className="text-[9px] font-semibold tracking-[0.14em] text-[var(--text-3)]">{title}</span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{value.toFixed(2)}</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        title="Drag · double-click to reset"
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
        className="relative h-[22px] cursor-pointer touch-none rounded border border-[var(--border)] bg-[var(--bg-app)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        {/* fill */}
        <div className="absolute inset-y-0 left-0 rounded-l bg-[color-mix(in_srgb,var(--accent-muted)_30%,transparent)]" style={{ width: `${pct}%` }} />
        {/* ticks */}
        {[20, 40, 60, 80].map((tick) => (
          <span key={tick} className="absolute top-1/2 h-[8px] w-px -translate-y-1/2 bg-[var(--border-strong)]" style={{ left: `${tick}%` }} />
        ))}
        {/* hexagonal thumb */}
        <span
          className="absolute top-1/2 h-[16px] w-[14px] -translate-x-1/2 -translate-y-1/2 bg-[var(--text-2)]"
          style={{ left: `calc(${Math.max(3, Math.min(97, pct))}%)`, clipPath: HEX_CLIP }}
        />
      </div>
      <p className="mt-1 text-[9px] text-[var(--text-muted)] select-none">{hint}</p>
    </div>
  )
}

export const HexagonDotsUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bind(parameters)
  const dotSpeed = b.num('dotSpeed')
  const dotSize = b.num('dotSize')
  const rest = b.rest()

  return (
    <section data-testid="hexagon-dots-user-interface" className="mb-4">
      <header className="mb-2.5 flex items-center gap-2 select-none">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" className="fill-none stroke-[var(--accent)]" strokeWidth="1.3">
          <polygon points="8,1.5 13.6,4.75 13.6,11.25 8,14.5 2.4,11.25 2.4,4.75" />
          <circle cx="8" cy="1.5" r="1.2" className="fill-current stroke-none" />
          <circle cx="13.6" cy="11.25" r="1.2" className="fill-current stroke-none" />
          <circle cx="2.4" cy="11.25" r="1.2" className="fill-current stroke-none" />
        </svg>
        <span className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">HEXAGON DOTS</span>
      </header>

      <RingPreview speed={dotSpeed} size={dotSize} />

      <LaneSlider b={dotSpeed} title="DRIFT" hint="how fast each ring closes in on the camera" />
      <LaneSlider b={dotSize} title="DOT" hint="radius of the six dots on the ring" />

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
