'use client'

// Bespoke settings for Strobe, following docs/instrument-panel-design-guide.md:
// full-bleed, no card chrome, no in-panel title, washed with a hue-true dark
// shade of the instrument's accent. A live preview that actually flashes, the
// rate vocabulary, then STYLE / DEPTH / WIDTH.
//
// Two things are specific to this instrument.
//
// Rate is NOT here, because rate is a MIDI row (see instruments/Strobe.tsx). The
// strip under the preview is therefore a legend first and a control second: it
// names every rate the piano roll offers, with its pitch, and picking one aims
// the PREVIEW at that rate without writing anything to the track. Without it the
// panel would quietly imply the three knobs are the whole instrument.
//
// And the preview flashes through CSS rather than a render pass. `filter:
// invert(x)` interpolates exactly like the shader's `mix(color, 1.0 - color, x)`,
// and blackout/flash are a veil at the same opacity - so the preview is the real
// math on real pixels, not a lookalike, and it costs one style write per frame
// instead of a WebGL context.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import {
  STROBE_RATE_ROWS,
  STROBE_STYLE_BLACKOUT,
  STROBE_STYLE_FLASH,
  STROBE_STYLE_INVERT,
  strobeGate,
} from '../instruments/Strobe'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Strobe exposes no color param, so its accent is the flash-bulb yellow its
 *  identity color and library icon already use - one identity across the app. */
const ACCENT = '#fde047'

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

// ── Live preview ────────────────────────────────────────────────────────────

/** Preview beats per wall-clock second (120bpm), matching Bass Ripple's preview
 *  so the two panels tick at the same imagined tempo. */
const PREVIEW_BEATS_PER_SECOND = 2

/** A scrap of stage for the flash to act on. Saturated complementary-ish fills,
 *  because inversion is only legible against colour that visibly flips: the cyan
 *  goes red, the pink goes green, and the near-black ground goes white.
 *
 *  The viewBox is deliberately WIDE (the panel is a letterbox roughly 5:1) and
 *  every shape stays inside the middle band: `slice` scales to cover, so a
 *  square-ish viewBox would blow up and crop the stage out of frame, and shapes
 *  near the top or bottom edge would be the first thing lost at other widths. */
function PreviewStage() {
  return (
    <svg viewBox="0 0 520 120" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="520" height="120" fill="#05070c" />
      <circle cx="150" cy="56" r="27" fill="#22d3ee" />
      <path d="M260 27 L289 79 L231 79 Z" fill="#f472b6" />
      <rect x="330" y="34" width="52" height="46" rx="5" fill="#a78bfa" />
      <rect x="150" y="94" width="232" height="7" rx="3.5" fill={ACCENT} />
      <path d="M0 110 H520" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
    </svg>
  )
}

