'use client'

import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Scale settings: a ghost rectangle you resize by its corner handle (the handle
// sits on the true base scale), breathing at the real pulse rate between dashed
// min/max extents so amount and speed are read, not imagined. Pulse params stay
// as console sliders below.

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

type NumberBound = { definition: NumberParamDef; value: number; setValue: (value: number | string) => void }

function findNumber(parameters: readonly UserInterfaceParameter[], key: string): NumberBound | null {
  const bound = parameters.find((p) => p.definition.key === key)
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  return bound as NumberBound
}

function snap(raw: number, d: NumberParamDef): number {
  return clamp(d.min + Math.round((raw - d.min) / d.step) * d.step, d.min, d.max)
}

// Preview geometry: at max scale the ghost square's half-size is HALF_MAX px.
const HALF_MAX = 40

function ScaleBox({ scale, pulseAmount, pulseSpeed }: { scale: NumberBound; pulseAmount: NumberBound; pulseSpeed: NumberBound }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const d = scale.definition
  const half = (scale.value / d.max) * HALF_MAX
  const amount = pulseAmount.value
  const speed = Math.max(0.05, pulseSpeed.value)
  // Breathing extents as transform factors relative to the base square.
  const hi = scale.value > 0 ? (scale.value + amount) / scale.value : 1
  const lo = scale.value > 0 ? Math.max(0, scale.value - amount) / scale.value : 1
  const pulsing = amount > 0.0001

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx = Math.abs(event.clientX - (rect.left + rect.width / 2))
    const dy = Math.abs(event.clientY - (rect.top + rect.height / 2))
    scale.setValue(snap((Math.max(dx, dy) / HALF_MAX) * d.max, d))
  }

  const onHandleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  return (
    <div
      ref={boxRef}
      data-testid="scale-ghost-box"
      title="Drag the corner handle · double-click to reset"
      onDoubleClick={() => scale.setValue(d.default)}
      className="relative h-[104px] select-none overflow-hidden rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)]"
      style={{
        backgroundImage: 'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
        backgroundSize: '13px 13px',
        backgroundPosition: 'center center',
      }}
    >
      <style>{`@keyframes scale-fx-breathe { 0%, 50%, 100% { transform: scale(1) } 25% { transform: scale(var(--breathe-hi)) } 75% { transform: scale(var(--breathe-lo)) } }`}</style>
      {/* 1× reference outline */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-[var(--border-strong)] opacity-50"
        style={{ width: (1 / d.max) * HALF_MAX * 2, height: (1 / d.max) * HALF_MAX * 2 }}
      />
      {/* pulse extents */}
      {pulsing && (
        <>
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-dashed border-[var(--accent-muted)] opacity-60"
            style={{ width: half * hi * 2, height: half * hi * 2 }}
          />
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-dashed border-[var(--accent-muted)] opacity-35"
            style={{ width: half * lo * 2, height: half * lo * 2 }}
          />
        </>
      )}
      {/* the breathing ghost itself */}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 border border-[var(--accent)] bg-[var(--accent-muted)]/20"
        style={{
          width: half * 2,
          height: half * 2,
          margin: -half,
          '--breathe-hi': String(hi),
          '--breathe-lo': String(lo),
          animation: pulsing ? `scale-fx-breathe ${(1 / speed).toFixed(3)}s ease-in-out infinite` : 'none',
        } as CSSProperties}
      />
      {/* corner handle rides the static base scale, not the animated ghost */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={d.label}
        aria-valuemin={d.min}
        aria-valuemax={d.max}
        aria-valuenow={scale.value}
        onPointerDown={onHandleDown}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
        }}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
          event.preventDefault()
          const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
          scale.setValue(snap(scale.value + direction * d.step, d))
        }}
        className="absolute z-10 h-[11px] w-[11px] cursor-nwse-resize touch-none rounded-[2px] border border-[var(--border-strong)] bg-[var(--text-2)] shadow-[0_1px_4px_rgba(0,0,0,.5)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        style={{ left: `calc(50% + ${half}px - 5px)`, top: `calc(50% + ${half}px - 5px)` }}
      />
      <span className="absolute right-1.5 top-1 font-mono text-[8px] tabular-nums text-[var(--text-muted)]">{scale.value.toFixed(1)}×</span>
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

export const ScaleEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const scale = findNumber(parameters, 'scale')
  const pulseAmount = findNumber(parameters, 'pulseAmount')
  const pulseSpeed = findNumber(parameters, 'pulseSpeed')
  if (!scale || !pulseAmount || !pulseSpeed) return <ParameterList parameters={parameters} />

  return (
    <section data-testid="scale-effect-user-interface">
      <div className="mb-2.5">
        <ScaleBox scale={scale} pulseAmount={pulseAmount} pulseSpeed={pulseSpeed} />
      </div>
      <ParamSlider
        label={pulseAmount.definition.label}
        value={pulseAmount.value}
        min={pulseAmount.definition.min}
        max={pulseAmount.definition.max}
        step={pulseAmount.definition.step}
        onChange={pulseAmount.setValue}
      />
      <ParamSlider
        label={pulseSpeed.definition.label}
        value={pulseSpeed.value}
        min={pulseSpeed.definition.min}
        max={pulseSpeed.definition.max}
        step={pulseSpeed.definition.step}
        onChange={pulseSpeed.setValue}
      />
      <Leftovers parameters={parameters} placed={['scale', 'pulseAmount', 'pulseSpeed']} />
    </section>
  )
}
