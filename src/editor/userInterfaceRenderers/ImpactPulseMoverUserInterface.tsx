'use client'

// Bespoke settings for the Impact Pulse mover (definition id 'impactPulse'),
// built to docs/instrument-panel-design-guide.md.
//
// One window, two readouts of the same instant: on the left the object itself
// taking the hit, on the right the size curve with a playhead riding it. Both
// are driven from ONE clock through the mover's OWN evaluator
// (evaluateImpactPulse / impactPulseScale), so the shape that punches here is
// exactly the shape the engine renders - the picture cannot drift from the
// sound. The two dim rings behind the subject are copies 1 and 2: at ROLL 0
// they sit exactly under it and disappear, and turning ROLL up walks them out
// of phase, which is the whole of what that knob does.
//
// The curve is plotted in LOG SIZE (log2 of the scale factor), because that is
// the space the mover actually works in - a swell and its mirror-image squash
// are then the same distance from the baseline, and HIT reads as height rather
// than as an invisible multiplier.
//
// Deliberately NOT a react-three-fiber preview: per the note in this
// directory's CLAUDE.md, a panel canvas stays black until the transport plays,
// and a size pulse is exactly the thing you need to see while parked. Plain
// DOM transforms always animate.

import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  PULSE_EVEN,
  PULSE_SNAP,
  PULSE_SWELL_PITCH,
  PULSE_TAIL,
  evaluateImpactPulse,
  impactPulseScale,
  pulseFalloff,
  type ImpactPulseSettings,
} from '../core/visualCopies/impactPulse'
import { IMPACT_PULSE_COLOR } from '../core/visualCopies/identityColors'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import { usePreviewLoop } from './console'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { clamp } from '../utils/math'

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

// The accent comes FROM THE DEFINITION, which also hands it to the track as
// `identityColor` - so this console, the mover's timeline blocks, its
// piano-roll notes and the inspector's tab rail are all one colour by
// construction. Never re-declare the hex here; that is exactly the drift the
// shared constant exists to prevent.
const STRIKE = IMPACT_PULSE_COLOR
const STRIKE_HSV = hexToHsv(STRIKE)
/** Hue-true dark shade per the guide - never an alpha tint over panel gray. */
const SHADE = hsvToHex(STRIKE_HSV.h, Math.min(STRIKE_HSV.s, 0.5), 0.075)
const ROOM = '#05070c'

// ── The demo clock ───────────────────────────────────────────────────────────
// One synthetic full-velocity swell at beat 0, looped: the decay, then a gap of
// rest so "back to normal" is part of what is being shown.

const BEATS_PER_SECOND = 1.6
/** How many upstream copies the ROLL ghosts stand in for. */
const GHOST_COUNT = 2

const DEMO_NOTES = [{
  beat: 0,
  pitch: PULSE_SWELL_PITCH,
  velocity: 1,
  durationBeats: 0.25,
  blockStartBeat: 0,
  blockEndBeat: 1024,
}]

function loopBeat(nowMs: number, total: number): number {
  return ((nowMs / 1000) * BEATS_PER_SECOND) % total
}

/** Sample the real mover: signed pulse for one copy index at one beat. */
function samplePulse(settings: ImpactPulseSettings, beat: number, index: number): number {
  return evaluateImpactPulse(DEMO_NOTES, settings, beat, index)
}

// ── The window ───────────────────────────────────────────────────────────────

const PLOT_X0 = 4
const PLOT_X1 = 96
const PLOT_BASE = 82
const PLOT_TOP = 10

/**
 * The vertical axis is log2(scale) put through a SATURATING map rather than
 * divided by a fixed span. A linear axis has to be scaled for the mover's
 * theoretical maximum - (1+HIT)^(1+STRETCH), which reaches 4x - and then the
 * settings people actually use spend the window's bottom fifth: at the default
 * HIT the curve was a 13%-tall bump on an empty field, which reads as a broken
 * panel rather than as a subtle hit. Saturating keeps every setting legible,
 * never clips at the extremes, and still moves whenever HIT moves.
 */
const PLOT_KNEE = 0.45

