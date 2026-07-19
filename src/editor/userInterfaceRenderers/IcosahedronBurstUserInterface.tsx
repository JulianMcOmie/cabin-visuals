'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Icosahedron Burst, organized as the two things a shell IS:
// its expansion (a live concentric diagram of start size, fade ring and max size,
// annotated with the resulting lifetime) and its color (gradient-track hue /
// saturation / lightness sliders plus a strip previewing the per-note hue walk).
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

/** Concentric-shell diagram: inner solid = start size, dashed = where fading
 *  begins, outer = max size. Radii scale to the same 0-20 world-unit range. */
function ShellDiagram({ startSize, maxSize, fadeStart, expansionSpeed }: {
  startSize: number; maxSize: number; fadeStart: number; expansionSpeed: number
}) {
  const toRadius = (size: number) => 4 + (Math.max(0, Math.min(20, size)) / 20) * 48
  const lifetime = (maxSize - startSize) / Math.max(0.001, expansionSpeed)
  return (
    <div className="mb-2 flex items-center gap-3">
      <svg aria-hidden="true" width="116" height="116" viewBox="0 0 116 116" className="flex-shrink-0">
        <circle cx="58" cy="58" r={toRadius(maxSize)} className="fill-none stroke-[var(--accent-muted)]" strokeWidth="1.4" />
        <circle cx="58" cy="58" r={toRadius(maxSize * fadeStart)} className="fill-none stroke-[var(--text-muted)]" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx="58" cy="58" r={toRadius(startSize)} className="fill-[color-mix(in_srgb,var(--accent-muted)_25%,transparent)] stroke-[var(--text-2)]" strokeWidth="1.2" />
        <circle cx="58" cy="58" r="1.4" className="fill-[var(--text-2)]" />
      </svg>
      <div className="min-w-0 space-y-1.5 font-mono text-[9px] leading-3 text-[var(--text-muted)] select-none">
        <p><span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full border border-[var(--text-2)] align-[-1px]" />born at {startSize.toFixed(2)}</p>
        <p><span className="mr-1.5 inline-block h-0 w-[7px] border-t border-dashed border-[var(--text-muted)] align-[2px]" />fades past {(maxSize * fadeStart).toFixed(1)}</p>
        <p><span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full border border-[var(--accent-muted)] align-[-1px]" />gone at {maxSize.toFixed(1)}</p>
        <p className="pt-1 text-[var(--text-3)]">{lifetime.toFixed(2)}s per shell</p>
      </div>
    </div>
  )
}

/** Slider whose track is a gradient - hue wheels, saturation and lightness ramps. */
function GradientSlider({ b, gradient, format }: { b: NumBinding; gradient: string; format: (v: number) => string }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const { def, value, set } = b
  const pct = ((value - def.min) / (def.max - def.min)) * 100

  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = def.min + t * (def.max - def.min)
    set(Math.max(def.min, Math.min(def.max, Number((def.min + Math.round((raw - def.min) / def.step) * def.step).toFixed(4)))))
  }

  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr_44px] items-center gap-2.5">
      <span className="text-[11px] text-[var(--text-3)] truncate" title={def.label}>{def.label}</span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={def.label}
        aria-valuemin={def.min}
        aria-valuemax={def.max}
        aria-valuenow={value}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromClientX(event.clientX)
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromClientX(event.clientX)
        }}
        onDoubleClick={() => set(def.default)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); set(Math.max(def.min, Number((value - def.step).toFixed(4)))) }
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); set(Math.min(def.max, Number((value + def.step).toFixed(4)))) }
        }}
        className="relative h-[8px] cursor-pointer touch-none rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        style={{ background: gradient }}
      >
        <span
          className="absolute top-1/2 h-[12px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-[var(--border-strong)] bg-[var(--text-2)]"
          style={{ left: `${pct}%` }}
        />
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{format(value)}</span>
    </div>
  )
}

