'use client'

// Bespoke settings for NeonPolar: a live rose-curve preview drawn in the neon
// color (with a blurred glow pass), a dual-handle RADIUS range that drags min
// and max on one shared axis, then CURVE / GLOW / MOTION groups. Presentation
// only; unplaced keys fall through to a generic list at the bottom.

import { useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const bind = (parameters: readonly UserInterfaceParameter[], key: string) =>
  parameters.find((p) => p.definition.key === key)

const num = (p: UserInterfaceParameter | undefined, fallback: number) =>
  typeof p?.value === 'number' ? p.value : fallback

const str = (p: UserInterfaceParameter | undefined, fallback: string) =>
  typeof p?.value === 'string' ? p.value : fallback

function RosePreview({ cycles, complexity, minRadius, maxRadius, color, opacity, lineWidth }: {
  cycles: number
  complexity: number
  minRadius: number
  maxRadius: number
  color: string
  opacity: number
  lineWidth: number
}) {
  const glowId = useId()
  // Map the radius window onto the 0..34px preview radius (shared -3..10 axis).
  const toR = (v: number) => ((v + 3) / 13) * 34
  const lo = Math.min(toR(minRadius), toR(maxRadius))
  const hi = Math.max(toR(minRadius), toR(maxRadius))
  const mid = (lo + hi) / 2
  const amp = (hi - lo) / 2
  const k = Math.max(1, Math.round(cycles))
  const points: string[] = []
  const steps = 240
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2
    const r = Math.abs(mid + amp * Math.sin(k * theta * complexity))
    points.push(`${(80 + Math.cos(theta) * r).toFixed(1)},${(44 + Math.sin(theta) * r).toFixed(1)}`)
  }
  const path = points.join(' ')
  const width = Math.max(0.6, lineWidth * 0.7)
  return (
    <div className="mb-4 overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)]">
      <svg aria-hidden="true" viewBox="0 0 160 88" className="block h-[88px] w-full">
        <defs>
          <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
        </defs>
        <polyline points={path} fill="none" stroke={color} strokeWidth={width * 2.4} opacity={opacity * 0.45} filter={`url(#${glowId})`} />
        <polyline points={path} fill="none" stroke={color} strokeWidth={width} opacity={opacity} strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** Min and max radius as two square handles on one shared -3..10 axis. */
function RadiusRange({ minBound, maxBound }: { minBound: UserInterfaceParameter; maxBound: UserInterfaceParameter }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<'min' | 'max' | null>(null)
  const minDef = minBound.definition
  const maxDef = maxBound.definition
  if (!isNumberParam(minDef) || !isNumberParam(maxDef)) return null
  if (typeof minBound.value !== 'number' || typeof maxBound.value !== 'number') return null

  const lo = minDef.min // -3
  const hi = maxDef.max // 10
  const span = hi - lo
  const minPct = ((minBound.value - lo) / span) * 100
  const maxPct = ((maxBound.value - lo) / span) * 100

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    const which = activeRef.current
    if (!el || !which) return
    const rect = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = lo + t * span
    if (which === 'min') {
      const snapped = Math.round(raw / minDef.step) * minDef.step
      minBound.setValue(Math.max(minDef.min, Math.min(minDef.max, snapped)))
    } else {
      const snapped = Math.round(raw / maxDef.step) * maxDef.step
      maxBound.setValue(Math.max(maxDef.min, Math.min(maxDef.max, snapped)))
    }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const raw = lo + t * span
    activeRef.current =
      Math.abs(raw - (minBound.value as number)) <= Math.abs(raw - (maxBound.value as number)) ? 'min' : 'max'
    lockCursor('grabbing')
    setFromClientX(e.clientX)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => setFromClientX(ev.clientX), { signal: controller.signal })
    window.addEventListener('pointerup', () => { controller.abort(); activeRef.current = null; unlockCursor() }, { signal: controller.signal })
  }

  return (
    <div className="mb-[13px]">
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        role="group"
        aria-label="Radius range"
        className="relative h-[3px] cursor-pointer select-none bg-[var(--border)]"
      >
        <div
          className="absolute top-0 h-full bg-[var(--accent-muted)]"
          style={{ left: `${Math.min(minPct, maxPct)}%`, width: `${Math.abs(maxPct - minPct)}%` }}
        />
        <div
          className="absolute top-1/2 h-[9px] w-[9px] -translate-y-1/2 border border-[var(--border-strong)] bg-[var(--text-2)]"
          style={{ left: `calc(${minPct}% - 4px)` }}
          title={`Min Radius ${minBound.value.toFixed(1)}`}
        />
        <div
          className="absolute top-1/2 h-[9px] w-[9px] -translate-y-1/2 rotate-45 border border-[var(--border-strong)] bg-[var(--text-2)]"
          style={{ left: `calc(${maxPct}% - 4px)` }}
          title={`Max Radius ${maxBound.value.toFixed(1)}`}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9px] tabular-nums text-[var(--text-muted)]">
        <span>MIN {minBound.value.toFixed(1)}</span>
        <span>MAX {maxBound.value.toFixed(1)}</span>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 flex select-none items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">
      <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-none stroke-current opacity-70" strokeWidth="1">
        <path d="M5 5 C 7 2, 9 4, 8 6 C 7 8, 3 8, 2 6 C 1 3, 4 1, 5 5" />
      </svg>
      {children}
    </p>
  )
}