/** Where the object's SIZE is at this beat, as a fraction of the plot height
 *  above the baseline. Reads the mover's up-axis scale so STRETCH lifts the
 *  curve exactly as it lifts the object. */
function plotHeight(settings: ImpactPulseSettings, beat: number, index = 0): number {
  const scale = impactPulseScale(samplePulse(settings, beat, index), settings.hit, settings.stretch)[1]
  const octaves = Math.log2(scale)
  return octaves / (Math.abs(octaves) + PLOT_KNEE)
}

/** How many beats of timeline the window shows. Proportional to DECAY so a
 *  short hit is not squeezed into the left fifth, with a one-beat floor so the
 *  beat grid below always has something to say. */
function windowBeats(decayBeats: number): number {
  return Math.max(1.25, decayBeats * 1.45)
}

const toPlotY = (height: number) => PLOT_BASE - height * (PLOT_BASE - PLOT_TOP)

function PulseWindow({ settings }: { settings: ImpactPulseSettings }) {
  const dotRef = useRef<HTMLDivElement>(null)
  const subjectRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const ghostRefs = useRef<(HTMLDivElement | null)[]>([])

  const total = windowBeats(settings.decayBeats)

  // One faint line per beat: without it an adaptive x-axis makes every DECAY
  // look the same, because the shape alone is self-similar.
  const gridBeats: number[] = []
  for (let beat = 1; beat < total; beat++) gridBeats.push(beat)

  let path = ''
  const samples = 220
  for (let i = 0; i <= samples; i++) {
    const beat = (i / samples) * total
    const x = PLOT_X0 + (beat / total) * (PLOT_X1 - PLOT_X0)
    path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${toPlotY(plotHeight(settings, beat)).toFixed(2)}`
  }
  const fillPath = `${path} L${PLOT_X1},${PLOT_BASE} L${PLOT_X0},${PLOT_BASE} Z`

  // The whole animation reads live settings out of a ref, so changing a knob
  // never restarts the loop (and the effect never re-subscribes).
  const liveRef = useRef({ settings, total })
  liveRef.current = { settings, total }

  const hostRef = usePreviewLoop((tSec) => {
    const live = liveRef.current
    const beat = loopBeat(tSec * 1000, live.total)

    const dot = dotRef.current
    if (dot) {
      dot.style.left = `${PLOT_X0 + (beat / live.total) * (PLOT_X1 - PLOT_X0)}%`
      dot.style.top = `${toPlotY(plotHeight(live.settings, beat))}%`
    }

    const pulse = samplePulse(live.settings, beat, 0)
    const [across, up] = impactPulseScale(pulse, live.settings.hit, live.settings.stretch)
    const subject = subjectRef.current
    if (subject) {
      subject.style.transform = `scale(${across.toFixed(4)}, ${up.toFixed(4)})`
      // The face brightens with the hit - the object is what is lit, so the
      // eye lands on it even when HIT is small enough to barely move it.
      subject.style.background = withAlpha(STRIKE, 0.24 + Math.max(0, pulse) * 0.5)
    }
    // The room is lit BY the instrument: a pool of light around the object
    // that blooms with the hit. This is what makes a subtle pulse legible -
    // at the default HIT the object itself only moves a few pixels, but the
    // light around it visibly flares.
    const glow = glowRef.current
    if (glow) {
      const lit = Math.max(0, pulse)
      glow.style.transform = `scale(${(0.85 + lit * 0.6).toFixed(4)})`
      glow.style.opacity = `${(0.18 + lit * 0.72).toFixed(3)}`
    }

    for (let i = 0; i < GHOST_COUNT; i++) {
      const ghost = ghostRefs.current[i]
      if (!ghost) continue
      const ghostPulse = samplePulse(live.settings, beat, i + 1)
      const [gx, gy] = impactPulseScale(ghostPulse, live.settings.hit, live.settings.stretch)
      ghost.style.transform = `scale(${gx.toFixed(4)}, ${gy.toFixed(4)})`
    }
  })

  return (
    <div
      ref={hostRef}
      data-testid="impact-pulse-window"
      className="relative flex h-[120px] overflow-hidden border-b border-white/[0.06]"
      style={{ background: ROOM }}
    >
      {/* ── the object taking the hit ──
          A FIXED width, not a fraction: the settings panel is resizable, and a
          percentage turned the stage into a wide empty field with a 34px
          object marooned in it the moment the panel was dragged wide. */}
      <div className="relative w-[126px] shrink-0" aria-hidden="true">
        <div
          ref={glowRef}
          className="absolute left-1/2 top-1/2 h-[104px] w-[104px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: `radial-gradient(circle, ${withAlpha(STRIKE, 0.5)}, transparent 70%)`, opacity: 0.18 }}
        />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {/* Copies 1 and 2 as rings: stacked exactly under the subject at
              ROLL 0, walking out of phase as it turns. */}
          {Array.from({ length: GHOST_COUNT }, (_, i) => (
            <div
              key={i}
              ref={(node) => { ghostRefs.current[i] = node }}
              className="absolute left-1/2 top-1/2 h-[34px] w-[34px] -translate-x-1/2 -translate-y-1/2 rounded-[9px] border"
              style={{ borderColor: withAlpha(STRIKE, 0.3 - i * 0.11) }}
            />
          ))}
          <div
            ref={subjectRef}
            data-testid="impact-pulse-subject"
            className="h-[34px] w-[34px] rounded-[9px] border"
            style={{
              background: withAlpha(STRIKE, 0.24),
              borderColor: withAlpha(STRIKE, 0.65),
              boxShadow: `0 0 12px 0 ${withAlpha(STRIKE, 0.35)}`,
            }}
          />
        </div>
      </div>

      <div className="w-px shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }} />

      {/* ── the size curve ── */}
      <div className="relative min-w-0 flex-1">
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {gridBeats.map((beat) => {
            const x = PLOT_X0 + (beat / total) * (PLOT_X1 - PLOT_X0)
            return (
              <line
                key={beat} x1={x} x2={x} y1={PLOT_TOP} y2={PLOT_BASE}
                stroke="rgba(255,255,255,0.05)" strokeWidth={1} vectorEffect="non-scaling-stroke"
              />
            )
          })}
          {/* the "normal size" line: where the object rests between hits */}
          <line
            x1={PLOT_X0} x2={PLOT_X1} y1={PLOT_BASE} y2={PLOT_BASE}
            stroke="rgba(255,255,255,0.10)" strokeWidth={1} vectorEffect="non-scaling-stroke"
          />
          <path d={fillPath} fill={withAlpha(STRIKE, 0.1)} stroke="none" />
          {/* Light lives along the path: three stacked strokes of the same
              geometry - wide/dim, medium, thin white-hot - per the guide. */}
          <path d={path} fill="none" stroke={STRIKE} strokeWidth={6} strokeOpacity={0.16} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={STRIKE} strokeWidth={2.5} strokeOpacity={0.45} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={towardWhite(STRIKE, 0.7)} strokeWidth={1.25} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div
          ref={dotRef}
          aria-hidden="true"
          className="pointer-events-none absolute h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${PLOT_X0}%`, top: `${PLOT_BASE}%`, background: '#ffe3ec', boxShadow: `0 0 6px 1px ${withAlpha(STRIKE, 0.85)}` }}
        />
        <span className="pointer-events-none absolute right-2 top-1.5 text-[8px] font-bold tracking-[0.16em] text-white/25">
          SIZE
        </span>
      </div>
    </div>
  )
}

