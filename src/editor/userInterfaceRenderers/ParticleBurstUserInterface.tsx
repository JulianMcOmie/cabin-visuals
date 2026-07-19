'use client'

import type { ReactNode } from 'react'
import { isNumberParam, type NumberParamDef, type SelectParamDef } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Particle Burst. Reads top-to-bottom the way you'd design a
// firework: pick the burst shape, load the explosion (count / size / power cluster
// under a burst glyph), shape its decay along an ease curve, then fine-tune the
// geometry-specific extras (dimmed when the selected shape ignores them).
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

function Cluster({ title, glyph, children }: { title: string; glyph?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3 rounded border border-[var(--border)] bg-[var(--bg-app)] px-2.5 pt-2 pb-0.5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[var(--text-muted)] select-none">
        {glyph}
        <span className="text-[9px] font-semibold tracking-[0.1em]">{title}</span>
      </div>
      {children}
    </div>
  )
}

/** The tiny burst glyph - a dot with radiating spokes. */
function BurstGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" className="fill-none stroke-current" strokeWidth="1.2" strokeLinecap="round">
      <circle cx="8" cy="8" r="1.4" className="fill-current stroke-none" />
      <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M12.6 3.4l-2.1 2.1M5.5 10.5l-2.1 2.1" />
    </svg>
  )
}

/** One mini glyph per burst geometry, in the option order of the `burstType` select. */
function TypeGlyph({ index }: { index: number }) {
  const common = { className: 'fill-none stroke-current', strokeWidth: 1.2, strokeLinecap: 'round' as const }
  switch (index) {
    case 0: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><circle cx="8" cy="8" r="5.5" /><circle cx="6" cy="7" r="0.7" className="fill-current stroke-none" /><circle cx="10" cy="6.2" r="0.7" className="fill-current stroke-none" /><circle cx="8.4" cy="10" r="0.7" className="fill-current stroke-none" /></svg>
    case 1: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M3 8 L13 3.5 M3 8 L13 12.5" /><ellipse cx="13" cy="8" rx="1.5" ry="4.5" /></svg>
    case 2: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M2.5 8 L13.5 5.6 M2.5 8 L13.5 10.4 M5.5 8h5" /></svg>
    case 3: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M8 8 C9.5 8 9.5 6 8 6 C5.8 6 5.8 9.5 8 9.5 C11 9.5 11 4.5 8 4.5 C4 4.5 4 11.5 8 11.5 C12.5 11.5 12.5 3.5 8 3.5" /></svg>
    case 4: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M8 8 Q10.5 4.5 8 2.5 Q5.5 4.5 8 8 Q11.5 5.5 13.5 8 Q11.5 10.5 8 8 Q10.5 11.5 8 13.5 Q5.5 11.5 8 8 Q4.5 10.5 2.5 8 Q4.5 5.5 8 8" /></svg>
    case 5: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><circle cx="8" cy="8" r="4.6" strokeWidth="2.2" /></svg>
    default: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M3.5 2.5 C8 5.5 8 10.5 12.5 13.5 M12.5 2.5 C8 5.5 8 10.5 3.5 13.5 M5.6 5h4.8 M5.6 11h4.8" /></svg>
  }
}

/** Representative stroke of each ease curve (option order of `burstCurve`). */
const CURVE_PATHS = [
  'M2 22 C5 7 10 3 22 2',   // logarithmic
  'M2 22 C3 5 8 2 22 2',    // exponential
  'M2 22 C9 12 14 5 22 2',  // power
  'M2 22 A20 20 0 0 1 22 2',// circular
  'M2 22 Q12 4 22 2',       // sine
]

