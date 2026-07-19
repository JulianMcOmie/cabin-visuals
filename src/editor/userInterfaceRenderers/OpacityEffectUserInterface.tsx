'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Opacity settings: one big vertical fader (this effect IS one number, so give
// it a channel-strip throw) next to a checkerboard-backed swatch whose panel
// fades live with the value, a large percent readout, and stop chips.

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

const CHECKER = {
  background: 'repeating-conic-gradient(var(--bg-elevated) 0% 25%, var(--bg-canvas) 0% 50%)',
  backgroundSize: '10px 10px',
} as const

function Fader({ opacity }: { opacity: NumberBound }) {
  const railRef = useRef<HTMLDivElement>(null)
  const d = opacity.definition
  const pct = ((opacity.value - d.min) / (d.max - d.min)) * 100

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = railRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
    opacity.setValue(snap(d.min + t * (d.max - d.min), d))
  }

  return (
    <div
      ref={railRef}
      data-testid="opacity-fader"
      role="slider"
      tabIndex={0}
      aria-label={d.label}
      aria-valuemin={d.min}
      aria-valuemax={d.max}
      aria-valuenow={opacity.value}
      aria-orientation="vertical"
      title="Drag to fade · double-click for full opacity"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      onDoubleClick={() => opacity.setValue(d.default)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        opacity.setValue(snap(opacity.value + (event.key === 'ArrowUp' ? d.step : -d.step), d))
      }}
      className="relative h-[110px] w-[30px] flex-shrink-0 cursor-ns-resize touch-none select-none rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas)] outline-none focus-visible:border-[var(--accent)]"
    >
      {/* tick marks every 25% */}
      {[0, 25, 50, 75, 100].map((tick) => (
        <span key={tick} aria-hidden="true" className="absolute left-[3px] h-px w-[5px] bg-[var(--border-strong)]" style={{ bottom: `${tick}%` }} />
      ))}
      {/* fill: fades itself out toward the bottom, like the layer it controls */}
      <span
        className="absolute bottom-0 left-[10px] w-[10px] rounded-t-[1px]"
        style={{ height: `${pct}%`, background: 'linear-gradient(to top, transparent, var(--accent-muted))' }}
      />
      {/* fader cap */}
      <span
        className="absolute left-[2px] h-[10px] w-[24px] rounded-[2px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-[0_2px_5px_rgba(0,0,0,.5)]"
        style={{ bottom: `calc(${pct}% - 5px)` }}
      >
        <span className="absolute left-1/2 top-1/2 h-px w-[16px] -translate-x-1/2 -translate-y-1/2 bg-[var(--text-3)]" />
      </span>
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

export const OpacityEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const opacity = findNumber(parameters, 'opacity')
  if (!opacity) return <ParameterList parameters={parameters} />
  const d = opacity.definition
  const fraction = d.max > d.min ? (opacity.value - d.min) / (d.max - d.min) : 0

  return (
    <section data-testid="opacity-effect-user-interface">
      <div className="flex gap-2">
        <Fader opacity={opacity} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* live swatch: accent panel over a checkerboard, at the real opacity */}
          <div className="relative h-[64px] overflow-hidden rounded-[3px] border border-[var(--border)]" style={CHECKER}>
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-muted))',
                opacity: fraction,
              }}
            />
            <span className="absolute bottom-1 right-1.5 font-mono text-[13px] font-semibold tabular-nums text-[var(--text-2)] [text-shadow:0_1px_3px_rgba(0,0,0,.7)]">
              {Math.round(fraction * 100)}%
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {[0, 0.25, 0.5, 0.75, 1].map((stop) => {
              const active = Math.abs(opacity.value - stop) < d.step / 2
              return (
                <button
                  key={stop}
                  aria-label={`Set opacity ${Math.round(stop * 100)}%`}
                  aria-pressed={active}
                  onClick={() => opacity.setValue(snap(d.min + stop * (d.max - d.min), d))}
                  className={`cursor-pointer rounded-[3px] border py-1 font-mono text-[8px] tabular-nums transition-all active:scale-95 ${active
                    ? 'border-[var(--accent-muted)] bg-[var(--accent-muted)]/20 text-[var(--text-2)]'
                    : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
                >
                  {Math.round(stop * 100)}
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <Leftovers parameters={parameters} placed={['opacity']} />
    </section>
  )
}
