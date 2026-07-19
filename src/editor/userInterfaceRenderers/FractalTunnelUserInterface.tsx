'use client'

// Bespoke settings for FractalTunnel: a live tunnel gauge (concentric polygons
// whose side count, ring count, twist, and hue ramp come straight from the
// bound params), notch-row steppers for the small discrete counts, and a PULSE
// section whose gated params (pulseSpeed / band / fade) only arrive from the
// host while Color Pulse is on. Presentation only; unplaced keys fall through
// to a generic list at the bottom.

import type { ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider, ParamToggle } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const bind = (parameters: readonly UserInterfaceParameter[], key: string) =>
  parameters.find((p) => p.definition.key === key)

const num = (p: UserInterfaceParameter | undefined, fallback: number) =>
  typeof p?.value === 'number' ? p.value : fallback

const str = (p: UserInterfaceParameter | undefined, fallback: string) =>
  typeof p?.value === 'string' ? p.value : fallback

function polygonPoints(cx: number, cy: number, radius: number, sides: number, rotation: number): string {
  const pts: string[] = []
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2 - Math.PI / 2
    pts.push(`${(cx + Math.cos(a) * radius).toFixed(2)},${(cy + Math.sin(a) * radius).toFixed(2)}`)
  }
  return pts.join(' ')
}

function TunnelGauge({ symmetry, generations, spiral, baseHue, hueShift, lineWidth, glow, bg }: {
  symmetry: number
  generations: number
  spiral: number
  baseHue: number
  hueShift: number
  lineWidth: number
  glow: number
  bg: string
}) {
  const sides = Math.max(2, Math.round(symmetry))
  const rings = Math.max(1, Math.round(generations)) * 2 + 2
  const cx = 70
  const cy = 45
  const shapes: ReactNode[] = []
  for (let i = 0; i < rings; i++) {
    const radius = 42 * Math.pow(0.78, i)
    const hue = (((baseHue + i * hueShift) % 1) + 1) % 1
    shapes.push(
      <polygon
        key={i}
        points={polygonPoints(cx, cy, radius, sides, i * spiral * 0.22)}
        fill="none"
        stroke={`hsl(${hue * 360}, 80%, ${55 + glow * 15}%)`}
        strokeWidth={Math.max(0.4, lineWidth * 0.28) * Math.pow(0.92, i)}
        opacity={0.9 - (i / rings) * 0.55}
      />,
    )
  }
  return (
    <div className="mb-4 overflow-hidden rounded border border-[var(--border)]" style={{ background: bg }}>
      <svg aria-hidden="true" viewBox="0 0 140 90" className="block h-[90px] w-full">
        {shapes}
        <circle cx={cx} cy={cy} r={0.9} fill={`hsl(${baseHue * 360}, 80%, 70%)`} />
      </svg>
    </div>
  )
}

/** Level-meter stepper for tiny integer ranges (1..5): click a notch to set. */
function NotchRow({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = Math.round(bound.value)
  const notches: ReactNode[] = []
  for (let v = definition.min; v <= definition.max; v += definition.step) {
    const filled = v <= value
    notches.push(
      <button
        key={v}
        aria-label={`${definition.label} ${v}`}
        aria-pressed={v === value}
        onClick={() => bound.setValue(v)}
        className={`h-[14px] flex-1 rounded-[2px] border transition-colors cursor-pointer ${filled
          ? 'border-[var(--accent-muted)] bg-[var(--accent-muted)]'
          : 'border-[var(--border)] bg-[var(--bg-app)] hover:bg-[var(--bg-elevated)]'}`}
      />,
    )
  }
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr_44px] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={definition.label}>{definition.label}</span>
      <div className="flex gap-1">{notches}</div>
      <span className="text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{value}</span>
    </div>
  )
}

function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="flex select-none items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">
        <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-none stroke-current opacity-70" strokeWidth="1">
          <circle cx="5" cy="5" r="4" /><circle cx="5" cy="5" r="1.6" />
        </svg>
        {children}
      </span>
      {aside}
    </div>
  )
}

