'use client'

// Bespoke settings for HopfFibration: a nested-tori emblem (ellipse count,
// fan-out, and stroke weights read from the live params), a LAYERS group of
// sliders, a MOTION group rendered as three side-by-side vertical faders
// (twist / drift / flow - the only vertical faders in the app, fitting the
// fibration's axis feel), and a RENDER group. Presentation only; unplaced keys
// fall through to a generic list at the bottom.

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const bind = (parameters: readonly UserInterfaceParameter[], key: string) =>
  parameters.find((p) => p.definition.key === key)

const num = (p: UserInterfaceParameter | undefined, fallback: number) =>
  typeof p?.value === 'number' ? p.value : fallback

function ToriEmblem({ fibers, spread, coreWidth, glowWidth }: {
  fibers: number
  spread: number
  coreWidth: number
  glowWidth: number
}) {
  const count = Math.max(3, Math.min(9, Math.round(fibers * 0.5)))
  const rings: ReactNode[] = []
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0 : i / (count - 1) - 0.5
    const angle = t * spread * 70
    const hue = 200 + t * 90
    rings.push(
      <g key={i} transform={`rotate(${angle.toFixed(1)} 70 40)`}>
        <ellipse cx="70" cy="40" rx="46" ry="15" fill="none" stroke={`hsl(${hue}, 65%, 60%)`} strokeWidth={Math.max(1, glowWidth * 0.28)} opacity="0.12" />
        <ellipse cx="70" cy="40" rx="46" ry="15" fill="none" stroke={`hsl(${hue}, 65%, 62%)`} strokeWidth={Math.max(0.5, coreWidth * 0.35)} opacity="0.75" />
      </g>,
    )
  }
  return (
    <div className="mb-4 overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)]">
      <svg aria-hidden="true" viewBox="0 0 140 80" className="block h-[80px] w-full">{rings}</svg>
    </div>
  )
}

/** Vertical micro-fader: drag up/down, double-click resets to default. */
function VFader({ bound, caption }: { bound: UserInterfaceParameter | undefined; caption: string }) {
  const trackRef = useRef<HTMLDivElement>(null)
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = bound.value
  const pct = ((value - definition.min) / (definition.max - definition.min)) * 100

  const setFromClientY = (clientY: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (rect.bottom - clientY) / rect.height))
    const raw = definition.min + t * (definition.max - definition.min)
    const snapped = Math.round(raw / definition.step) * definition.step
    bound.setValue(Math.max(definition.min, Math.min(definition.max, Number(snapped.toFixed(8)))))
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    lockCursor('ns-resize')
    setFromClientY(e.clientY)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => setFromClientY(ev.clientY), { signal: controller.signal })
    window.addEventListener('pointerup', () => { controller.abort(); unlockCursor() }, { signal: controller.signal })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div
        ref={trackRef}
        role="slider"
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title={`${definition.label} - drag vertically, double-click to reset`}
        onPointerDown={onPointerDown}
        onDoubleClick={() => bound.setValue(definition.default)}
        className="relative h-[72px] w-[22px] cursor-ns-resize select-none rounded-[2px] border border-[var(--border)] bg-[var(--bg-app)]"
      >
        <div className="absolute inset-x-0 bottom-0 rounded-[1px] bg-[var(--accent-muted)]" style={{ height: `${pct}%` }} />
        <div className="absolute inset-x-[-2px] h-[3px] bg-[var(--text-2)]" style={{ bottom: `calc(${pct}% - 1px)` }} />
      </div>
      <span className="select-none text-[8px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">{caption}</span>
      <span className="font-mono text-[9px] tabular-nums text-[var(--text-3)]">{value.toFixed(2)}</span>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 flex select-none items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">
      <svg aria-hidden="true" viewBox="0 0 12 8" className="h-2 w-3 fill-none stroke-current opacity-70" strokeWidth="1">
        <ellipse cx="6" cy="4" rx="5" ry="2.6" />
        <ellipse cx="6" cy="4" rx="5" ry="2.6" transform="rotate(50 6 4)" />
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

const PLACED = new Set([
  'coreWidth', 'glowWidth', 'projScale', 'maxDist', 'driftSpeed', 'rotationSpeed',
  'pointsPerFiber', 'fibersPerLayer', 'flowSpeed', 'thetaSpread',
])

export const HopfFibrationUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const coreWidth = bind(parameters, 'coreWidth')
  const glowWidth = bind(parameters, 'glowWidth')
  const projScale = bind(parameters, 'projScale')
  const maxDist = bind(parameters, 'maxDist')
  const driftSpeed = bind(parameters, 'driftSpeed')
  const rotationSpeed = bind(parameters, 'rotationSpeed')
  const pointsPerFiber = bind(parameters, 'pointsPerFiber')
  const fibersPerLayer = bind(parameters, 'fibersPerLayer')
  const flowSpeed = bind(parameters, 'flowSpeed')
  const thetaSpread = bind(parameters, 'thetaSpread')

  return (
    <div data-testid="hopf-fibration-user-interface">
      <ToriEmblem
        fibers={num(fibersPerLayer, 10)}
        spread={num(thetaSpread, 0.9)}
        coreWidth={num(coreWidth, 2.5)}
        glowWidth={num(glowWidth, 8)}
      />

      <div className="mb-4">
        <SectionLabel>LAYERS</SectionLabel>
        <NumberRow bound={fibersPerLayer} />
        <NumberRow bound={pointsPerFiber} />
        <NumberRow bound={thetaSpread} />
        <NumberRow bound={maxDist} />
      </div>

      <div className="mb-4">
        <SectionLabel>MOTION</SectionLabel>
        <div className="flex items-start justify-between gap-2 rounded border border-[var(--border)] bg-[var(--bg-panel)] px-3 pb-2 pt-3">
          <VFader bound={rotationSpeed} caption="TWIST" />
          <VFader bound={driftSpeed} caption="DRIFT" />
          <VFader bound={flowSpeed} caption="FLOW" />
        </div>
      </div>

      <div className="mb-1">
        <SectionLabel>RENDER</SectionLabel>
        <NumberRow bound={coreWidth} />
        <NumberRow bound={glowWidth} />
        <NumberRow bound={projScale} />
      </div>

      <ExtraParams parameters={parameters} placed={PLACED} />
    </div>
  )
}
