'use client'

import type { ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Paddle Bounce settings: a live Pong court diagram (aspect, paddle proportions,
// ball size, trail and colors all track their params) above per-fixture groups -
// each group's header carries the color chip for the thing it shapes, and the
// smash count is a segmented OFF/1x/2x/3x control instead of a slider.

function find(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((p) => p.definition.key === key)
}

function num(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function str(bound: UserInterfaceParameter | undefined, fallback: string): string {
  return typeof bound?.value === 'string' ? bound.value : fallback
}

function SliderRow({ bound, label }: { bound?: UserInterfaceParameter; label?: string }) {
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const d = bound.definition
  return <ParamSlider label={label ?? d.label} value={bound.value} min={d.min} max={d.max} step={d.step} onChange={bound.setValue} />
}

function ChipInput({ bound, label }: { bound?: UserInterfaceParameter; label: string }) {
  if (!bound || typeof bound.value !== 'string') return null
  return (
    <label className="relative h-[16px] w-7 flex-shrink-0 cursor-pointer overflow-hidden rounded-[2px] border border-[var(--border-strong)]" style={{ background: bound.value }} title={`${label}: ${bound.value}`}>
      <input
        type="color"
        aria-label={label}
        value={bound.value}
        onChange={(e) => bound.setValue(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  )
}

/** Group card: label + optional color chip in the header, controls below. */
function Fixture({ label, chip, children }: { label: string; chip?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-2 rounded-[3px] border border-[var(--border)] bg-[var(--bg-panel)] px-2 pt-1.5 pb-0.5">
      <div className="mb-2 flex h-4 items-center justify-between">
        <span className="text-[9px] font-semibold tracking-[0.09em] text-[var(--text-muted)] select-none">{label}</span>
        {chip}
      </div>
      {children}
    </div>
  )
}

function CourtDiagram({
  courtW, courtH, ballSize, paddleH, paddleW, trailMax, trailSpacing,
  ballColor, paddleColor, courtColor,
}: {
  courtW: number; courtH: number; ballSize: number; paddleH: number; paddleW: number
  trailMax: number; trailSpacing: number
  ballColor: string; paddleColor: string; courtColor: string
}) {
  const vw = 220
  const vh = Math.max(64, Math.min(150, (vw * courtH) / Math.max(0.001, courtW)))
  const m = 6 // court margin inside the viewBox
  const innerW = vw - m * 2
  const innerH = vh - m * 2
  const pw = Math.max(2, (paddleW / Math.max(0.001, courtW)) * innerW)
  const ph = Math.max(6, (paddleH / Math.max(0.001, courtH)) * innerH)
  const r = Math.max(1.5, (ballSize / Math.max(0.001, courtW)) * innerW)
  const bx = m + innerW * 0.62
  const by = m + innerH * 0.38
  const ghosts = Math.min(6, Math.max(0, Math.round(trailMax)))
  const gap = 4 + trailSpacing * 90

  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      role="img"
      aria-label="Court preview"
      className="mb-2 w-full rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)]"
    >
      {/* court + center line */}
      <rect x={m} y={m} width={innerW} height={innerH} fill="none" stroke={courtColor} strokeWidth="1.5" />
      <line x1={vw / 2} y1={m} x2={vw / 2} y2={vh - m} stroke={courtColor} strokeWidth="1" strokeDasharray="3 4" opacity="0.6" />
      {/* paddles */}
      <rect x={m + 2} y={m + innerH * 0.22} width={pw} height={ph} fill={paddleColor} />
      <rect x={vw - m - 2 - pw} y={vh - m - innerH * 0.22 - ph} width={pw} height={ph} fill={paddleColor} />
      {/* trail ghosts, fading back along the rally */}
      {Array.from({ length: ghosts }, (_, i) => (
        <circle
          key={i}
          cx={bx - (i + 1) * gap}
          cy={by + Math.sin((i + 1) * 0.9) * 5}
          r={Math.max(0.8, r * (1 - (i + 1) / (ghosts + 2)))}
          fill={ballColor}
          opacity={0.45 * (1 - i / ghosts)}
        />
      ))}
      {/* ball */}
      <circle cx={bx} cy={by} r={r} fill={ballColor} />
    </svg>
  )
}

/** OFF / 1x / 2x / 3x segmented control for the smash-crossings count. */
function SmashSegments({ bound }: { bound?: UserInterfaceParameter }) {
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const current = Math.round(bound.value)
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={bound.definition.label}>Crossings</span>
      <div className="grid grid-cols-4 gap-1">
        {[0, 1, 2, 3].map((n) => (
          <button
            key={n}
            aria-pressed={current === n}
            onClick={() => bound.setValue(n)}
            className={`h-5 rounded-[2px] border text-[9px] font-semibold tracking-[0.05em] transition-colors cursor-pointer ${current === n
              ? 'border-[var(--accent-muted)] bg-[var(--accent-muted)]/25 text-[var(--text)]'
              : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
          >
            {n === 0 ? 'OFF' : `${n}×`}
          </button>
        ))}
      </div>
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

export const PaddleBounceUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const courtWidth = find(parameters, 'courtWidth')
  const courtHeight = find(parameters, 'courtHeight')
  const ballSize = find(parameters, 'ballSize')
  const paddleHeight = find(parameters, 'paddleHeight')
  const paddleWidth = find(parameters, 'paddleWidth')
  const smash = find(parameters, 'smash')
  const smashTau = find(parameters, 'smashTau')
  const baseBounce = find(parameters, 'baseBounce')
  const bounceRange = find(parameters, 'bounceRange')
  const trailMax = find(parameters, 'trailMax')
  const trailDecay = find(parameters, 'trailDecay')
  const trailSpacing = find(parameters, 'trailSpacing')
  const ballColor = find(parameters, 'ballColor')
  const paddleColor = find(parameters, 'paddleColor')
  const courtColor = find(parameters, 'courtColor')
  const placed = [
    'courtWidth', 'courtHeight', 'ballSize', 'paddleHeight', 'paddleWidth', 'smash', 'smashTau',
    'baseBounce', 'bounceRange', 'trailMax', 'trailDecay', 'trailSpacing', 'ballColor', 'paddleColor', 'courtColor',
  ]

  return (
    <section data-testid="paddlebounce-user-interface">
      <CourtDiagram
        courtW={num(courtWidth, 8)}
        courtH={num(courtHeight, 4.5)}
        ballSize={num(ballSize, 0.32)}
        paddleH={num(paddleHeight, 1.3)}
        paddleW={num(paddleWidth, 0.22)}
        trailMax={num(trailMax, 14)}
        trailSpacing={num(trailSpacing, 0.06)}
        ballColor={str(ballColor, '#ffffff')}
        paddleColor={str(paddleColor, '#22d3ee')}
        courtColor={str(courtColor, '#4b5563')}
      />

      <Fixture label="COURT" chip={<ChipInput bound={courtColor} label="Court color" />}>
        <SliderRow bound={courtWidth} label="Width" />
        <SliderRow bound={courtHeight} label="Height" />
      </Fixture>

      <Fixture label="PADDLES" chip={<ChipInput bound={paddleColor} label="Paddle color" />}>
        <SliderRow bound={paddleHeight} label="Height" />
        <SliderRow bound={paddleWidth} label="Width" />
      </Fixture>

      <Fixture label="BALL" chip={<ChipInput bound={ballColor} label="Ball color" />}>
        <SliderRow bound={ballSize} label="Size" />
        <SliderRow bound={baseBounce} label="Base Bounce" />
        <SliderRow bound={bounceRange} label="Pitch Range" />
      </Fixture>

      <Fixture label="SMASH">
        <SmashSegments bound={smash} />
        <SliderRow bound={smashTau} label="Decay (beats)" />
      </Fixture>

      <Fixture label="TRAIL">
        <SliderRow bound={trailMax} label="Ghosts" />
        <SliderRow bound={trailDecay} label="Decay (beats)" />
        <SliderRow bound={trailSpacing} label="Spacing" />
      </Fixture>

      <Leftovers parameters={parameters} placed={placed} />
    </section>
  )
}
