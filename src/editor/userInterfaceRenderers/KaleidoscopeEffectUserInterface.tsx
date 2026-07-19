'use client'

import { Minus, Plus } from 'lucide-react'
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam, type NumberParamDef } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Kaleidoscope settings: a live mirror-wedge disc — wedge count tracks the
// segments param, alternating fills show the mirror folds, the whole disc turns
// when you drag it (rotation), spins at the real spin speed, scales with zoom,
// and its tint follows the hue shift. Segments get a +/- stepper; the rest are
// console sliders (hue on a rainbow track, spin bipolar).

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const TAU = Math.PI * 2

type NumberBound = { definition: NumberParamDef; value: number; setValue: (value: number | string) => void }

function findNumber(parameters: readonly UserInterfaceParameter[], key: string): NumberBound | null {
  const bound = parameters.find((p) => p.definition.key === key)
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  return bound as NumberBound
}

function snap(raw: number, d: NumberParamDef): number {
  return clamp(d.min + Math.round((raw - d.min) / d.step) * d.step, d.min, d.max)
}

function wedgePath(a0: number, a1: number, r: number): string {
  const x0 = 50 + r * Math.cos(a0)
  const y0 = 50 + r * Math.sin(a0)
  const x1 = 50 + r * Math.cos(a1)
  const y1 = 50 + r * Math.sin(a1)
  return `M50 50 L${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`
}

