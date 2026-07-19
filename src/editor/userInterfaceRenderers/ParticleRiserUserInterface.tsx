'use client'

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Particle Riser, framed around vertical motion: a draggable
// floor-to-ceiling gauge sets where the column starts and ends, then the sections
// climb the same way the particles do - column body, the climb itself, its
// envelope in time (with a live attack/hold/release sketch), and surface texture.
// Presentation only - every control routes through the passed parameter bindings.

interface NumBinding { def: NumberParamDef; value: number; set: (v: number) => void }

function bind(parameters: readonly UserInterfaceParameter[]) {
  const pool = new Map(parameters.map((p) => [p.definition.key, p]))
  return {
    num(key: string): NumBinding | null {
      const b = pool.get(key)
      if (!b || !isNumberParam(b.definition) || typeof b.value !== 'number') return null
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3 border-l-2 border-[var(--border)] pl-2.5">
      <p className="mb-2 text-[9px] font-semibold tracking-[0.1em] text-[var(--text-muted)] select-none">{title}</p>
      {children}
    </div>
  )
}

const snap = (raw: number, d: NumberParamDef) =>
  Math.max(d.min, Math.min(d.max, Number((d.min + Math.round((raw - d.min) / d.step) * d.step).toFixed(4))))

/** Vertical dual-handle gauge for the column's start (base) and end (top) heights.
 *  Drag anywhere - the nearer handle follows. Double-click resets both. */
function ColumnGauge({ start, end }: { start: NumBinding; end: NumBinding }) {
  const LO = -8
  const HI = 8
  const trackRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<'start' | 'end' | null>(null)

  const topPct = (v: number) => ((HI - v) / (HI - LO)) * 100

  const valueAt = (clientY: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return null
    const t = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    return HI - t * (HI - LO)
  }

  const apply = (clientY: number) => {
    const raw = valueAt(clientY)
    if (raw === null || !activeRef.current) return
    if (activeRef.current === 'start') start.set(snap(raw, start.def))
    else end.set(snap(raw, end.def))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const raw = valueAt(event.clientY)
    if (raw === null) return
    activeRef.current = Math.abs(raw - start.value) <= Math.abs(raw - end.value) ? 'start' : 'end'
    event.currentTarget.setPointerCapture(event.pointerId)
    apply(event.clientY)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) apply(event.clientY)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    activeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const startTop = topPct(start.value)
  const endTop = topPct(end.value)
  const fillTop = Math.min(startTop, endTop)
  const fillHeight = Math.abs(startTop - endTop)

  return (
    <div
      ref={trackRef}
      data-testid="riser-column-gauge"
      role="group"
      aria-label="Riser start and end height"
      title="Drag to move the nearer handle · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => { start.set(start.def.default); end.set(end.def.default) }}
      className="relative h-[164px] w-[76px] flex-shrink-0 cursor-ns-resize touch-none select-none rounded border border-[var(--border)] bg-[var(--bg-app)]"
    >
      {/* zero line */}
      <div className="absolute left-1 right-1 border-t border-dashed border-[var(--border-strong)]" style={{ top: `${topPct(0)}%` }} />
      <span className="absolute right-1 font-mono text-[7px] text-[var(--text-muted)]" style={{ top: `calc(${topPct(0)}% + 1px)` }}>0</span>
      {/* the column extent */}
      <div className="absolute left-1/2 w-[5px] -translate-x-1/2 bg-[var(--accent-muted)] opacity-70" style={{ top: `${fillTop}%`, height: `${fillHeight}%` }} />
      {/* rising direction arrow */}
      <svg aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 fill-none stroke-[var(--text-muted)]" style={{ top: `calc(${endTop}% - 14px)` }} width="10" height="10" viewBox="0 0 10 10" strokeWidth="1.2">
        <path d="M5 9V2M2 4.6 5 1.5l3 3.1" />
      </svg>
      {/* end (top) handle */}
      <div className="absolute left-0 right-0 flex items-center gap-1 px-0.5" style={{ top: `calc(${endTop}% - 5px)` }}>
        <span className="h-[9px] flex-1 rounded-[2px] border border-[var(--border-strong)] bg-[var(--text-2)]" />
        <span className="w-6 text-right font-mono text-[8px] tabular-nums text-[var(--text-2)]">{end.value.toFixed(1)}</span>
      </div>
      {/* start (base) handle */}
      <div className="absolute left-0 right-0 flex items-center gap-1 px-0.5" style={{ top: `calc(${startTop}% - 5px)` }}>
        <span className="h-[9px] flex-1 rounded-[2px] border border-[var(--border-strong)] bg-[var(--bg-panel)]" />
        <span className="w-6 text-right font-mono text-[8px] tabular-nums text-[var(--text-muted)]">{start.value.toFixed(1)}</span>
      </div>
      <span className="absolute bottom-0.5 left-1 text-[7px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">BASE</span>
      <span className="absolute left-1 top-0.5 text-[7px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">TOP</span>
    </div>
  )
}

/** Live attack / hold / release sketch of the riser's lifetime. */
function EnvelopeSketch({ attack, duration, release }: { attack: number; duration: number; release: number }) {
  const W = 200
  const H = 30
  const total = Math.max(0.001, attack + duration + release)
  const x1 = (attack / total) * W
  const x2 = ((attack + duration) / total) * W
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${W} ${H + 2}`} className="mb-2 h-8 w-full">
      <polygon
        points={`0,${H} ${x1},2 ${x2},2 ${W},${H}`}
        className="fill-[var(--accent-muted)] opacity-20"
      />
      <polyline
        points={`0,${H} ${x1},2 ${x2},2 ${W},${H}`}
        className="fill-none stroke-[var(--accent-muted)]"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/** Two-way segmented switch for the numeric 0/1 color-mode param. */
function ColorModeSwitch({ b, labels }: { b: NumBinding; labels: [string, string] }) {
  const selected = Math.round(b.value)
  return (
    <div className="mb-3 grid grid-cols-[100px_1fr] items-center gap-2.5">
      <span className="text-[11px] text-[var(--text-3)] truncate" title={b.def.label}>Color</span>
      <div className="grid grid-cols-2 gap-1">
        {labels.map((label, index) => {
          const active = selected === index
          return (
            <button
              key={label}
              aria-pressed={active}
              onClick={() => b.set(index)}
              className={`h-6 rounded border text-[9px] font-semibold tracking-[0.08em] transition-colors cursor-pointer ${active
                ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-2)]'
                : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export const ParticleRiserUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bind(parameters)
  const startY = b.num('startY')
  const endY = b.num('endY')
  const width = b.num('width')
  const depth = b.num('depth')
  const particleCount = b.num('particleCount')
  const dotSize = b.num('dotSize')
  const riseSpeed = b.num('riseSpeed')
  const acceleration = b.num('acceleration')
  const frontWidth = b.num('frontWidth')
  const pressureBoost = b.num('pressureBoost')
  const densityBuild = b.num('densityBuild')
  const attack = b.num('attack')
  const release = b.num('release')
  const duration = b.num('duration')
  const noteDurationScale = b.num('noteDurationScale')
  const centerPull = b.num('centerPull')
  const turbulence = b.num('turbulence')
  const spiralAmount = b.num('spiralAmount')
  const spiralSpeed = b.num('spiralSpeed')
  const shimmer = b.num('shimmer')
  const peakFlash = b.num('peakFlash')
  const colorMode = b.num('colorMode')
  const rest = b.rest()

  return (
    <section data-testid="particle-riser-user-interface" className="mb-4">
      <header className="mb-2.5 flex items-center gap-2 select-none">
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="fill-none stroke-[var(--accent)]" strokeWidth="1.3" strokeLinecap="round">
          <path d="M4 13V5M4 5 2 7.2M4 5l2 2.2M9.5 13V2.5M9.5 2.5 7.4 4.8M9.5 2.5l2.1 2.3" />
        </svg>
        <span className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">PARTICLE RISER</span>
      </header>

      <Section title="COLUMN">
        <div className="flex gap-3">
          {startY && endY && <ColumnGauge start={startY} end={endY} />}
          <div className="min-w-0 flex-1 pt-1">
            <Row b={width} />
            <Row b={depth} />
            <Row b={particleCount} />
            <Row b={dotSize} />
          </div>
        </div>
        {(!startY || !endY) && (
          <>
            <Row b={startY} />
            <Row b={endY} />
          </>
        )}
      </Section>

      <Section title="CLIMB">
        <Row b={riseSpeed} />
        <Row b={acceleration} />
        <Row b={frontWidth} />
        <Row b={pressureBoost} />
        <Row b={densityBuild} />
      </Section>

      <Section title="ENVELOPE">
        {attack && duration && release && (
          <EnvelopeSketch attack={attack.value} duration={duration.value} release={release.value} />
        )}
        <Row b={attack} />
        <Row b={duration} />
        <Row b={release} />
        <Row b={noteDurationScale} />
      </Section>

      <Section title="TEXTURE">
        <Row b={centerPull} />
        <Row b={turbulence} />
        <Row b={spiralAmount} />
        <Row b={spiralSpeed} />
        <Row b={shimmer} />
        <Row b={peakFlash} />
      </Section>

      {colorMode && <ColorModeSwitch b={colorMode} labels={['PITCH', 'MONO']} />}

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