function NumberRow({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const d = bound.definition
  if (!isNumberParam(d) || typeof bound.value !== 'number') return null
  return <ParamSlider label={d.label} value={bound.value} min={d.min} max={d.max} step={d.step} onChange={bound.setValue} />
}

function ColorRow({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound || typeof bound.value !== 'string') return null
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]">{bound.definition.label}</span>
      <div className="flex justify-end">
        <input
          type="color"
          aria-label={bound.definition.label}
          value={bound.value}
          onChange={(e) => bound.setValue(e.target.value)}
          className="h-5 w-8 flex-shrink-0 cursor-pointer rounded border border-[var(--border)] bg-transparent transition-transform active:scale-95"
        />
      </div>
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
  'symmetry', 'branchCount', 'generations', 'spiralAmount', 'lengthDecay', 'spreadAngle',
  'hueShift', 'baseHue', 'lineWidth', 'glowIntensity', 'bgColor',
  'colorPulse', 'pulseSpeed', 'pulseBandWidth', 'pulseFadeDuration',
])

export const FractalTunnelUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const symmetry = bind(parameters, 'symmetry')
  const branchCount = bind(parameters, 'branchCount')
  const generations = bind(parameters, 'generations')
  const spiralAmount = bind(parameters, 'spiralAmount')
  const lengthDecay = bind(parameters, 'lengthDecay')
  const spreadAngle = bind(parameters, 'spreadAngle')
  const hueShift = bind(parameters, 'hueShift')
  const baseHue = bind(parameters, 'baseHue')
  const lineWidth = bind(parameters, 'lineWidth')
  const glowIntensity = bind(parameters, 'glowIntensity')
  const bgColor = bind(parameters, 'bgColor')
  const colorPulse = bind(parameters, 'colorPulse')
  const pulseSpeed = bind(parameters, 'pulseSpeed') // gated: only present while colorPulse is on
  const pulseBandWidth = bind(parameters, 'pulseBandWidth')
  const pulseFadeDuration = bind(parameters, 'pulseFadeDuration')

  const pulseOn = num(colorPulse, 0) >= 0.5

  return (
    <div data-testid="fractal-tunnel-user-interface">
      <TunnelGauge
        symmetry={num(symmetry, 6)}
        generations={num(generations, 3)}
        spiral={num(spiralAmount, 0.9)}
        baseHue={num(baseHue, 0.48)}
        hueShift={num(hueShift, 0.09)}
        lineWidth={num(lineWidth, 4)}
        glow={num(glowIntensity, 0.9)}
        bg={str(bgColor, '#050508')}
      />

      <div className="mb-4">
        <SectionLabel>STRUCTURE</SectionLabel>
        <NumberRow bound={symmetry} />
        <NotchRow bound={branchCount} />
        <NotchRow bound={generations} />
      </div>

      <div className="mb-4">
        <SectionLabel>SPIRAL</SectionLabel>
        <NumberRow bound={spiralAmount} />
        <NumberRow bound={lengthDecay} />
        <NumberRow bound={spreadAngle} />
      </div>

      <div className="mb-4">
        <SectionLabel>COLOR</SectionLabel>
        <NumberRow bound={baseHue} />
        <NumberRow bound={hueShift} />
        <NumberRow bound={glowIntensity} />
        <NumberRow bound={lineWidth} />
        <ColorRow bound={bgColor} />
      </div>

      {colorPulse && (
        <div className="mb-1">
          <SectionLabel aside={<ParamToggle on={pulseOn} onChange={(v) => colorPulse.setValue(v ? 1 : 0)} label="Color Pulse" />}>
            PULSE
          </SectionLabel>
          {pulseOn && (
            <>
              <NumberRow bound={pulseSpeed} />
              <NumberRow bound={pulseBandWidth} />
              <NumberRow bound={pulseFadeDuration} />
            </>
          )}
        </div>
      )}

      <ExtraParams parameters={parameters} placed={PLACED} />
    </div>
  )
}
