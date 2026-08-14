'use client'

// Bespoke settings for Icosahedron Burst, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console),
// organized as the two things a shell IS: its expansion (a live concentric
// window - start size, fade ring, max size - annotated with the resulting
// lifetime) and its color (gradient-track hue / saturation / lightness
// sliders plus a strip previewing the per-note hue walk). The gradient
// sliders stay sliders ON PURPOSE: their tracks ARE the value space (a hue
// wheel unrolled), which a knob arc cannot show.

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  withAlpha,
  type NumBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** The instrument's declared identity (IcosahedronBurst.tsx `identityColor`). */
const ACCENT = '#7c5cff'

/** Concentric-shell window: inner solid = start size, dashed = where fading
 *  begins, outer = max size. Radii scale to the same 0-20 world-unit range.
 *  The legend sits inside the window - it is what the window means. */
function ShellWindow({ startSize, maxSize, fadeStart, expansionSpeed }: {
  startSize: number; maxSize: number; fadeStart: number; expansionSpeed: number
}) {
  const toRadius = (size: number) => 4 + (Math.max(0, Math.min(20, size)) / 20) * 48
  const lifetime = (maxSize - startSize) / Math.max(0.001, expansionSpeed)
  return (
    <PreviewWindow height={132} testId="icosahedron-shell-window">
      <div className="flex h-full items-center justify-center gap-4">
        <svg aria-hidden="true" width="116" height="116" viewBox="0 0 116 116" className="flex-shrink-0">
          <circle cx="58" cy="58" r={toRadius(maxSize)} fill="none" stroke={withAlpha(ACCENT, 0.55)} strokeWidth="1.4" />
          <circle cx="58" cy="58" r={toRadius(maxSize * fadeStart)} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx="58" cy="58" r={toRadius(startSize)} fill={withAlpha(ACCENT, 0.22)} stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" />
          <circle cx="58" cy="58" r="1.4" fill="rgba(255,255,255,0.7)" />
        </svg>
        <div className="min-w-0 space-y-1.5 font-mono text-[9px] leading-3 text-white/45 select-none">
          <p><span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full border border-white/70 align-[-1px]" />born at {startSize.toFixed(2)}</p>
          <p><span className="mr-1.5 inline-block h-0 w-[7px] border-t border-dashed border-white/30 align-[2px]" />fades past {(maxSize * fadeStart).toFixed(1)}</p>
          <p><span className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full border align-[-1px]" style={{ borderColor: withAlpha(ACCENT, 0.55) }} />gone at {maxSize.toFixed(1)}</p>
          <p className="pt-1 text-white/60">{lifetime.toFixed(2)}s per shell</p>
        </div>
      </div>
    </PreviewWindow>
  )
}

/** Slider whose track is a gradient - hue wheel, saturation and lightness
 *  ramps. Kept a SLIDER (the one sanctioned exception to knobs-only): the
 *  track paints the actual value space, so the control doubles as the legend. */
function GradientSlider({ b, label, gradient, format }: {
  b: NumBinding
  label: string
  gradient: string
  format: (v: number) => string
}) {
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
    <div className="grid grid-cols-[64px_1fr_44px] items-center gap-2.5">
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40" title={def.label}>{label}</span>
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
        className="relative h-[8px] cursor-pointer touch-none rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-white/50"
        style={{ background: gradient }}
      >
        <span
          className="absolute top-1/2 h-[12px] w-[6px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-black/60 bg-white/90"
          style={{ left: `${pct}%` }}
        />
      </div>
      <span className="text-right font-mono text-[9px] tabular-nums text-white/70">{format(value)}</span>
    </div>
  )
}

/** Preview of the hue walk: the colors shells take across eight successive notes. */
function HueWalkStrip({ baseHue, hueStep, saturation, lightness }: {
  baseHue: number; hueStep: number; saturation: number; lightness: number
}) {
  return (
    <div className="grid grid-cols-[64px_1fr] items-center gap-2.5 select-none">
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/25">NEXT 8</span>
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
  const b = bindPanel(parameters)
  const startSize = b.num('startSize')
  const maxSize = b.num('maxSize')
  const expansionSpeed = b.num('expansionSpeed')
  const fadeStart = b.num('fadeStart')
  const baseHue = b.num('baseHue')
  const hueStep = b.num('hueStep')
  const saturation = b.num('saturation')
  const lightness = b.num('lightness')

  if (!startSize || !maxSize || !expansionSpeed || !fadeStart) return <ParameterList parameters={parameters} />

  const hue = baseHue ? baseHue.value : 0.55
  const sat = saturation ? saturation.value : 0.9
  const lig = lightness ? lightness.value : 0.6
  const hueDeg = (hue * 360).toFixed(0)

  return (
    <Console accent={ACCENT} testId="icosahedron-burst-user-interface">
      <ShellWindow
        startSize={startSize.value}
        maxSize={maxSize.value}
        fadeStart={fadeStart.value}
        expansionSpeed={expansionSpeed.value}
      />
      <ControlRow spill className="gap-5 px-4 pb-3 pt-2">
        <Knob b={startSize} label="BORN" large />
        <Knob b={maxSize} label="GONE" />
        <Knob b={expansionSpeed} label="SPEED" />
        <Knob b={fadeStart} label="FADE AT" />
        <Knob b={hueStep} label="HUE WALK" />
      </ControlRow>
      <div className="flex flex-col gap-2.5 px-3 pb-3">
        {baseHue && (
          <GradientSlider
            b={baseHue}
            label="HUE"
            gradient="linear-gradient(90deg, hsl(0 85% 55%), hsl(60 85% 55%), hsl(120 85% 45%), hsl(180 85% 45%), hsl(240 85% 60%), hsl(300 85% 55%), hsl(360 85% 55%))"
            format={(v) => `${(v * 360).toFixed(0)}°`}
          />
        )}
        {saturation && (
          <GradientSlider
            b={saturation}
            label="CHROMA"
            gradient={`linear-gradient(90deg, hsl(${hueDeg} 0% ${(lig * 100).toFixed(0)}%), hsl(${hueDeg} 100% ${(lig * 100).toFixed(0)}%))`}
            format={(v) => `${(v * 100).toFixed(0)}%`}
          />
        )}
        {lightness && (
          <GradientSlider
            b={lightness}
            label="LIGHT"
            gradient={`linear-gradient(90deg, hsl(${hueDeg} ${(sat * 100).toFixed(0)}% 8%), hsl(${hueDeg} ${(sat * 100).toFixed(0)}% 50%), hsl(${hueDeg} ${(sat * 100).toFixed(0)}% 92%))`}
            format={(v) => `${(v * 100).toFixed(0)}%`}
          />
        )}
        {hueStep && <HueWalkStrip baseHue={hue} hueStep={hueStep.value} saturation={sat} lightness={lig} />}
      </div>
      <More parameters={b.rest()} label="MORE" className="px-3 pb-3" />
    </Console>
  )
}
