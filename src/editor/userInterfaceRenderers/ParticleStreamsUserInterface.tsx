'use client'

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl, ParamSlider, ParamToggle } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Particle Streams - built around the rush toward camera.
// A RUSH cluster (speed + reach under a converging-lines glyph), an aim pad for
// the attack tilt, a proportional phase-timeline of the burst's life
// (attack / travel / fade / trail), then bundle shape, wave head and swirl.
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
    bool(key: string): { label: string; on: boolean; set: (v: number) => void } | null {
      const b = pool.get(key)
      if (!b || b.definition.type !== 'boolean' || typeof b.value !== 'number') return null
      pool.delete(key)
      return { label: b.definition.label, on: b.value >= 0.5, set: b.setValue }
    },
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

function Row({ b }: { b: NumBinding | null }) {
  if (!b) return null
  return <ParamSlider label={b.def.label} value={b.value} min={b.def.min} max={b.def.max} step={b.def.step} onChange={b.set} />
}

function Group({ title, glyph, children }: { title: string; glyph?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-2 flex items-center gap-1.5 border-b border-[var(--border)] pb-1 text-[var(--text-muted)] select-none">
        {glyph}
        <span className="text-[9px] font-semibold tracking-[0.1em]">{title}</span>
      </div>
      {children}
    </div>
  )
}

/** Converging-lines glyph: streams rushing at the viewer. */
function RushGlyph() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" className="fill-none stroke-current" strokeWidth="1.2" strokeLinecap="round">
      <path d="M2 2 7 7M14 2 9 7M2 14l5-5M14 14 9 9" />
      <circle cx="8" cy="8" r="1.1" className="fill-current stroke-none" />
    </svg>
  )
}

const snap = (raw: number, d: NumberParamDef) =>
  Math.max(d.min, Math.min(d.max, Number((d.min + Math.round((raw - d.min) / d.step) * d.step).toFixed(4))))

/** XY aim pad: horizontal = tilt Y (left/right), vertical = tilt X (up/down). */
function AimPad({ tiltX, tiltY }: { tiltX: NumBinding; tiltY: NumBinding }) {
  const padRef = useRef<HTMLDivElement>(null)
  const leftPct = ((tiltY.value - tiltY.def.min) / (tiltY.def.max - tiltY.def.min)) * 100
  const topPct = 100 - ((tiltX.value - tiltX.def.min) / (tiltX.def.max - tiltX.def.min)) * 100

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    tiltY.set(snap(tiltY.def.min + nx * (tiltY.def.max - tiltY.def.min), tiltY.def))
    tiltX.set(snap(tiltX.def.max - ny * (tiltX.def.max - tiltX.def.min), tiltX.def))
  }

  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-start gap-2.5">
      <div className="pt-1">
        <span className="block text-[11px] text-[var(--text-3)]">Attack Aim</span>
        <span className="mt-1 block font-mono text-[9px] leading-4 text-[var(--text-muted)]">
          X {tiltX.value.toFixed(0)}°<br />Y {tiltY.value.toFixed(0)}°
        </span>
      </div>
      <div
        ref={padRef}
        data-testid="streams-aim-pad"
        role="group"
        aria-label="Attack tilt X and Y"
        title="Drag to aim the burst · double-click to recenter"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
        }}
        onDoubleClick={() => { tiltX.set(tiltX.def.default); tiltY.set(tiltY.def.default) }}
        className="relative h-[92px] cursor-crosshair touch-none select-none rounded border border-[var(--border)] bg-[var(--bg-app)]"
      >
        <span className="absolute left-1/2 top-0 h-full w-px bg-[var(--border)]" />
        <span className="absolute left-0 top-1/2 h-px w-full bg-[var(--border)]" />
        <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-[var(--border-strong)]" />
        <span
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border-strong)] bg-[var(--accent-muted)]"
          style={{ left: `${leftPct}%`, top: `${topPct}%` }}
        />
      </div>
    </div>
  )
}