function MirrorDisc({ segments, rotation, zoom, spinSpeed, hueShift }: {
  segments: NumberBound
  rotation: NumberBound
  zoom: NumberBound
  spinSpeed: NumberBound
  hueShift: NumberBound
}) {
  const dragRef = useRef<{ pointerRad: number; value: number } | null>(null)
  const discRef = useRef<HTMLDivElement>(null)
  const d = rotation.definition

  const n = Math.max(2, Math.round(segments.value))
  const seg = TAU / n
  const hueDeg = (hueShift.value * 180) / Math.PI
  // Shader zooms out as zoom grows (r *= zoom), so the preview pattern shrinks.
  const patternScale = clamp(1 / Math.max(0.1, zoom.value), 0.4, 2.2)
  const spin = spinSpeed.value
  const spinDur = Math.abs(spin) > 0.001 ? TAU / Math.abs(spin) : 0

  const pointerRadians = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const rect = discRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerRad: pointerRadians(event), value: rotation.value }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    let delta = pointerRadians(event) - dragRef.current.pointerRad
    if (delta > Math.PI) delta -= TAU
    if (delta < -Math.PI) delta += TAU
    const wrapped = ((dragRef.current.value + delta) % TAU + TAU) % TAU
    rotation.setValue(snap(Math.min(wrapped, d.max), d))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="flex justify-center rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas-deep)] py-1.5">
      <style>{`@keyframes kaleido-fx-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      <div
        ref={discRef}
        data-testid="kaleidoscope-disc"
        role="slider"
        tabIndex={0}
        aria-label={d.label}
        aria-valuemin={d.min}
        aria-valuemax={d.max}
        aria-valuenow={rotation.value}
        title="Drag to rotate · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => rotation.setValue(d.default)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          rotation.setValue(snap(rotation.value + (event.key === 'ArrowRight' ? d.step : -d.step), d))
        }}
        className="h-[96px] w-[96px] cursor-grab touch-none select-none outline-none focus-visible:rounded-full focus-visible:ring-1 focus-visible:ring-[var(--accent)] active:cursor-grabbing"
      >
        <svg viewBox="0 0 100 100" className="h-full w-full">
          <defs>
            <clipPath id="kaleido-fx-clip"><circle cx="50" cy="50" r="46" /></clipPath>
          </defs>
          <circle cx="50" cy="50" r="46" fill="var(--bg-canvas)" stroke="var(--border-strong)" strokeWidth="1" />
          <g clipPath="url(#kaleido-fx-clip)">
            {/* outer group carries the real spin; inner carries drag rotation + zoom */}
            <g
              style={{
                transformOrigin: '50px 50px',
                animation: spinDur > 0 ? `kaleido-fx-spin ${spinDur.toFixed(2)}s linear infinite` : 'none',
                animationDirection: spin < 0 ? 'reverse' : 'normal',
              }}
            >
              <g transform={`rotate(${(rotation.value * 180) / Math.PI} 50 50) translate(50 50) scale(${patternScale.toFixed(3)}) translate(-50 -50)`}>
                {Array.from({ length: n }, (_, i) => {
                  const mirroredHalf = i % 2 === 1
                  return (
                    <path
                      key={i}
                      d={wedgePath(i * seg - Math.PI / 2, (i + 1) * seg - Math.PI / 2, 70)}
                      fill={`hsl(${(205 + hueDeg + (mirroredHalf ? 24 : 0)) % 360} 55% ${mirroredHalf ? 26 : 46}%)`}
                      stroke="var(--bg-canvas-deep)"
                      strokeWidth="0.6"
                      opacity="0.9"
                    />
                  )
                })}
              </g>
            </g>
          </g>
          {/* the source wedge marker: one un-mirrored slice boundary */}
          <line x1="50" y1="50" x2="50" y2="4" stroke="var(--text-muted)" strokeWidth="0.8" strokeDasharray="2 2" />
          <circle cx="50" cy="50" r="2.4" fill="var(--bg-canvas-deep)" stroke="var(--text-muted)" strokeWidth="0.8" />
        </svg>
      </div>
    </div>
  )
}

function SegmentStepper({ segments }: { segments: NumberBound }) {
  const d = segments.definition
  const n = Math.round(segments.value)
  const stepButton = (direction: -1 | 1, icon: ReactNode, label: string) => (
    <button
      aria-label={label}
      onClick={() => segments.setValue(snap(n + direction * d.step, d))}
      disabled={direction === -1 ? n <= d.min : n >= d.max}
      className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-3)] transition-all hover:text-[var(--text-2)] active:scale-90 disabled:cursor-default disabled:opacity-35"
    >
      {icon}
    </button>
  )

  return (
    <div className="mb-[13px] mt-2.5 grid grid-cols-[100px_1fr_44px] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={d.label}>{d.label}</span>
      <div className="flex items-center gap-1.5">
        {stepButton(-1, <Minus size={10} />, 'Fewer segments')}
        {/* detent strip: one notch per possible count, filled up to the current one */}
        <div className="relative h-[9px] min-w-0 flex-1 overflow-hidden rounded-[2px] border border-[var(--border)] bg-[var(--bg-canvas)]">
          <div
            className="absolute left-0 top-0 h-full"
            style={{
              width: `${((n - d.min) / (d.max - d.min)) * 100}%`,
              background: 'repeating-linear-gradient(90deg, var(--accent-muted) 0 3px, transparent 3px 5px)',
            }}
          />
        </div>
        {stepButton(1, <Plus size={10} />, 'More segments')}
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{n}</span>
    </div>
  )
}

/** Slider on a rainbow track — hue shift shows the hues it travels through. */
function HueSlider({ bound }: { bound: NumberBound }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const d = bound.definition
  const pct = ((bound.value - d.min) / (d.max - d.min)) * 100

  const setFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = clamp((clientX - rect.left) / rect.width, 0, 1)
    bound.setValue(snap(d.min + t * (d.max - d.min), d))
  }

  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr_44px] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={d.label}>{d.label}</span>
      <div
        ref={trackRef}
        role="slider"
        aria-label={d.label}
        aria-valuemin={d.min}
        aria-valuemax={d.max}
        aria-valuenow={bound.value}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromClientX(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromClientX(event.clientX)
        }}
        className="relative h-[7px] cursor-pointer touch-none select-none rounded-[2px]"
        style={{
          background: 'linear-gradient(90deg, hsl(205 55% 46%), hsl(295 55% 46%), hsl(25 55% 46%), hsl(115 55% 46%), hsl(205 55% 46%))',
          opacity: 0.9,
        }}
      >
        <div
          className="absolute top-1/2 h-[13px] w-[3px] -translate-y-1/2 border border-[var(--border-strong)] bg-[var(--text-2)]"
          style={{ left: `calc(${pct}% - 1px)` }}
        />
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{bound.value.toFixed(2)}</span>
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

export const KaleidoscopeEffectUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const segments = findNumber(parameters, 'segments')
  const rotation = findNumber(parameters, 'rotation')
  const zoom = findNumber(parameters, 'zoom')
  const spinSpeed = findNumber(parameters, 'spinSpeed')
  const hueShift = findNumber(parameters, 'hueShift')
  if (!segments || !rotation || !zoom || !spinSpeed || !hueShift) {
    return <ParameterList parameters={parameters} />
  }

  return (
    <section data-testid="kaleidoscope-effect-user-interface">
      <MirrorDisc segments={segments} rotation={rotation} zoom={zoom} spinSpeed={spinSpeed} hueShift={hueShift} />
      <SegmentStepper segments={segments} />
      <ParamSlider
        label={zoom.definition.label}
        value={zoom.value}
        min={zoom.definition.min}
        max={zoom.definition.max}
        step={zoom.definition.step}
        onChange={zoom.setValue}
      />
      <ParamSlider
        label={spinSpeed.definition.label}
        value={spinSpeed.value}
        min={spinSpeed.definition.min}
        max={spinSpeed.definition.max}
        step={spinSpeed.definition.step}
        onChange={spinSpeed.setValue}
      />
      <HueSlider bound={hueShift} />
      <Leftovers parameters={parameters} placed={['segments', 'rotation', 'zoom', 'spinSpeed', 'hueShift']} />
    </section>
  )
}
