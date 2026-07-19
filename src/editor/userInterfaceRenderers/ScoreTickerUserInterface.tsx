'use client'

import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Score Ticker settings: a live seven-segment readout as the centerpiece (digit
// count, colors and glow all track their params - unlit segments stay faintly
// visible like a real LED module), digit count as an arcade digit-bank picker,
// and mono/numeric-first rows for the spin and 1UP behavior underneath.

// Segment layout in a 12x20 digit box: a top, b/c right, d bottom, e/f left, g mid.
const SEGMENT_RECTS: Record<string, { x: number; y: number; w: number; h: number }> = {
  a: { x: 2, y: 0, w: 8, h: 2.2 },
  b: { x: 9.8, y: 1.6, w: 2.2, h: 7.6 },
  c: { x: 9.8, y: 10.8, w: 2.2, h: 7.6 },
  d: { x: 2, y: 17.8, w: 8, h: 2.2 },
  e: { x: 0, y: 10.8, w: 2.2, h: 7.6 },
  f: { x: 0, y: 1.6, w: 2.2, h: 7.6 },
  g: { x: 2, y: 8.9, w: 8, h: 2.2 },
}
const DIGIT_SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
}

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

function SevenSegmentDigit({ char, lit, unlit }: { char: string; lit: string; unlit: string }) {
  const on = DIGIT_SEGMENTS[char] ?? ''
  return (
    <g transform="skewX(-4)">
      {Object.entries(SEGMENT_RECTS).map(([seg, r]) => (
        <rect key={seg} x={r.x} y={r.y} width={r.w} height={r.h} rx="0.6" fill={on.includes(seg) ? lit : unlit} />
      ))}
    </g>
  )
}

function Readout({
  digits, multiplier, glow, scoreColor, labelColor, accentColor,
}: { digits: number; multiplier: number; glow: number; scoreColor: string; labelColor: string; accentColor: string }) {
  // A plausible demo score: pitch 60 x full velocity x multiplier, a few notes in.
  const sample = Math.round(60 * 127 * multiplier * 4)
  const text = String(sample % 10 ** digits).padStart(digits, '0')
  const digitW = 16
  const vw = digits * digitW + 6

  return (
    <div className="mb-2 rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas-deep)] px-2.5 pb-2 pt-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[9px] font-bold tracking-[0.22em] select-none" style={{ color: labelColor }}>HI-SCORE</span>
        <span
          className="border px-1 py-px font-mono text-[8px] font-bold tracking-[0.14em] select-none"
          style={{ color: accentColor, borderColor: accentColor }}
        >
          1UP
        </span>
      </div>
      <svg
        viewBox={`0 0 ${vw} 20`}
        role="img"
        aria-label={`Score readout preview: ${text}`}
        className="mx-auto block h-9 w-auto max-w-full"
        style={{ filter: glow > 0 ? `drop-shadow(0 0 ${(2 + glow * 5).toFixed(1)}px ${scoreColor})` : undefined }}
      >
        {text.split('').map((char, i) => (
          <g key={i} transform={`translate(${4 + i * digitW}, 0)`}>
            <SevenSegmentDigit char={char} lit={scoreColor} unlit="rgba(255,255,255,0.06)" />
          </g>
        ))}
      </svg>
    </div>
  )
}

/** Digit-bank picker: one square button per supported width, 7-seg style "8"s. */
function DigitBank({ bound }: { bound?: UserInterfaceParameter }) {
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const d = bound.definition
  const current = Math.round(bound.value)
  const options: number[] = []
  for (let n = Math.round(d.min); n <= Math.round(d.max); n += Math.max(1, Math.round(d.step))) options.push(n)
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={d.label}>Digits</span>
      <div className="flex gap-1">
        {options.map((n) => (
          <button
            key={n}
            aria-pressed={current === n}
            aria-label={`${n} digits`}
            onClick={() => bound.setValue(n)}
            className={`h-5 flex-1 rounded-[2px] border font-mono text-[10px] tabular-nums transition-colors cursor-pointer ${current === n
              ? 'border-[var(--accent-muted)] bg-[var(--accent-muted)]/25 text-[var(--text)]'
              : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

function ChipRow({ chips }: { chips: { bound?: UserInterfaceParameter; label: string }[] }) {
  return (
    <div className="mb-2.5 flex items-center justify-between rounded-[3px] border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-1.5">
      {chips.map(({ bound, label }) =>
        bound && typeof bound.value === 'string' ? (
          <label key={label} className="flex cursor-pointer items-center gap-1.5" title={`${label}: ${bound.value}`}>
            <span className="relative h-[15px] w-[15px] overflow-hidden rounded-[2px] border border-[var(--border-strong)]" style={{ background: bound.value }}>
              <input
                type="color"
                aria-label={`${label} color`}
                value={bound.value}
                onChange={(e) => bound.setValue(e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </span>
            <span className="font-mono text-[8px] tracking-[0.1em] text-[var(--text-muted)] select-none">{label}</span>
          </label>
        ) : null,
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mb-1.5 mt-3 font-mono text-[9px] font-semibold tracking-[0.14em] text-[var(--text-muted)] select-none first:mt-0">{children}</p>
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

export const ScoreTickerUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const digits = find(parameters, 'digits')
  const multiplier = find(parameters, 'multiplier')
  const spinDur = find(parameters, 'spinDur')
  const spinTicks = find(parameters, 'spinTicks')
  const accentThresh = find(parameters, 'accentThresh')
  const flashDur = find(parameters, 'flashDur')
  const width = find(parameters, 'width')
  const glow = find(parameters, 'glow')
  const jitter = find(parameters, 'jitter')
  const scoreColor = find(parameters, 'scoreColor')
  const labelColor = find(parameters, 'labelColor')
  const accentColor = find(parameters, 'accentColor')
  const placed = [
    'digits', 'multiplier', 'spinDur', 'spinTicks', 'accentThresh', 'flashDur',
    'width', 'glow', 'jitter', 'scoreColor', 'labelColor', 'accentColor',
  ]

  return (
    <section data-testid="scoreticker-user-interface">
      <Readout
        digits={Math.max(1, Math.round(num(digits, 6)))}
        multiplier={num(multiplier, 1)}
        glow={num(glow, 0.8)}
        scoreColor={str(scoreColor, '#facc15')}
        labelColor={str(labelColor, '#22d3ee')}
        accentColor={str(accentColor, '#4ade80')}
      />
      <ChipRow chips={[
        { bound: scoreColor, label: 'SCORE' },
        { bound: labelColor, label: 'LABEL' },
        { bound: accentColor, label: '1UP' },
      ]} />

      <SectionLabel>READOUT</SectionLabel>
      <DigitBank bound={digits} />
      <SliderRow bound={width} label="Width" />
      <SliderRow bound={glow} label="Glow" />
      <SliderRow bound={multiplier} label="Points ×" />

      <SectionLabel>SPIN-UP</SectionLabel>
      <SliderRow bound={spinDur} label="Time (s)" />
      <SliderRow bound={spinTicks} label="Ticks" />
      <SliderRow bound={jitter} label="Jitter" />

      <SectionLabel>1UP FLASH</SectionLabel>
      <SliderRow bound={accentThresh} label="Velocity ≥" />
      <SliderRow bound={flashDur} label="Flash (s)" />

      <Leftovers parameters={parameters} placed={placed} />
    </section>
  )
}