function NumberRow({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const d = bound.definition
  if (!isNumberParam(d) || typeof bound.value !== 'number') return null
  return <ParamSlider label={d.label} value={bound.value} min={d.min} max={d.max} step={d.step} onChange={bound.setValue} />
}

function ExtraParams({ parameters, placed }: { parameters: readonly UserInterfaceParameter[]; placed: ReadonlySet<string> }) {
  const rest = parameters.filter((p) => !placed.has(p.definition.key))
  if (rest.length === 0) return null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      {rest.map((p) => (
        <ParamControl
          key={p.definition.key}
          param={p.definition}
          numValue={typeof p.value === 'number' ? p.value : undefined}
          strValue={typeof p.value === 'string' ? p.value : undefined}
          onNum={p.setValue}
          onStr={p.setValue}
        />
      ))}
    </div>
  )
}

const PLACED = new Set(['speed', 'complexity', 'lineWidth', 'cycles', 'minRadius', 'maxRadius', 'color', 'opacity'])

export const NeonPolarUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const speed = bind(parameters, 'speed')
  const complexity = bind(parameters, 'complexity')
  const lineWidth = bind(parameters, 'lineWidth')
  const cycles = bind(parameters, 'cycles')
  const minRadius = bind(parameters, 'minRadius')
  const maxRadius = bind(parameters, 'maxRadius')
  const color = bind(parameters, 'color')
  const opacity = bind(parameters, 'opacity')

  const neon = str(color, '#d4a843')

  return (
    <div data-testid="neon-polar-user-interface">
      <RosePreview
        cycles={num(cycles, 8)}
        complexity={num(complexity, 1)}
        minRadius={num(minRadius, 0)}
        maxRadius={num(maxRadius, 4)}
        color={neon}
        opacity={num(opacity, 0.75)}
        lineWidth={num(lineWidth, 1.5)}
      />

      {minRadius && maxRadius && (
        <div className="mb-4">
          <SectionLabel>RADIUS</SectionLabel>
          <RadiusRange minBound={minRadius} maxBound={maxRadius} />
        </div>
      )}

      <div className="mb-4">
        <SectionLabel>CURVE</SectionLabel>
        <NumberRow bound={cycles} />
        <NumberRow bound={complexity} />
      </div>

      <div className="mb-4">
        <SectionLabel>GLOW</SectionLabel>
        {color && typeof color.value === 'string' && (
          <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
            <span className="truncate text-[11px] text-[var(--text-3)]">{color.definition.label}</span>
            <div className="flex items-center justify-end gap-2">
              <span className="font-mono text-[9px] text-[var(--text-muted)]">{color.value}</span>
              <span className="relative h-5 w-8 flex-shrink-0 cursor-pointer overflow-hidden rounded border border-[var(--border)]" style={{ background: color.value, boxShadow: `0 0 10px ${color.value}55` }}>
                <input
                  type="color"
                  aria-label="Curve color"
                  value={color.value}
                  onChange={(e) => color.setValue(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </span>
            </div>
          </div>
        )}
        <NumberRow bound={opacity} />
        <NumberRow bound={lineWidth} />
      </div>

      <div className="mb-1">
        <SectionLabel>MOTION</SectionLabel>
        <NumberRow bound={speed} />
      </div>

      <ExtraParams parameters={parameters} placed={PLACED} />
    </div>
  )
}
