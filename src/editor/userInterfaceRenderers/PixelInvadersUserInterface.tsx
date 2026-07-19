'use client'

import { useId } from 'react'
import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Pixel Invaders settings: a live formation preview (real invader sprites, cols x
// rows and the A/B/C row colors all live), square-cornered pixel styling, chunky
// -/+ steppers for the integer formation counts, and grouped march/weapon controls.

// Classic 11x8 crab invader bitmap - 1 = lit pixel.
const INVADER_ROWS = [
  '00100000100',
  '00010001000',
  '00111111100',
  '01101110110',
  '11111111111',
  '10111111101',
  '10100000101',
  '00011011000',
]

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

/** Chunky, square -/+ stepper for integer params - arcade cabinet buttons. */
function PixelStepper({ bound, label }: { bound?: UserInterfaceParameter; label: string }) {
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const d = bound.definition
  const value = Math.round(bound.value)
  const bump = (dir: 1 | -1) => bound.setValue(Math.max(d.min, Math.min(d.max, value + dir * d.step)))
  const btn = 'h-5 w-5 border border-[var(--border-strong)] bg-[var(--bg-elevated)] font-mono text-[11px] leading-none text-[var(--text-3)] transition-colors hover:text-[var(--text)] disabled:opacity-30 disabled:hover:text-[var(--text-3)] cursor-pointer disabled:cursor-default'
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-[var(--text-3)]">{label}</span>
      <div className="flex items-center gap-1">
        <button aria-label={`Decrease ${label}`} disabled={value <= d.min} onClick={() => bump(-1)} className={btn}>−</button>
        <span className="w-6 text-center font-mono text-[11px] tabular-nums text-[var(--text-2)]">{value}</span>
        <button aria-label={`Increase ${label}`} disabled={value >= d.max} onClick={() => bump(1)} className={btn}>+</button>
      </div>
    </div>
  )
}

function ChipInput({ bound, label }: { bound?: UserInterfaceParameter; label: string }) {
  if (!bound || typeof bound.value !== 'string') return null
  return (
    <label className="flex cursor-pointer flex-col items-center gap-0.5" title={`${label}: ${bound.value}`}>
      <span className="relative h-[14px] w-[14px] overflow-hidden border border-[var(--border-strong)]" style={{ background: bound.value }}>
        <input
          type="color"
          aria-label={label}
          value={bound.value}
          onChange={(e) => bound.setValue(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <span className="font-mono text-[8px] text-[var(--text-muted)] select-none">{label}</span>
    </label>
  )
}

function FormationPreview({
  cols, rows, colors, laserColor,
}: { cols: number; rows: number; colors: [string, string, string]; laserColor: string }) {
  const spriteId = useId()
  const cell = 16
  const gapX = 6
  const gapY = 5
  const gridW = cols * cell + (cols - 1) * gapX
  const gridH = rows * cell + (rows - 1) * gapY
  const vw = Math.max(gridW + 24, 160)
  const vh = gridH + 44
  const x0 = (vw - gridW) / 2
  const cannonCol = Math.floor(cols / 2)
  const cannonX = x0 + cannonCol * (cell + gapX) + cell / 2

  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      role="img"
      aria-label="Invader formation preview"
      className="mb-2 w-full border-2 border-[var(--border)] bg-[var(--bg-canvas)]"
      style={{ imageRendering: 'pixelated' }}
    >
      <defs>
        <symbol id={spriteId} viewBox="0 0 11 8">
          {INVADER_ROWS.flatMap((row, y) =>
            row.split('').map((bit, x) =>
              bit === '1' ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" /> : null,
            ),
          )}
        </symbol>
      </defs>
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => (
          <use
            key={`${r}-${c}`}
            href={`#${spriteId}`}
            x={x0 + c * (cell + gapX)}
            y={8 + r * (cell + gapY)}
            width={cell}
            height={(cell * 8) / 11}
            fill={colors[r % 3]}
          />
        )),
      )}
      {/* cannon laser up the zapped column */}
      <line
        x1={cannonX} y1={vh - 14} x2={cannonX} y2={8 + gridH}
        stroke={laserColor} strokeWidth="2" strokeDasharray="4 3" opacity="0.85"
      />
      {/* cannon */}
      <g fill={laserColor}>
        <rect x={cannonX - 7} y={vh - 8} width="14" height="4" />
        <rect x={cannonX - 4} y={vh - 11} width="8" height="3" />
        <rect x={cannonX - 1.5} y={vh - 14} width="3" height="3" />
      </g>
    </svg>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mb-1.5 mt-3 font-mono text-[9px] font-semibold tracking-[0.12em] text-[var(--text-muted)] select-none first:mt-0">
      ▚ {children}
    </p>
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

