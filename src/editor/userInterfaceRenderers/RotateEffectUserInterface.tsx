'use client'

import { useKnobInteraction } from './useKnobInteraction'
import { KnobValue } from './KnobValue'
import { numberEntry } from './knobValueParsing'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Rotate settings: one column per axis. The dial is the orientation — grab it
// and turn (snaps to the param's 5° step, needle shows the angle); the rim arc
// shows spin speed and direction; the pill under each dial is a horizontal
// drag-to-set spin control with a bipolar fill. Double-click anything to reset.

type NumberBound = { definition: NumberParamDef; value: number; setValue: (value: number | string) => void }

function findNumber(parameters: readonly UserInterfaceParameter[], key: string): NumberBound | null {
  const bound = parameters.find((p) => p.definition.key === key)
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  return bound as NumberBound
}

function OrientationDial({ orientation, spin, axis }: { orientation: NumberBound; spin: NumberBound; axis: string }) {
  const d = orientation.definition
  const value = orientation.value

  // Spin arc on the rim: clockwise from 12 o'clock when positive, mirrored when negative.
  const spinRange = Math.max(Math.abs(spin.definition.min), Math.abs(spin.definition.max)) || 1
  const arc = (Math.abs(spin.value) / spinRange) * 150
  const rimGradient = spin.value >= 0
    ? `conic-gradient(from 0deg, var(--accent-muted) 0deg ${arc}deg, transparent ${arc}deg 360deg)`
    : `conic-gradient(from 0deg, transparent 0deg ${360 - arc}deg, var(--accent-muted) ${360 - arc}deg 360deg)`

  const { handlers } = useKnobInteraction({ ...d, value, defaultValue: d.default,
    onChange: orientation.setValue, gesture: 'angular', keyStep: true })

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={d.label}
      aria-valuemin={d.min}
      aria-valuemax={d.max}
      aria-valuenow={value}
      aria-valuetext={`${value} degrees`}
      title="Drag to turn · double-click to reset"
      {...handlers}
      className="relative h-[52px] w-[52px] cursor-grab touch-none select-none rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] active:cursor-grabbing"
      style={{ background: rimGradient }}
    >
      {/* face, inset so the rim gradient shows as a 3px spin ring */}
      <div className="absolute inset-[3px] rounded-full border border-[var(--border-strong)] bg-[var(--bg-canvas)]" />
      {/* cardinal ticks */}
      {[0, 90, 180, 270].map((tick) => (
        <span
          key={tick}
          aria-hidden="true"
          className="absolute inset-[3px]"
          style={{ transform: `rotate(${tick}deg)` }}
        >
          <span className="absolute left-1/2 top-[2px] h-[4px] w-px -translate-x-1/2 bg-[var(--border-strong)]" />
        </span>
      ))}
      {/* needle */}
      <span aria-hidden="true" className="absolute inset-[3px]" style={{ transform: `rotate(${value}deg)` }}>
        <span className="absolute left-1/2 top-[5px] h-[16px] w-[2px] -translate-x-1/2 rounded-full bg-[var(--accent)] shadow-[0_0_6px_rgba(53,167,230,.6)]" />
      </span>
      <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-3)]" />
      <span className="sr-only">{axis} orientation</span>
    </div>
  )
}

/** Horizontal drag pill for spin speed: bipolar fill from the center detent. */
function SpinPill({ spin }: { spin: NumberBound }) {
  const d = spin.definition
  const value = spin.value
  const range = d.max - d.min
  const pct = ((value - d.min) / range) * 100
  const centerPct = ((0 - d.min) / range) * 100
  const left = Math.min(pct, centerPct)
  const right = Math.max(pct, centerPct)

  const { handlers } = useKnobInteraction({ ...d, value, defaultValue: d.default,
    onChange: spin.setValue, gesture: 'horizontal', travel: 120, keyStep: true })

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={d.label}
      aria-valuemin={d.min}
      aria-valuemax={d.max}
      aria-valuenow={value}
      title="Drag sideways for spin · double-click to reset"
      {...handlers}
      className="relative h-[14px] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)] outline-none focus-visible:border-[var(--accent)]"
    >
      <span className="absolute top-0 h-full w-px bg-[var(--border-strong)]" style={{ left: `${centerPct}%` }} />
      <span className="absolute top-0 h-full bg-[var(--accent-muted)] opacity-70" style={{ left: `${left}%`, width: `${right - left}%` }} />
      <KnobValue draggable value={value} min={d.min} max={d.max} label={d.label} codec={numberEntry('×')} onChange={spin.setValue}
        className="absolute inset-0 flex items-center justify-center font-mono text-[8px] tabular-nums text-[var(--text-2)]">
        {value > 0 ? '+' : ''}{value.toFixed(1)}×
      </KnobValue>
    </div>
  )
}

function AxisColumn({ axis, orientation, spin }: { axis: string; orientation: NumberBound; spin: NumberBound }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 rounded-[3px] border border-[var(--border)] bg-[var(--bg-app)] px-1 pb-1.5 pt-2">
      <span className="text-[8px] font-semibold tracking-[0.14em] text-[var(--text-muted)] select-none">{axis}</span>
      <OrientationDial orientation={orientation} spin={spin} axis={axis} />
      <KnobValue value={orientation.value} min={orientation.definition.min} max={orientation.definition.max}
        label={orientation.definition.label} codec={numberEntry('°')} onChange={orientation.setValue}
        className="font-mono text-[9px] tabular-nums text-[var(--text-3)]">{Math.round(orientation.value)}°</KnobValue>
      <SpinPill spin={spin} />
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

export const RotateEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const speedX = findNumber(parameters, 'speedX')
  const speedY = findNumber(parameters, 'speedY')
  const speedZ = findNumber(parameters, 'speedZ')
  const offsetX = findNumber(parameters, 'offsetX')
  const offsetY = findNumber(parameters, 'offsetY')
  const offsetZ = findNumber(parameters, 'offsetZ')
  if (!speedX || !speedY || !speedZ || !offsetX || !offsetY || !offsetZ) {
    return <ParameterList parameters={parameters} />
  }

  return (
    <section data-testid="rotate-effect-user-interface">
      <div className="grid grid-cols-3 gap-1.5">
        <AxisColumn axis="X" orientation={offsetX} spin={speedX} />
        <AxisColumn axis="Y" orientation={offsetY} spin={speedY} />
        <AxisColumn axis="Z" orientation={offsetZ} spin={speedZ} />
      </div>
      <p className="mt-1.5 text-[8px] tracking-[0.04em] text-[var(--text-muted)] select-none">
        Dial = orientation · pill = spin speed
      </p>
      <Leftovers parameters={parameters} placed={['speedX', 'speedY', 'speedZ', 'offsetX', 'offsetY', 'offsetZ']} />
    </section>
  )
}