function TypeSelector({ b }: { b: SelectBinding }) {
  const selected = Math.round(b.value)
  return (
    <div className="mb-3 grid grid-cols-4 gap-1">
      {b.def.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-pressed={active}
            aria-label={`${b.def.label}: ${option.label}`}
            onClick={() => b.set(option.value)}
            className={`flex flex-col items-center gap-1 rounded border px-1 py-1.5 transition-colors cursor-pointer ${active
              ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-2)]'
              : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)] hover:border-[var(--border-strong)]'}`}
          >
            <TypeGlyph index={option.value} />
            <span className="max-w-full truncate text-[7px] font-semibold tracking-[0.05em] uppercase">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function CurveSelector({ b }: { b: SelectBinding }) {
  const selected = Math.round(b.value)
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
      <span className="text-[11px] text-[var(--text-3)] truncate" title={b.def.label}>{b.def.label}</span>
      <div className="grid grid-cols-5 gap-1">
        {b.def.options.map((option) => {
          const active = option.value === selected
          return (
            <button
              key={option.value}
              title={option.label}
              aria-pressed={active}
              aria-label={`${b.def.label}: ${option.label}`}
              onClick={() => b.set(option.value)}
              className={`flex h-7 items-center justify-center rounded border transition-colors cursor-pointer ${active
                ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-2)]'
                : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" className="fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round">
                <path d={CURVE_PATHS[option.value] ?? CURVE_PATHS[0]} />
              </svg>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Wraps a shape-specific row, dimming it when the selected burst type ignores it. */
function ShapeRow({ b, relevantTypes, selected }: { b: NumBinding | null; relevantTypes: number[] | null; selected: number }) {
  if (!b) return null
  const relevant = relevantTypes === null || relevantTypes.includes(selected)
  return (
    <div
      className={relevant ? undefined : 'opacity-40'}
      title={relevant ? undefined : `${b.def.label} only affects some burst types`}
    >
      <Row b={b} />
    </div>
  )
}

export const ParticleBurstUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bind(parameters)
  const burstType = b.select('burstType')
  const count = b.num('count')
  const pointSize = b.num('pointSize')
  const burstRadius = b.num('burstRadius')
  const burstPower = b.num('burstPower')
  const burstCurve = b.select('burstCurve')
  const burstLifetime = b.num('burstLifetime')
  const fadePower = b.num('fadePower')
  const dissolveSpread = b.num('dissolveSpread')
  const coneAngle = b.num('coneAngle')
  const spiralTwists = b.num('spiralTwists')
  const polarPetals = b.num('polarPetals')
  const cylinderRadius = b.num('cylinderRadius')
  const rest = b.rest()
  const selectedType = burstType ? Math.round(burstType.value) : 0

  return (
    <section data-testid="particle-burst-user-interface" className="mb-4">
      <header className="mb-2.5 flex items-center gap-2 select-none">
        <span className="flex h-6 w-6 items-center justify-center rounded border border-[var(--border-strong)] bg-[var(--bg-app)] text-[var(--accent)]">
          <BurstGlyph size={13} />
        </span>
        <span className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">PARTICLE BURST</span>
      </header>

      {burstType && <TypeSelector b={burstType} />}

      <Cluster title="EXPLOSION" glyph={<BurstGlyph />}>
        <Row b={count} />
        <Row b={pointSize} />
        <Row b={burstRadius} />
        <Row b={burstPower} />
      </Cluster>

      <Cluster title="DECAY">
        {burstCurve && <CurveSelector b={burstCurve} />}
        <Row b={burstLifetime} />
        <Row b={fadePower} />
        <Row b={dissolveSpread} />
      </Cluster>

      <Cluster title="SHAPE TUNING">
        <ShapeRow b={coneAngle} relevantTypes={[1, 2]} selected={selectedType} />
        <ShapeRow b={spiralTwists} relevantTypes={[3, 6]} selected={selectedType} />
        <ShapeRow b={polarPetals} relevantTypes={[4]} selected={selectedType} />
        <ShapeRow b={cylinderRadius} relevantTypes={null} selected={selectedType} />
      </Cluster>

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