function StrobePreview({ style, depth, width, beatsPerCycle }: {
  style: number
  depth: number
  width: number
  beatsPerCycle: number
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const veilRef = useRef<HTMLDivElement>(null)
  // The loop reads the LATEST values without restarting: re-arming the animation
  // on every knob turn would reset the phase and make the flash stutter while
  // being adjusted, which is exactly when it needs to be steady.
  const live = useRef({ style, depth, width, beatsPerCycle })
  live.current = { style, depth, width, beatsPerCycle }

  useEffect(() => {
    let frame = 0
    let origin = 0
    // Styles are written imperatively, never through state: at the fastest rate
    // this fires ~32 times a second, and re-rendering the panel that often to
    // flash a div would be absurd. The stage mutates; React owns the layout.
    const tick = (now: number) => {
      if (!origin) origin = now
      const beat = ((now - origin) / 1000) * PREVIEW_BEATS_PER_SECOND
      const current = live.current
      const lit = strobeGate(beat, current.beatsPerCycle, current.width) * current.depth
      const stage = stageRef.current
      const veil = veilRef.current
      if (stage && veil) {
        const inverting = current.style === STROBE_STYLE_INVERT
        stage.style.filter = inverting && lit > 0 ? `invert(${lit})` : 'none'
        veil.style.background = current.style === STROBE_STYLE_FLASH ? '#ffffff' : '#000000'
        veil.style.opacity = inverting ? '0' : String(lit)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      data-testid="strobe-preview"
      className="relative h-[120px] overflow-hidden border-b border-white/[0.06] bg-[#05070c]"
    >
      <div ref={stageRef} className="absolute inset-0">
        <PreviewStage />
      </div>
      <div ref={veilRef} className="pointer-events-none absolute inset-0 opacity-0" />
    </div>
  )
}

// ── The rate legend ─────────────────────────────────────────────────────────

/** The rows the piano roll will show, with the pitch that plays each one. Picking
 *  a chip only aims the preview - rate is played, not set, so this writes nothing
 *  to the track. `1/16` is pre-selected: it is the row the instrument emphasizes
 *  and the "rapid fire" the strobe is for. */
function RateLegend({ selected, onSelect }: {
  selected: number
  onSelect: (beatsPerCycle: number) => void
}) {
  return (
    <div className="px-3 pt-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">RATE</span>
        <span className="text-[8px] text-white/25">played as a MIDI row</span>
      </div>
      <div className="flex gap-1">
        {STROBE_RATE_ROWS.map((row) => {
          const active = row.beatsPerCycle === selected
          const [division] = row.label.split(' · ')
          return (
            <button
              key={row.pitch}
              type="button"
              aria-pressed={active}
              title={`${row.label} · pitch ${row.pitch}`}
              onClick={() => onSelect(row.beatsPerCycle)}
              className={`flex min-w-0 flex-1 flex-col items-center rounded-sm border py-[3px] transition-colors ${
                active
                  ? 'border-transparent bg-[#fde047] text-black'
                  : 'border-white/10 bg-black/25 text-white/55 hover:bg-white/[0.06]'
              }`}
            >
              <span className="font-mono text-[9px] leading-tight tabular-nums">{division}</span>
              <span className={`font-mono text-[7px] leading-tight tabular-nums ${active ? 'text-black/55' : 'text-white/25'}`}>
                {row.pitch}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

/** Each glyph IS its look, sketched on the same light-to-dark ramp Color Filters'
 *  swatches use: a half-flipped disc, a black frame, a white frame. */
const STYLE_GLYPHS: Record<number, ReactElement> = {
  [STROBE_STYLE_INVERT]: (
    <>
      <path d="M8 1.5 A6.5 6.5 0 0 0 8 14.5 Z" fill="currentColor" />
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
  [STROBE_STYLE_BLACKOUT]: (
    <>
      <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.6" fill="#000" />
      <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </>
  ),
  [STROBE_STYLE_FLASH]: (
    <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="1.6" fill="currentColor" />
  ),
}

function StyleSelector({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : definition.default
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {definition.options.map((option) => {
          const active = option.value === selected
          return (
            <button
              key={option.value}
              type="button"
              aria-label={option.label}
              aria-pressed={active}
              title={`${option.label} on every flash`}
              onClick={() => bound.setValue(option.value)}
              className={`px-1.5 pb-0.5 pt-1 transition-colors ${active ? 'bg-[#fde047] text-black' : 'bg-black/25 text-white/45 hover:bg-white/5'}`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16">
                {STYLE_GLYPHS[option.value] ?? STYLE_GLYPHS[STROBE_STYLE_INVERT]}
              </svg>
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">STYLE</span>
      <span className="font-mono text-[9px] text-white/70">
        {definition.options.find((option) => option.value === selected)?.label.toUpperCase() ?? ''}
      </span>
    </div>
  )
}

/** The panel's continuous-control vocabulary, to the design guide's knob spec:
 *  flat face, 270° accent arc from 7 o'clock built as three stacked copies so the
 *  light lives only along the lit portion, white needle, white-hot dot at the
 *  arc's tip. Vertical drag over ~140px of travel, double-click resets, arrows
 *  nudge, and the param's response curve is honored the way ParamSlider does. */
function StrobeKnob({ parameter: bound, label, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  /** The instrument's primary param (DEPTH) reads a step larger. */
  large?: boolean
}) {
  const dragRef = useRef<{ y: number; norm: number } | null>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const curve = definition.curve ?? 1
  const range = definition.max - definition.min
  const norm = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const percent = Math.pow(norm, 1 / curve)
  const angle = -135 + percent * 270

  const commitNorm = (t: number) => {
    const raw = definition.min + Math.pow(clamp(t, 0, 1), curve) * range
    const snapped = curve === 1
      ? definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
      : raw === 0 ? 0 : Number(raw.toPrecision(3))
    bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    // Capture can throw for exotic/synthetic pointers; the drag still works
    // through the move/up handlers on the element itself.
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    dragRef.current = { y: event.clientY, norm: percent }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commitNorm(dragRef.current.norm + (dragRef.current.y - event.clientY) / 140)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commitNorm(percent + direction * 0.03)
  }

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title="Drag vertically · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className={`relative ${large ? 'h-[52px] w-[52px]' : 'h-11 w-11'} cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${ACCENT} 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(6px)',
            transform: 'scale(1.16)',
            opacity: 0.9,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${towardWhite(ACCENT, 0.35)} 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(1.5px)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${towardWhite(ACCENT, 0.82)} 0deg ${percent * 270}deg, rgba(255,255,255,0.08) ${percent * 270}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#14171f]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[5px] h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-white/90" />
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 5px 1.5px ${ACCENT}` }}
          />
        </div>
      </div>
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
      {/* Both knobs are 0..1 fractions of something - how far the frame flips,
          how much of the cycle is lit - and percent is how you talk about that. */}
      <span className="font-mono text-[9px] tabular-nums text-white/70">{Math.round(value * 100)}%</span>
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

/** Which rate the preview flashes at, defaulting to the row the instrument
 *  emphasizes. View state only - it never reaches the track. */
const DEFAULT_PREVIEW_RATE = STROBE_RATE_ROWS.find((row) => row.emphasized)?.beatsPerCycle
  ?? STROBE_RATE_ROWS[0].beatsPerCycle

export const StrobeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const style = parameter(parameters, 'style')
  const depth = parameter(parameters, 'depth')
  const width = parameter(parameters, 'width')
  const [previewRate, setPreviewRate] = useState(DEFAULT_PREVIEW_RATE)

  const shade = useMemo(() => {
    const accentHsv = hexToHsv(ACCENT)
    // A hue-true dark shade, not an alpha tint - low-alpha accent over the
    // panel's mid-gray mixes into mud (see the design guide).
    return hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)
  }, [])

  if (!style || !depth || !width) return <ParameterList parameters={parameters} />

  return (
    <section data-testid="strobe-user-interface" className="-mx-3 -mt-3" style={{ background: shade }}>
      <StrobePreview
        style={typeof style.value === 'number' ? Math.round(style.value) : STROBE_STYLE_INVERT}
        depth={numericValue(depth, 1)}
        width={numericValue(width, 0.5)}
        beatsPerCycle={previewRate}
      />
      <RateLegend selected={previewRate} onSelect={setPreviewRate} />
      <div
        className="flex items-end justify-center gap-5 px-4 pb-3 pt-2"
        // The preview's light spilling through the seam onto the console - the
        // one earned gradient, per the guide.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(ACCENT, 0.14)}, transparent)` }}
      >
        <StyleSelector bound={style} />
        <StrobeKnob parameter={depth} label="DEPTH" large />
        <StrobeKnob parameter={width} label="WIDTH" />
      </div>
    </section>
  )
}
