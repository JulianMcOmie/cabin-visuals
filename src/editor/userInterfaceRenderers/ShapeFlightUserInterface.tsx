'use client'

// Bespoke settings for ShapeFlight: segmented shape-mode tabs over a live
// spirograph/polygon/rose preview, then collapsible SHAPE / FLIGHT / COLOR /
// BURST sections (23 params want an accordion, not a wall), including a
// flight-path pad that bends Path Curve X/Y by dragging the trajectory's
// control point. Presentation only; unplaced keys fall through to a generic
// list at the bottom.

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const bind = (parameters: readonly UserInterfaceParameter[], key: string) =>
  parameters.find((p) => p.definition.key === key)

const num = (p: UserInterfaceParameter | undefined, fallback: number) =>
  typeof p?.value === 'number' ? p.value : fallback

function shapePath(mode: number, rBase: number, dBase: number): string {
  const cx = 70
  const cy = 40
  const pts: string[] = []
  if (mode === 1) {
    // Polygon
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2
      pts.push(`${(cx + Math.cos(a) * 28).toFixed(1)},${(cy + Math.sin(a) * 28).toFixed(1)}`)
    }
  } else if (mode === 2) {
    // Polar rose
    for (let i = 0; i <= 300; i++) {
      const t = (i / 300) * Math.PI * 2
      const r = 28 * Math.abs(Math.cos(2.5 * t))
      pts.push(`${(cx + Math.cos(t) * r).toFixed(1)},${(cy + Math.sin(t) * r).toFixed(1)}`)
    }
  } else {
    // Hypotrochoid from the live rBase / dBase
    const r = Math.max(0.05, rBase)
    const d = Math.max(0.05, dBase)
    const reach = (1 - r) + d * r
    const scale = 28 / Math.max(0.2, reach)
    for (let i = 0; i <= 700; i++) {
      const t = (i / 700) * Math.PI * 2 * 12
      const x = (1 - r) * Math.cos(t) + d * r * Math.cos(((1 - r) / r) * t)
      const y = (1 - r) * Math.sin(t) - d * r * Math.sin(((1 - r) / r) * t)
      pts.push(`${(cx + x * scale).toFixed(1)},${(cy + y * scale).toFixed(1)}`)
    }
  }
  return pts.join(' ')
}

function ShapePreview({ mode, rBase, dBase, hue, saturation, lightness, glow }: {
  mode: number
  rBase: number
  dBase: number
  hue: number
  saturation: number
  lightness: number
  glow: number
}) {
  const stroke = `hsl(${hue * 360}, ${saturation * 100}%, ${lightness * 100}%)`
  return (
    <div className="mb-2 overflow-hidden rounded-b border border-t-0 border-[var(--border)] bg-[var(--bg-app)]">
      <svg aria-hidden="true" viewBox="0 0 140 80" className="block h-[80px] w-full">
        <polyline points={shapePath(mode, rBase, dBase)} fill="none" stroke={stroke} strokeWidth="2.6" opacity={Math.min(0.5, 0.12 + glow * 0.1)} />
        <polyline points={shapePath(mode, rBase, dBase)} fill="none" stroke={stroke} strokeWidth="0.9" opacity="0.95" />
      </svg>
    </div>
  )
}