export const PixelInvadersUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const cols = find(parameters, 'cols')
  const rows = find(parameters, 'rows')
  const pixelSize = find(parameters, 'pixelSize')
  const spacingX = find(parameters, 'spacingX')
  const spacingY = find(parameters, 'spacingY')
  const gridY = find(parameters, 'gridY')
  const stepBeats = find(parameters, 'stepBeats')
  const marchSteps = find(parameters, 'marchSteps')
  const stepSize = find(parameters, 'stepSize')
  const phraseBeats = find(parameters, 'phraseBeats')
  const explodeDur = find(parameters, 'explodeDur')
  const explodeSpeed = find(parameters, 'explodeSpeed')
  const laserDur = find(parameters, 'laserDur')
  const rowColor1 = find(parameters, 'rowColor1')
  const rowColor2 = find(parameters, 'rowColor2')
  const rowColor3 = find(parameters, 'rowColor3')
  const laserColor = find(parameters, 'laserColor')
  const placed = [
    'cols', 'rows', 'pixelSize', 'spacingX', 'spacingY', 'gridY', 'stepBeats', 'marchSteps', 'stepSize',
    'phraseBeats', 'explodeDur', 'explodeSpeed', 'laserDur', 'rowColor1', 'rowColor2', 'rowColor3', 'laserColor',
  ]

  return (
    <section data-testid="pixelinvaders-user-interface">
      <FormationPreview
        cols={Math.max(1, Math.round(num(cols, 6)))}
        rows={Math.max(1, Math.round(num(rows, 3)))}
        colors={[str(rowColor1, '#39ff14'), str(rowColor2, '#00e5ff'), str(rowColor3, '#ff2079')]}
        laserColor={str(laserColor, '#aef852')}
      />
      <div className="mb-1 flex items-center justify-center gap-3">
        <ChipInput bound={rowColor1} label="ROW A" />
        <ChipInput bound={rowColor2} label="ROW B" />
        <ChipInput bound={rowColor3} label="ROW C" />
        <span aria-hidden="true" className="h-4 w-px bg-[var(--border)]" />
        <ChipInput bound={laserColor} label="LASER" />
      </div>

      <SectionLabel>FORMATION</SectionLabel>
      <div className="mb-2.5 grid grid-cols-2 gap-x-4 border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-1.5">
        <PixelStepper bound={cols} label="Cols" />
        <PixelStepper bound={rows} label="Rows" />
      </div>
      <SliderRow bound={pixelSize} label="Pixel Size" />
      <SliderRow bound={spacingX} label="Col Spacing" />
      <SliderRow bound={spacingY} label="Row Spacing" />
      <SliderRow bound={gridY} label="Top Y" />

      <SectionLabel>MARCH</SectionLabel>
      <SliderRow bound={stepBeats} label="Step (beats)" />
      <SliderRow bound={marchSteps} label="Steps / Side" />
      <SliderRow bound={stepSize} label="Step Size" />
      <SliderRow bound={phraseBeats} label="Phrase (beats)" />

      <SectionLabel>CANNON &amp; BOOM</SectionLabel>
      <SliderRow bound={laserDur} label="Laser Flash (s)" />
      <SliderRow bound={explodeDur} label="Explode (s)" />
      <SliderRow bound={explodeSpeed} label="Explode Speed" />

      <Leftovers parameters={parameters} placed={placed} />
    </section>
  )
}
