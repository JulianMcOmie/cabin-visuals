'use client'

// Bespoke settings for CircleGrid: a live glowing dot stage that mirrors
// rows x cols / spacing / dot size / hue, a 3x3 layout picker whose buttons are
// tiny dot-arrangement glyphs drawn from the actual layout ids, and a pill row
// for toggle mode. Presentation only - all writes go through the bound params,
// and unplaced keys fall through to a generic list at the bottom.

import type { ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const bind = (parameters: readonly UserInterfaceParameter[], key: string) =>
  parameters.find((p) => p.definition.key === key)

const num = (p: UserInterfaceParameter | undefined, fallback: number) =>
  typeof p?.value === 'number' ? p.value : fallback

const hash = (i: number) => {
  const x = Math.sin(i * 91.7 + 47.3) * 43758.5453
  return x - Math.floor(x)
}

/** Dot positions (24x24 viewBox) sketching each layout option. */
function layoutGlyphPoints(layout: number): Array<[number, number]> {
  const C = 12
  const pts: Array<[number, number]> = []
  switch (layout) {
    case 1: // Spiral
      for (let i = 0; i < 9; i++) {
        const a = i * 0.85
        const r = 1.5 + i * 1.05
        pts.push([C + Math.cos(a) * r, C + Math.sin(a) * r])
      }
      break
    case 2: // Fibonacci
      for (let i = 1; i <= 10; i++) {
        const a = i * 2.39996
        const r = 2.6 * Math.sqrt(i)
        pts.push([C + Math.cos(a) * r, C + Math.sin(a) * r])
      }
      break
    case 3: // Circle
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        pts.push([C + Math.cos(a) * 8, C + Math.sin(a) * 8])
      }
      break
    case 4: // Hexagon
      pts.push([C, C])
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        pts.push([C + Math.cos(a) * 8, C + Math.sin(a) * 8])
      }
      break
    case 5: // Wave
      for (let i = 0; i < 8; i++) pts.push([3 + i * 2.6, C + Math.sin(i * 1.05) * 4.5])
      break
    case 6: // Diamond
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const r = 8 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)))
        pts.push([C + Math.cos(a) * r, C + Math.sin(a) * r])
      }
      break
    case 7: // Star
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2
        const r = i % 2 === 0 ? 9 : 3.8
        pts.push([C + Math.cos(a) * r, C + Math.sin(a) * r])
      }
      break
    case 8: // Random
      for (let i = 0; i < 9; i++) pts.push([3 + hash(i) * 18, 3 + hash(i + 50) * 18])
      break
    default: // Grid
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) pts.push([5 + c * 7, 5 + r * 7])
  }
  return pts
}

function LayoutPicker({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? bound.value : definition.default
  return (
    <div className="grid grid-cols-3 gap-1">
      {definition.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-label={`${option.label} layout`}
            aria-pressed={active}
            title={option.label}
            onClick={() => bound.setValue(option.value)}
            className={`flex flex-col items-center gap-0.5 rounded border py-1.5 transition-colors cursor-pointer ${active
              ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)] text-[var(--text-2)]'
              : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
              {layoutGlyphPoints(option.value).map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={1.4} fill="currentColor" />
              ))}
            </svg>
            <span className="text-[7px] font-semibold tracking-[0.05em]">{option.label.toUpperCase()}</span>
          </button>
        )
      })}
    </div>
  )
}

function ToggleModePills({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? bound.value : definition.default
  return (
    <div className="flex flex-wrap gap-1">
      {definition.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-pressed={active}
            onClick={() => bound.setValue(option.value)}
            className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold tracking-[0.04em] transition-colors cursor-pointer ${active
              ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)] text-[var(--text-2)]'
              : 'border-[var(--border)] bg-transparent text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function DotStage({ rows, cols, spacing, dotSize, baseHue, hueRange }: {
  rows: number
  cols: number
  spacing: number
  dotSize: number
  baseHue: number
  hueRange: number
}) {
  const showRows = Math.min(Math.round(rows), 6)
  const showCols = Math.min(Math.round(cols), 9)
  const clipped = showRows < rows || showCols < cols
  const total = showRows * showCols
  const px = Math.max(3, Math.round(3 + dotSize * 5))
  const gap = Math.max(2, Math.round(spacing * 5))
  const dots: ReactNode[] = []
  for (let i = 0; i < total; i++) {
    const t = total <= 1 ? 0 : i / (total - 1) - 0.5
    const hue = ((baseHue + t * hueRange) * 360 + 360) % 360
    dots.push(
      <span
        key={i}
        className="rounded-full"
        style={{
          width: px,
          height: px,
          background: `hsl(${hue}, 75%, 62%)`,
          boxShadow: `0 0 ${px}px hsla(${hue}, 75%, 62%, 0.45)`,
        }}
      />,
    )
  }
  return (
    <div className="relative mb-4 flex h-[84px] items-center justify-center overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)]">
      <div
        className="grid place-items-center"
        style={{ gridTemplateColumns: `repeat(${showCols}, ${px}px)`, gap: `${gap}px` }}
      >
        {dots}
      </div>
      <span className="absolute right-1.5 top-1 font-mono text-[9px] tabular-nums text-[var(--text-muted)]">
        {Math.round(rows)}×{Math.round(cols)}{clipped ? '…' : ''}
      </span>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 flex select-none items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">
      <svg aria-hidden="true" viewBox="0 0 8 8" className="h-2 w-2 fill-current opacity-70">
        <circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" /><circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" />
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
  'rows', 'cols', 'spacing', 'dotSize', 'layout', 'toggleMode', 'baseHue', 'hueRange', 'rotationSpeed',
])

export const CircleGridUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const rows = bind(parameters, 'rows')
  const cols = bind(parameters, 'cols')
  const spacing = bind(parameters, 'spacing')
  const dotSize = bind(parameters, 'dotSize')
  const layout = bind(parameters, 'layout')
  const toggleMode = bind(parameters, 'toggleMode')
  const baseHue = bind(parameters, 'baseHue')
  const hueRange = bind(parameters, 'hueRange')
  const rotationSpeed = bind(parameters, 'rotationSpeed')

  return (
    <div data-testid="circle-grid-user-interface">
      <DotStage
        rows={num(rows, 4)}
        cols={num(cols, 4)}
        spacing={num(spacing, 1.5)}
        dotSize={num(dotSize, 1)}
        baseHue={num(baseHue, 0.55)}
        hueRange={num(hueRange, 0.2)}
      />

      <div className="mb-4">
        <SectionLabel>GRID</SectionLabel>
        <NumberRow bound={rows} />
        <NumberRow bound={cols} />
        <NumberRow bound={spacing} />
        <NumberRow bound={dotSize} />
      </div>

      {layout && (
        <div className="mb-4">
          <SectionLabel>LAYOUT</SectionLabel>
          <LayoutPicker bound={layout} />
        </div>
      )}

      {toggleMode && (
        <div className="mb-4">
          <SectionLabel>TOGGLE MODE</SectionLabel>
          <ToggleModePills bound={toggleMode} />
        </div>
      )}

      <div className="mb-1">
        <SectionLabel>COLOR &amp; SPIN</SectionLabel>
        <NumberRow bound={baseHue} />
        <NumberRow bound={hueRange} />
        <NumberRow bound={rotationSpeed} />
      </div>

      <ExtraParams parameters={parameters} placed={PLACED} />
    </div>
  )
}