/** Preview of the hue walk: the colors shells take across eight successive notes. */
function HueWalkStrip({ baseHue, hueStep, saturation, lightness }: {
  baseHue: number; hueStep: number; saturation: number; lightness: number
}) {
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5 select-none">
      <span className="text-[11px] text-[var(--text-3)]">Next 8 notes</span>
      <div className="flex h-[14px] gap-px overflow-hidden rounded-sm">
        {Array.from({ length: 8 }, (_, index) => (
          <span
            key={index}
            className="flex-1"
            title={`Note ${index + 1}`}
            style={{ background: `hsl(${(((baseHue + index * hueStep) % 1) * 360).toFixed(0)} ${(saturation * 100).toFixed(0)}% ${(lightness * 100).toFixed(0)}%)` }}
          />
        ))}
      </div>
    </div>
  )
}

export const IcosahedronBurstUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bind(parameters)
  const startSize = b.num('startSize')
  const maxSize = b.num('maxSize')
  const expansionSpeed = b.num('expansionSpeed')
  const fadeStart = b.num('fadeStart')
  const baseHue = b.num('baseHue')
  const hueStep = b.num('hueStep')
  const saturation = b.num('saturation')
  const lightness = b.num('lightness')
  const rest = b.rest()

  const hue = baseHue ? baseHue.value : 0.55
  const sat = saturation ? saturation.value : 0.9
  const lig = lightness ? lightness.value : 0.6
  const hueDeg = (hue * 360).toFixed(0)

  return (
    <section data-testid="icosahedron-burst-user-interface" className="mb-4">
      <header className="mb-2.5 flex items-center gap-2 select-none">
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" className="fill-none stroke-[var(--accent)]" strokeWidth="1.5">
          <polygon points="12,2 20,7 21,16 12,22 3,16 4,7" />
          <path d="M4 7l17 9M20 7L3 16M12 2v20" />
        </svg>
        <span className="text-[10px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">ICOSAHEDRON BURST</span>
      </header>

      <p className="mb-1.5 text-[9px] font-semibold tracking-[0.1em] text-[var(--text-muted)] select-none">SHELL</p>
      {startSize && maxSize && fadeStart && expansionSpeed && (
        <ShellDiagram
          startSize={startSize.value}
          maxSize={maxSize.value}
          fadeStart={fadeStart.value}
          expansionSpeed={expansionSpeed.value}
        />
      )}
      <Row b={startSize} />
      <Row b={maxSize} />
      <Row b={expansionSpeed} />
      <Row b={fadeStart} />

      <p className="mb-1.5 mt-4 text-[9px] font-semibold tracking-[0.1em] text-[var(--text-muted)] select-none">COLOR</p>
      {baseHue && (
        <GradientSlider
          b={baseHue}
          gradient="linear-gradient(90deg, hsl(0 85% 55%), hsl(60 85% 55%), hsl(120 85% 45%), hsl(180 85% 45%), hsl(240 85% 60%), hsl(300 85% 55%), hsl(360 85% 55%))"
          format={(v) => `${(v * 360).toFixed(0)}°`}
        />
      )}
      {saturation && (
        <GradientSlider
          b={saturation}
          gradient={`linear-gradient(90deg, hsl(${hueDeg} 0% ${(lig * 100).toFixed(0)}%), hsl(${hueDeg} 100% ${(lig * 100).toFixed(0)}%))`}
          format={(v) => `${(v * 100).toFixed(0)}%`}
        />
      )}
      {lightness && (
        <GradientSlider
          b={lightness}
          gradient={`linear-gradient(90deg, hsl(${hueDeg} ${(sat * 100).toFixed(0)}% 8%), hsl(${hueDeg} ${(sat * 100).toFixed(0)}% 50%), hsl(${hueDeg} ${(sat * 100).toFixed(0)}% 92%))`}
          format={(v) => `${(v * 100).toFixed(0)}%`}
        />
      )}
      <Row b={hueStep} />
      {hueStep && <HueWalkStrip baseHue={hue} hueStep={hueStep.value} saturation={sat} lightness={lig} />}

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
