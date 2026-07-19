'use client'

import type { ReactNode } from 'react'
import { isNumberParam, type NumberParamDef, type SelectParamDef } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Dot Field, split into "the field" and "how it responds":
// a live sunflower glyph (dot count + size mirror the params) beside the FIELD
// group, gradient chips for the three baked color schemes, a cell stepper for the
// rolling effect roster, then the two note-reaction systems - disruptor blades
// and center ripples - as their own response groups.
// Presentation only - every control routes through the passed parameter bindings.

interface NumBinding { def: NumberParamDef; value: number; set: (v: number) => void }
interface SelectBinding { def: SelectParamDef; value: number; set: (v: number) => void }

function bind(parameters: readonly UserInterfaceParameter[]) {
  const pool = new Map(parameters.map((p) => [p.definition.key, p]))
  return {
    num(key: string): NumBinding | null {
      const b = pool.get(key)
      if (!b || !isNumberParam(b.definition) || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    select(key: string): SelectBinding | null {
      const b = pool.get(key)
      if (!b || b.definition.type !== 'select' || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

function Row({ b }: { b: NumBinding | null }) {
  if (!b) return null
  return <ParamSlider label={b.def.label} value={b.value} min={b.def.min} max={b.def.max} step={b.def.step} onChange={b.set} />
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3 rounded border border-[var(--border)] bg-[var(--bg-app)] px-2.5 pt-2 pb-0.5">
      <p className="mb-2 text-[9px] font-semibold tracking-[0.1em] text-[var(--text-muted)] select-none">{title}</p>
      {children}
    </div>
  )
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** Sunflower-distribution glyph mirroring particle count + dot size. */
function SunflowerGlyph({ count, dotSize }: { count: number; dotSize: number }) {
  const n = Math.round(10 + Math.min(1, count / 2000) * 52)
  const r = 0.8 + (Math.min(24, dotSize) / 24) * 1.9
  const dots: ReactNode[] = []
  for (let i = 0; i < n; i++) {
    const radius = 26 * Math.sqrt(i / n)
    const theta = i * GOLDEN_ANGLE
    dots.push(<circle key={i} cx={30 + Math.cos(theta) * radius} cy={30 + Math.sin(theta) * radius} r={r} />)
  }
  return (
    <svg aria-hidden="true" width="62" height="62" viewBox="0 0 60 60" className="flex-shrink-0 fill-[var(--accent-muted)]">
      {dots}
    </svg>
  )
}

// Representative gradients for the three baked schemes, in option order.
const SCHEME_GRADIENTS = [
  'radial-gradient(circle at 42% 42%, #ff2d78, #e01313 48%, #ffb020)',
  'radial-gradient(circle at 42% 42%, #123f8f, #0e9a8f 52%, #e0b13a)',
  'radial-gradient(circle at 42% 42%, #2c1e7a, #b12ce0 46%, #23e0c8)',
]

function SchemeChips({ b }: { b: SelectBinding }) {
  const selected = Math.round(b.value)
  return (
    <div className="mb-3 grid grid-cols-3 gap-1.5">
      {b.def.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-pressed={active}
            aria-label={`${b.def.label}: ${option.label}`}
            onClick={() => b.set(option.value)}
            className={`overflow-hidden rounded border transition-colors cursor-pointer ${active
              ? 'border-[var(--accent)]'
              : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}
          >
            <span
              className={`block h-7 w-full ${active ? '' : 'opacity-60'}`}
              style={{ background: SCHEME_GRADIENTS[option.value] ?? SCHEME_GRADIENTS[0] }}
            />
            <span className={`block truncate px-1 py-0.5 text-[7px] font-semibold tracking-[0.05em] uppercase ${active ? 'text-[var(--text-2)]' : 'text-[var(--text-muted)]'}`}>
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Integer cell stepper: click cell k for value k; click the active cell for 0. */
function CellStepper({ b }: { b: NumBinding | null }) {
  if (!b) return null
  const { def, value, set } = b
  const cells = Math.round(def.max - def.min)
  const current = Math.round(value)
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr_44px] items-center gap-2.5">
      <span className="text-[11px] text-[var(--text-3)] truncate" title={def.label}>{def.label}</span>
      <div className="flex h-[12px] gap-[2px]" role="group" aria-label={def.label} title="Click a cell · click the last lit cell to zero">
        {Array.from({ length: cells }, (_, index) => {
          const cellValue = Math.round(def.min) + index + 1
          const lit = cellValue <= current
          return (
            <button
              key={cellValue}
              aria-label={`${def.label} ${cellValue}`}
              aria-pressed={lit}
              onClick={() => set(cellValue === current ? Math.round(def.min) : cellValue)}
              className={`h-full flex-1 rounded-[1px] transition-colors cursor-pointer ${lit ? 'bg-[var(--accent-muted)]' : 'bg-[var(--border)] hover:bg-[var(--border-strong)]'}`}
            />
          )
        })}
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{current}</span>
    </div>
  )
}

export const DotFieldUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bind(parameters)
  const colorMode = b.select('colorMode')
  const particleCount = b.num('particleCount')
  const dotSize = b.num('dotSize')
  const opacity = b.num('opacity')
  const speed = b.num('speed')
  const intensity = b.num('intensity')
  const activeEffects = b.num('activeEffects')
  const bladeCount = b.num('bladeCount')
  const disruptorStrength = b.num('disruptorStrength')
  const disruptorSpeed = b.num('disruptorSpeed')
  const disruptorLifetime = b.num('disruptorLifetime')
  const rippleSpeed = b.num('rippleSpeed')
  const rippleStrength = b.num('rippleStrength')
  const rest = b.rest()

  return (
    <section data-testid="dot-field-user-interface" className="mb-4">
      <header className="mb-2.5 flex items-center gap-2 select-none">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" className="fill-[var(--accent)]">
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="11.2" cy="6.4" r="1.1" /><circle cx="9.4" cy="11.3" r="1.1" />
          <circle cx="4.8" cy="9.8" r="1.1" /><circle cx="5.6" cy="4.6" r="1.1" />
          <circle cx="13.2" cy="10.6" r="0.9" /><circle cx="10.9" cy="2.9" r="0.9" />
          <circle cx="2.6" cy="6.2" r="0.9" /><circle cx="7.4" cy="14" r="0.9" />
        </svg>
        <span className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">DOT FIELD</span>
      </header>

      {colorMode && <SchemeChips b={colorMode} />}

      <Group title="FIELD">
        <div className="flex items-start gap-2.5">
          {particleCount && dotSize && <SunflowerGlyph count={particleCount.value} dotSize={dotSize.value} />}
          <div className="min-w-0 flex-1">
            <Row b={particleCount} />
            <Row b={dotSize} />
            <Row b={opacity} />
          </div>
        </div>
      </Group>

      <Group title="RESPONSE">
        <Row b={speed} />
        <Row b={intensity} />
        <CellStepper b={activeEffects} />
      </Group>

      <Group title="DISRUPTOR BLADES · every 4th note">
        <Row b={bladeCount} />
        <Row b={disruptorStrength} />
        <Row b={disruptorSpeed} />
        <Row b={disruptorLifetime} />
      </Group>

      <Group title="CENTER RIPPLES · every 2nd note">
        <Row b={rippleSpeed} />
        <Row b={rippleStrength} />
      </Group>

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