function ModeTabs({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? bound.value : definition.default
  return (
    <div className="grid grid-cols-3 overflow-hidden rounded-t border border-[var(--border)]">
      {definition.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-pressed={active}
            onClick={() => bound.setValue(option.value)}
            className={`border-r border-[var(--border)] py-1.5 text-[9px] font-semibold tracking-[0.05em] transition-colors last:border-r-0 cursor-pointer ${active
              ? 'bg-[var(--bg-elevated)] text-[var(--text-2)]'
              : 'bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
          >
            {option.label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

/** Drag the trajectory's control point to bend Path Curve X/Y together. */
function CurvePad({ x, y }: { x: UserInterfaceParameter; y: UserInterfaceParameter }) {
  const padRef = useRef<HTMLDivElement>(null)
  const xDef = x.definition
  const yDef = y.definition
  if (!isNumberParam(xDef) || !isNumberParam(yDef)) return null
  if (typeof x.value !== 'number' || typeof y.value !== 'number') return null

  const controlX = 100 + x.value * 4 // +-20 -> +-80 in viewBox units
  const controlY = 32 - y.value * 1.2 // +-20 -> +-24

  const setFromPointer = (clientX: number, clientY: number) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const vx = ((clientX - rect.left) / rect.width) * 200
    const vy = ((clientY - rect.top) / rect.height) * 64
    const snap = (raw: number, def: { min: number; max: number; step: number }) =>
      Math.max(def.min, Math.min(def.max, Math.round(raw / def.step) * def.step))
    x.setValue(snap((vx - 100) / 4, xDef))
    y.setValue(snap((32 - vy) / 1.2, yDef))
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    lockCursor('grabbing')
    setFromPointer(e.clientX, e.clientY)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => setFromPointer(ev.clientX, ev.clientY), { signal: controller.signal })
    window.addEventListener('pointerup', () => { controller.abort(); unlockCursor() }, { signal: controller.signal })
  }

  return (
    <div className="mb-[13px]">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] text-[var(--text-3)]">Path Curve</span>
        <span className="font-mono text-[9px] tabular-nums text-[var(--text-muted)]">
          X {x.value.toFixed(1)} · Y {y.value.toFixed(1)}
        </span>
      </div>
      <div
        ref={padRef}
        role="group"
        aria-label="Flight path curve"
        title="Drag to bend the flight path · double-click resets"
        onPointerDown={onPointerDown}
        onDoubleClick={() => { x.setValue(0); y.setValue(0) }}
        className="relative h-[64px] cursor-crosshair select-none overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)]"
      >
        <svg aria-hidden="true" viewBox="0 0 200 64" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <line x1="100" y1="0" x2="100" y2="64" stroke="var(--border)" strokeWidth="1" />
          <line x1="0" y1="32" x2="200" y2="32" stroke="var(--border)" strokeWidth="1" />
          <path
            d={`M 100 58 Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} 100 6`}
            fill="none"
            stroke="var(--accent-muted)"
            strokeWidth="2"
          />
          <circle cx="100" cy="58" r="2.5" fill="var(--text-muted)" />
          <circle cx="100" cy="6" r="1.6" fill="var(--text-muted)" />
        </svg>
        <span
          className="absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 border border-[var(--border-strong)] bg-[var(--text-2)]"
          style={{ left: `${(controlX / 200) * 100}%`, top: `${(controlY / 64) * 100}%` }}
        />
      </div>
    </div>
  )
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group mb-2 rounded border border-[var(--border)] bg-[var(--bg-panel)]">
      <summary className="flex cursor-pointer select-none list-none items-center justify-between px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)] [&::-webkit-details-marker]:hidden">
        {title}
        <svg aria-hidden="true" viewBox="0 0 8 8" className="h-2 w-2 fill-none stroke-current transition-transform group-open:rotate-90" strokeWidth="1.4">
          <path d="M2.5 1 L5.5 4 L2.5 7" />
        </svg>
      </summary>
      <div className="border-t border-[var(--border)] px-2 pb-0.5 pt-2.5">{children}</div>
    </details>
  )
}

function NumberRow({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const d = bound.definition
  if (!isNumberParam(d) || typeof bound.value !== 'number') return null
  return <ParamSlider label={d.label} value={bound.value} min={d.min} max={d.max} step={d.step} onChange={bound.setValue} />
}

function BurstModePills({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? bound.value : definition.default
  return (
    <div className="mb-[13px] grid grid-cols-2 gap-1">
      {definition.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-pressed={active}
            onClick={() => bound.setValue(option.value)}
            className={`truncate rounded border px-1.5 py-1 text-[9px] font-semibold tracking-[0.03em] transition-colors cursor-pointer ${active
              ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)] text-[var(--text-2)]'
              : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
            title={option.label}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
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
  'shapeMode', 'speed', 'spawnRate', 'scale', 'rotationStep', 'spread', 'farZ', 'shapeSize', 'fadeOutZ',
  'hueStep', 'baseHue', 'saturation', 'lightness', 'rBase', 'dBase', 'burstMode', 'burstRadius', 'burstTwists',
  'curveX', 'curveY', 'glowAmount', 'approachGrowth', 'lineWidth',
])

export const ShapeFlightUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const shapeMode = bind(parameters, 'shapeMode')
  const speed = bind(parameters, 'speed')
  const spawnRate = bind(parameters, 'spawnRate')
  const scale = bind(parameters, 'scale')
  const rotationStep = bind(parameters, 'rotationStep')
  const spread = bind(parameters, 'spread')
  const farZ = bind(parameters, 'farZ')
  const shapeSize = bind(parameters, 'shapeSize')
  const fadeOutZ = bind(parameters, 'fadeOutZ')
  const hueStep = bind(parameters, 'hueStep')
  const baseHue = bind(parameters, 'baseHue')
  const saturation = bind(parameters, 'saturation')
  const lightness = bind(parameters, 'lightness')
  const rBase = bind(parameters, 'rBase')
  const dBase = bind(parameters, 'dBase')
  const burstMode = bind(parameters, 'burstMode')
  const burstRadius = bind(parameters, 'burstRadius')
  const burstTwists = bind(parameters, 'burstTwists')
  const curveX = bind(parameters, 'curveX')
  const curveY = bind(parameters, 'curveY')
  const glowAmount = bind(parameters, 'glowAmount')
  const approachGrowth = bind(parameters, 'approachGrowth')
  const lineWidth = bind(parameters, 'lineWidth')

  return (
    <div data-testid="shape-flight-user-interface">
      {shapeMode && <ModeTabs bound={shapeMode} />}
      <ShapePreview
        mode={num(shapeMode, 0)}
        rBase={num(rBase, 0.25)}
        dBase={num(dBase, 0.7)}
        hue={num(baseHue, 0.55)}
        saturation={num(saturation, 1)}
        lightness={num(lightness, 0.55)}
        glow={num(glowAmount, 1)}
      />

      <Section title="SHAPE" defaultOpen>
        <NumberRow bound={shapeSize} />
        <NumberRow bound={scale} />
        <NumberRow bound={rBase} />
        <NumberRow bound={dBase} />
        <NumberRow bound={lineWidth} />
      </Section>

      <Section title="FLIGHT">
        {curveX && curveY && <CurvePad x={curveX} y={curveY} />}
        <NumberRow bound={speed} />
        <NumberRow bound={spawnRate} />
        <NumberRow bound={rotationStep} />
        <NumberRow bound={spread} />
        <NumberRow bound={farZ} />
        <NumberRow bound={fadeOutZ} />
        <NumberRow bound={approachGrowth} />
      </Section>

      <Section title="COLOR">
        <NumberRow bound={baseHue} />
        <NumberRow bound={hueStep} />
        <NumberRow bound={saturation} />
        <NumberRow bound={lightness} />
        <NumberRow bound={glowAmount} />
      </Section>

      <Section title="BURST">
        {burstMode && <BurstModePills bound={burstMode} />}
        <NumberRow bound={burstRadius} />
        <NumberRow bound={burstTwists} />
      </Section>

      <ExtraParams parameters={parameters} placed={PLACED} />
    </div>
  )
}