// ── The curve picker ─────────────────────────────────────────────────────────
// Each option IS its shape, drawn with the mover's own pulseFalloff, so the
// choice is made by looking rather than by reading three option names.

const FALLOFF_OPTIONS = [
  { value: PULSE_SNAP, label: 'Snap' },
  { value: PULSE_EVEN, label: 'Even' },
  { value: PULSE_TAIL, label: 'Tail' },
]

function falloffPath(falloff: number): string {
  let path = ''
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const x = 6 + t * 88
    const y = 84 - pulseFalloff(1 - t, falloff) * 68
    path += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }
  return path
}

function FalloffSegmented({ bound }: { bound: UserInterfaceParameter }) {
  const current = numericValue(bound, PULSE_SNAP)
  const active = FALLOFF_OPTIONS.find((option) => option.value === current) ?? FALLOFF_OPTIONS[0]
  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Decay curve"
        data-testid="impact-pulse-falloff-segmented"
        className="flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
      >
        {FALLOFF_OPTIONS.map((option) => {
          const selected = option.value === current
          return (
            <button
              key={option.value}
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              title={option.label}
              onClick={() => bound.setValue(option.value)}
              className={`h-7 min-w-0 flex-1 cursor-pointer rounded-[5px] px-[3px] transition-colors ${
                selected ? '' : 'hover:bg-white/[0.04]'
              }`}
              style={selected ? { background: withAlpha(STRIKE, 0.2) } : undefined}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="h-full w-full">
                <path
                  d={falloffPath(option.value)}
                  fill="none"
                  stroke={selected ? towardWhite(STRIKE, 0.6) : 'rgba(255,255,255,0.35)'}
                  strokeWidth={selected ? 1.75 : 1.25}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </button>
          )
        })}
      </div>
      <p className="mt-1 text-center text-[9px] font-semibold tracking-[0.1em] text-white/40">
        {active.label.toUpperCase()}
      </p>
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

function PulseKnob({ parameter: bound, label, large, format, suffix }: {
  parameter: UserInterfaceParameter
  label: string
  large?: boolean
  format?: (value: number) => string
  suffix?: string
}) {
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <LaserKnob
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      defaultValue={definition.default}
      curve={definition.curve ?? 1}
      label={label}
      ariaLabel={definition.label}
      accent={STRIKE}
      large={large}
      format={format}
      suffix={suffix}
      onChange={bound.setValue}
    />
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const PLACED_KEYS = new Set(['hit', 'decayBeats', 'stretch', 'rollBeats', 'falloff'])

const asPercent = (value: number) => `${Math.round(value * 100)}%`

export const ImpactPulseMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [showMore, setShowMore] = useState(false)

  const hit = parameter(parameters, 'hit')
  const decay = parameter(parameters, 'decayBeats')
  const stretch = parameter(parameters, 'stretch')
  const roll = parameter(parameters, 'rollBeats')
  const falloff = parameter(parameters, 'falloff')

  // The guide's fallback rule: a missing key means the whole plain list, never
  // a half-empty custom layout.
  if (!hit || !decay || !stretch || !roll || !falloff) {
    return <ParameterList parameters={parameters} />
  }

  const settings: ImpactPulseSettings = {
    hit: clamp(numericValue(hit, 0.28), 0, 1),
    decayBeats: Math.max(0.02, numericValue(decay, 0.25)),
    stretch: clamp(numericValue(stretch), 0, 1),
    rollBeats: numericValue(roll),
    falloff: numericValue(falloff, PULSE_SNAP),
  }

  const unplaced = parameters.filter((bound) => !PLACED_KEYS.has(bound.definition.key))

  return (
    <section data-testid="impact-pulse-user-interface" className="-mx-3 -mt-3" style={{ background: SHADE }}>
      <PulseWindow settings={settings} />
      <div
        className="flex flex-col gap-2.5 pb-4 pt-3"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(STRIKE, 0.12)}, transparent)` }}
      >
        <div className="px-4">
          <FalloffSegmented bound={falloff} />
        </div>
        <div className="flex items-end gap-5 px-4">
          <PulseKnob parameter={hit} label="HIT" large format={asPercent} />
          <PulseKnob parameter={decay} label="DECAY" suffix="b" />
          <PulseKnob parameter={stretch} label="STRETCH" format={asPercent} />
          <PulseKnob parameter={roll} label="ROLL" suffix="b" />
        </div>
        {unplaced.length > 0 && (
          <div className="px-3">
            <button
              aria-expanded={showMore}
              onClick={() => setShowMore((value) => !value)}
              className="flex items-center gap-1 text-[8px] font-bold tracking-[0.18em] text-white/30 transition-colors hover:text-white/60"
            >
              {showMore ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              MORE
            </button>
            {showMore && (
              <div className="mt-1.5 rounded-md border border-white/[0.06] bg-black/25 p-2">
                <ParameterList parameters={unplaced} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