/** Proportional strip of the burst's four life phases. */
function PhaseTimeline({ attack, travel, fade, trail }: { attack: number; travel: number; fade: number; trail: number }) {
  const total = Math.max(0.001, attack + travel + fade + trail)
  const phases = [
    { label: 'ATK', seconds: attack, className: 'bg-[var(--accent)]' },
    { label: 'TRAVEL', seconds: travel, className: 'bg-[var(--accent-muted)]' },
    { label: 'FADE', seconds: fade, className: 'bg-[var(--border-strong)]' },
    { label: 'TRAIL', seconds: trail, className: 'bg-[var(--border)]' },
  ]
  return (
    <div className="mb-2.5 select-none">
      <div className="flex h-[14px] w-full gap-px overflow-hidden rounded-sm">
        {phases.map((phase) => (
          <div
            key={phase.label}
            className={`${phase.className} min-w-[3px]`}
            style={{ width: `${(phase.seconds / total) * 100}%` }}
            title={`${phase.label} ${phase.seconds.toFixed(2)}s`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[8px] text-[var(--text-muted)]">
        <span>note on</span>
        <span>{total.toFixed(2)}s total</span>
      </div>
    </div>
  )
}

/** Two-way segmented switch for the numeric 0/1 color-mode param. */
function ColorModeSwitch({ b, labels }: { b: NumBinding; labels: [string, string] }) {
  const selected = Math.round(b.value)
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
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

export const ParticleStreamsUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bind(parameters)
  const streamSpeed = b.num('streamSpeed')
  const cameraReach = b.num('cameraReach')
  const outwardReach = b.num('outwardReach')
  const runSpread = b.num('runSpread')
  const attackSpread = b.num('attackSpread')
  const streamTightness = b.num('streamTightness')
  const tiltX = b.num('attackTiltX')
  const tiltY = b.num('attackTiltY')
  const attackDuration = b.num('attackDuration')
  const travelDuration = b.num('travelDuration')
  const fadeDuration = b.num('fadeDuration')
  const trailDuration = b.num('trailDuration')
  const streams = b.num('streams')
  const particlesPerStream = b.num('particlesPerStream')
  const dotSize = b.num('dotSize')
  const waveParticleCount = b.num('waveParticleCount')
  const waveSizeBoost = b.num('waveSizeBoost')
  const turbulence = b.num('turbulence')
  const spiralAmount = b.num('spiralAmount')
  const spiralSpeed = b.num('spiralSpeed')
  const colorMode = b.num('colorMode')
  const whiteBackground = b.bool('whiteBackground')
  const rest = b.rest()

  return (
    <section data-testid="particle-streams-user-interface" className="mb-4">
      <header className="mb-2.5 flex items-center gap-2 select-none">
        <span className="text-[var(--accent)]"><RushGlyph /></span>
        <span className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">PARTICLE STREAMS</span>
      </header>

      <Group title="RUSH" glyph={<RushGlyph />}>
        <Row b={streamSpeed} />
        <Row b={cameraReach} />
        {tiltX && tiltY && <AimPad tiltX={tiltX} tiltY={tiltY} />}
        {(!tiltX || !tiltY) && (
          <>
            <Row b={tiltX} />
            <Row b={tiltY} />
          </>
        )}
      </Group>

      <Group title="LIFE PHASES">
        {attackDuration && travelDuration && fadeDuration && trailDuration && (
          <PhaseTimeline
            attack={attackDuration.value}
            travel={travelDuration.value}
            fade={fadeDuration.value}
            trail={trailDuration.value}
          />
        )}
        <Row b={attackDuration} />
        <Row b={travelDuration} />
        <Row b={fadeDuration} />
        <Row b={trailDuration} />
      </Group>

      <Group title="BUNDLE">
        <Row b={streams} />
        <Row b={particlesPerStream} />
        <Row b={outwardReach} />
        <Row b={attackSpread} />
        <Row b={runSpread} />
        <Row b={streamTightness} />
      </Group>

      <Group title="WAVE HEAD">
        <Row b={dotSize} />
        <Row b={waveParticleCount} />
        <Row b={waveSizeBoost} />
      </Group>

      <Group title="SWIRL">
        <Row b={turbulence} />
        <Row b={spiralAmount} />
        <Row b={spiralSpeed} />
      </Group>

      {colorMode && <ColorModeSwitch b={colorMode} labels={['MONO', 'PITCH']} />}
      {whiteBackground && (
        <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
          <span className="text-[11px] text-[var(--text-3)] truncate" title={whiteBackground.label}>{whiteBackground.label}</span>
          <div className="flex justify-end">
            <ParamToggle on={whiteBackground.on} onChange={(v) => whiteBackground.set(v ? 1 : 0)} label={whiteBackground.label} />
          </div>
        </div>
      )}

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
