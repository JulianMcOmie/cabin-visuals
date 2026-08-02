'use client'

// Bespoke settings for the unified Mover (definition id 'mover'), built to
// docs/instrument-panel-design-guide.md.
//
// The panel's whole shape mirrors the definition's: two segmented controls
// carry its two decisions - WHAT moves (translate / rotate / orbit) and WHAT
// THE NOTES DO (burst / constant / oscillate) - and everything below them is
// just the numbers for the chosen cell, so no mode ever shows another mode's
// knobs.
//
// The window is a FIELD of objects, not a lone subject, because the three
// motions are indistinguishable on a single centered object (rotate and orbit
// only differ when there is somewhere else to stand). Nine seeds run through
// the definition's real resolve() - the same closure the engine calls - on a
// looping demo phrase in the mover's own vocabulary, so the picture cannot
// drift from playback. Rendered with plain DOM matrix3d transforms off one
// rAF, NOT an r3f canvas: per this directory's CLAUDE.md a panel canvas stays
// black until the transport plays, and choosing a motion is exactly the thing
// you do while parked.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Matrix4 } from 'three'
import { BURST_EASINGS } from '../core/visualCopies/burstEasings'
import { MOVER_COLOR } from '../core/visualCopies/identityColors'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import {
  MOVER_MODE_BURST,
  MOVER_MODE_CONSTANT,
  MOVER_MODE_OSCILLATE,
  MOVER_MOTION_ORBIT,
  MOVER_MOTION_TRANSLATE,
  moverDefinition,
  type MoverSettings,
} from '../core/visualCopies/mover'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { MoverOrSplitter } from '../core/visualCopies/types'
import type { ResolvedNote } from '../core/visual/types'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

// The accent comes FROM THE DEFINITION (identityColor), so this console, the
// mover's timeline blocks, its piano-roll notes and the tab rail are one
// colour by construction - never re-declare the hex here.
const AMBER = MOVER_COLOR
const AMBER_HSV = hexToHsv(AMBER)
/** Hue-true dark shade per the guide - never an alpha tint over panel gray. */
const SHADE = hsvToHex(AMBER_HSV.h, Math.min(AMBER_HSV.s, 0.5), 0.075)
const ROOM = '#05070c'

// ── The demo phrase ──────────────────────────────────────────────────────────
// One 8-beat loop per mode, written in the mover's own 60-65 vocabulary and
// chosen to end where it starts so the wrap is invisible:
//   burst      - four hits stepping +X, +Y then back -X, -Y (step-family
//                easings cancel; return-family ones come home on their own).
//   constant   - translate: four 2-beat holds walking out and home again;
//                rotate/orbit: NO notes, because an empty lane spinning is
//                that cell's actual claim (the baseline) - a preview that
//                needed notes to move would be hiding it.
//   oscillate  - two 4-beat holds, +X then +Y (whole cycles land at zero).

const LOOP_BEATS = 8
const BEATS_PER_SECOND = 1.8

const demoNote = (beat: number, pitch: number, durationBeats: number): ResolvedNote => ({
  beat,
  blockStartBeat: 0,
  blockEndBeat: 1024,
  pitch,
  velocity: 1,
  durationBeats,
})

function demoNotes(motion: number, mode: number): ResolvedNote[] {
  if (mode === MOVER_MODE_CONSTANT) {
    if (motion !== MOVER_MOTION_TRANSLATE) return []
    return [demoNote(0, 60, 2), demoNote(2, 61, 2), demoNote(4, 62, 2), demoNote(6, 63, 2)]
  }
  if (mode === MOVER_MODE_OSCILLATE) {
    return [demoNote(0, 60, 4), demoNote(4, 62, 4)]
  }
  return [demoNote(0, 60, 0.25), demoNote(2, 62, 0.25), demoNote(4, 61, 0.25), demoNote(6, 63, 0.25)]
}

// ── The field window ─────────────────────────────────────────────────────────

/** 3x3 seed positions in world units, camera-facing. */
const FIELD_SEEDS: [number, number, number][] = []
for (let row = -1; row <= 1; row++) {
  for (let column = -1; column <= 1; column++) FIELD_SEEDS.push([column * 1.5, row * 1.5, 0])
}

const PX_PER_UNIT = 24

const _flip = new Matrix4().makeScale(1, -1, 1)
const _css = new Matrix4()

/**
 * A three.js world matrix as a CSS matrix3d. Both are column-major, so only
 * two conversions are needed: conjugating by a Y flip (three's +Y is up, CSS's
 * is down - conjugation flips the axis while keeping rotations rigid), and
 * scaling the translation into pixels (rotation columns stay unit).
 */
function toCssMatrix(world: Matrix4): string {
  _css.copy(_flip).multiply(world).multiply(_flip)
  const e = _css.elements
  return `matrix3d(${e[0]},${e[1]},${e[2]},${e[3]},${e[4]},${e[5]},${e[6]},${e[7]},${e[8]},${e[9]},${e[10]},${e[11]},${e[12] * PX_PER_UNIT},${e[13] * PX_PER_UNIT},${e[14] * PX_PER_UNIT},${e[15]})`
}

function FieldWindow({ settings }: { settings: MoverSettings }) {
  const objectRefs = useRef<(HTMLDivElement | null)[]>([])
  const progressRef = useRef<HTMLDivElement>(null)

  const motion = settings.motion
  const orbit = motion === MOVER_MOTION_ORBIT

  // The definition's real closure over the demo phrase. Rebuilt on every
  // settings render; the rAF reads it through a ref so the loop never
  // re-subscribes (ImpactPulse's pattern).
  const chain: MoverOrSplitter = moverDefinition.resolve({
    settings,
    notes: demoNotes(settings.motion, settings.mode),
  })
  const liveRef = useRef(chain)
  liveRef.current = chain

  // Beat-0 poses written at RENDER time, so the field is laid out correctly
  // before the first rAF tick (and in environments where rAF is starved).
  const initialPoses = FIELD_SEEDS.map(([x, y, z]) => {
    const seed = identityVisualCopy()
    seed.transform.makeTranslation(x, y, z)
    const copy = chain.apply(seed, { beat: 0, index: 0, count: 1 })[0]
    return { transform: toCssMatrix(copy.transform), opacity: copy.opacity }
  })

  useEffect(() => {
    let raf = 0
    const seedMatrix = new Matrix4()
    const tick = () => {
      const beat = ((performance.now() / 1000) * BEATS_PER_SECOND) % LOOP_BEATS
      for (let i = 0; i < FIELD_SEEDS.length; i++) {
        const element = objectRefs.current[i]
        if (!element) continue
        const seed = identityVisualCopy()
        const [x, y, z] = FIELD_SEEDS[i]
        seed.transform.copy(seedMatrix.makeTranslation(x, y, z))
        const copy = liveRef.current.apply(seed, { beat, index: 0, count: 1 })[0]
        element.style.transform = toCssMatrix(copy.transform)
        element.style.opacity = String(copy.opacity)
      }
      const progress = progressRef.current
      if (progress) progress.style.left = `${(beat / LOOP_BEATS) * 100}%`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      data-testid="mover-window"
      className="relative h-[128px] overflow-hidden border-b border-white/[0.06]"
      style={{ background: ROOM, perspective: '800px' }}
    >
      {/* A pool of light so the room is lit by the instrument. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-[150px] w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: `radial-gradient(ellipse, ${withAlpha(AMBER, 0.1)}, transparent 70%)` }}
      />
      {/* Orbit's fixed point - the one landmark that motion needs. */}
      {orbit && (
        <div
          aria-hidden="true"
          className="absolute h-[5px] w-[5px] rounded-full border"
          style={{
            left: `calc(50% + ${(settings.pivotX ?? 0) * PX_PER_UNIT}px)`,
            top: `calc(50% - ${(settings.pivotY ?? 0) * PX_PER_UNIT}px)`,
            transform: 'translate(-50%, -50%)',
            borderColor: withAlpha(AMBER, 0.7),
            boxShadow: `0 0 6px 1px ${withAlpha(AMBER, 0.4)}`,
          }}
        />
      )}
      <div aria-hidden="true" className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
        {FIELD_SEEDS.map((seed, i) => {
          const center = seed[0] === 0 && seed[1] === 0
          return (
            <div
              key={i}
              ref={(node) => { objectRefs.current[i] = node }}
              className="absolute left-1/2 top-1/2 rounded-[3px] border"
              style={{
                width: center ? 14 : 11,
                height: center ? 14 : 11,
                marginLeft: center ? -7 : -5.5,
                marginTop: center ? -7 : -5.5,
                transform: initialPoses[i].transform,
                opacity: initialPoses[i].opacity,
                background: withAlpha(AMBER, center ? 0.3 : 0.16),
                borderColor: withAlpha(AMBER, center ? 0.75 : 0.45),
                boxShadow: center ? `0 0 10px 0 ${withAlpha(AMBER, 0.4)}` : `0 0 6px 0 ${withAlpha(AMBER, 0.18)}`,
              }}
            />
          )
        })}
      </div>
      {/* Which cell is playing, in the window's own corner. */}
      <span className="pointer-events-none absolute right-2 top-1.5 text-[8px] font-bold tracking-[0.16em] text-white/25">
        {['TRANSLATE', 'ROTATE', 'ORBIT'][motion] ?? 'TRANSLATE'} · {['BURST', 'CONSTANT', 'OSCILLATE'][settings.mode] ?? 'BURST'}
      </span>
      {/* The demo loop's playhead, riding the bottom hairline. */}
      <div
        ref={progressRef}
        aria-hidden="true"
        className="absolute bottom-0 h-[2px] w-[10px] -translate-x-1/2 rounded-full"
        style={{ background: withAlpha(AMBER, 0.55) }}
      />
    </div>
  )
}

// ── Segmented controls ───────────────────────────────────────────────────────

function Segmented({ bound, labels, name }: {
  bound: UserInterfaceParameter
  labels: readonly string[]
  name: string
}) {
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : 0
  return (
    <div
      role="radiogroup"
      aria-label={name}
      data-testid={`mover-${name.toLowerCase().replace(/\s+/g, '-')}`}
      className="flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
    >
      {labels.map((label, value) => {
        const active = value === selected
        return (
          <button
            key={label}
            role="radio"
            aria-checked={active}
            onClick={() => bound.setValue(value)}
            className={`h-6 min-w-0 flex-1 cursor-pointer truncate rounded-[5px] px-1 text-[9px] font-semibold tracking-[0.1em] transition-colors ${
              active ? '' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
            }`}
            style={active ? { background: withAlpha(AMBER, 0.22), color: towardWhite(AMBER, 0.6) } : undefined}
          >
            {label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

// ── Easing strip (burst mode) ────────────────────────────────────────────────
// Each option IS its shape, drawn from the mover's own easing table, so the
// step family (lands and stays) and the return family (round trip) are told
// apart by looking. Ten chips, five per row: step curves on top, returns below.

function EasingGlyph({ easingIndex }: { easingIndex: number }) {
  const { ease } = BURST_EASINGS[easingIndex] ?? BURST_EASINGS[0]
  const samples = 28
  let vMin = 0
  let vMax = 1
  const values: number[] = []
  for (let i = 0; i <= samples; i++) {
    const v = ease(i / samples)
    values.push(v)
    vMin = Math.min(vMin, v)
    vMax = Math.max(vMax, v)
  }
  const span = Math.max(0.0001, vMax - vMin)
  const points = values
    .map((v, i) => `${((i / samples) * 22 + 1).toFixed(1)},${(13 - ((v - vMin) / span) * 12).toFixed(1)}`)
    .join(' ')
  return (
    <svg aria-hidden="true" viewBox="0 0 24 14" className="h-3.5 w-6">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function EasingStrip({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : definition.default
  return (
    <div className="grid grid-cols-5 gap-1">
      {definition.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            data-testid={`mover-easing-${option.label.toLowerCase()}`}
            aria-label={`${option.label} easing`}
            aria-pressed={active}
            onClick={() => bound.setValue(option.value)}
            className={`flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-md border py-1 transition-colors ${
              active ? '' : 'border-white/[0.07] bg-white/[0.025] text-white/30 hover:bg-white/[0.06] hover:text-white/65'
            }`}
            style={active ? { borderColor: withAlpha(AMBER, 0.4), background: withAlpha(AMBER, 0.15), color: towardWhite(AMBER, 0.45) } : undefined}
          >
            <EasingGlyph easingIndex={option.value} />
            <span className="max-w-full truncate text-[6px] font-semibold tracking-[0.06em]">{option.label.toUpperCase()}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

function MoverKnob({ parameter: bound, label, large, bipolar, format, suffix }: {
  parameter: UserInterfaceParameter | undefined
  label: string
  large?: boolean
  /** For the signed pivot axes, whose zero is the middle of their travel. */
  bipolar?: boolean
  format?: (value: number) => string
  suffix?: string
}) {
  if (!bound) return null
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
      accent={AMBER}
      large={large}
      bipolar={bipolar}
      format={format}
      suffix={suffix}
      onChange={bound.setValue}
    />
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const PLACED_KEYS = new Set([
  'motion', 'mode',
  'distanceX', 'distanceY', 'distanceZ', 'distance',
  'angleX', 'angleY', 'angleZ', 'angle',
  'burstBeats', 'easing', 'sharpness',
  'cyclesPerBeat', 'returnBeats',
  'pivotX', 'pivotY', 'pivotZ',
])

/** The per-axis row's unit, said once above the row instead of on each knob. */
function amountHint(motion: number, mode: number): string {
  const unit = motion === MOVER_MOTION_TRANSLATE ? 'UNITS' : 'DEGREES'
  if (mode === MOVER_MODE_CONSTANT) return `${unit} / BEAT · HELD NOTES${motion === MOVER_MOTION_TRANSLATE ? '' : ' + ALWAYS ON'}`
  if (mode === MOVER_MODE_OSCILLATE) return `${unit} OF SWING · HELD NOTES`
  return `${unit} / HIT`
}

export const MoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [showMore, setShowMore] = useState(false)

  const motion = parameter(parameters, 'motion')
  const mode = parameter(parameters, 'mode')
  const easing = parameter(parameters, 'easing')
  const bound = (key: string) => parameter(parameters, key)

  // The guide's fallback rule: a missing key means the whole plain list, never
  // a half-empty custom layout.
  if (!motion || !mode || !easing || !bound('distanceX') || !bound('angleX') || !bound('burstBeats') || !bound('returnBeats') || !bound('pivotX')) {
    return <ParameterList parameters={parameters} />
  }

  const motionValue = Math.round(numericValue(motion, MOVER_MOTION_TRANSLATE))
  const modeValue = Math.round(numericValue(mode, MOVER_MODE_BURST))
  const translate = motionValue === MOVER_MOTION_TRANSLATE
  const orbit = motionValue === MOVER_MOTION_ORBIT

  // The window runs the definition itself, so its settings come through the
  // same merge the engine uses - panel values overlaid on schema defaults.
  const settings = {
    ...(mergeDefinitionSettings(moverDefinition, undefined) as unknown as MoverSettings),
    ...Object.fromEntries(parameters
      .filter((p) => typeof p.value === 'number')
      .map((p) => [p.definition.key, p.value as number])),
  } as MoverSettings

  const unplaced = parameters.filter((p) => !PLACED_KEYS.has(p.definition.key))
  const axisKey = translate ? 'distance' : 'angle'
  const degrees = (value: number) => `${Math.round(value)}`

  return (
    <section data-testid="mover-user-interface" className="-mx-3 -mt-3" style={{ background: SHADE }}>
      <FieldWindow settings={settings} />
      <div
        className="flex flex-col gap-2.5 pb-4 pt-3"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(AMBER, 0.12)}, transparent)` }}
      >
        <div className="flex flex-col gap-1.5 px-4">
          <Segmented bound={motion} labels={['Translate', 'Rotate', 'Orbit']} name="Motion" />
          <Segmented bound={mode} labels={['Burst', 'Constant', 'Oscillate']} name="MIDI mode" />
        </div>

        {modeValue === MOVER_MODE_BURST && (
          <div className="px-4">
            <EasingStrip bound={easing} />
          </div>
        )}

        <div className="px-4">
          <p className="mb-1 text-right text-[7px] font-bold tracking-[0.16em] text-white/25">
            {amountHint(motionValue, modeValue)}
          </p>
          <div className="flex items-end gap-5">
            <MoverKnob parameter={bound(`${axisKey}X`)} label="X" format={translate ? undefined : degrees} />
            <MoverKnob parameter={bound(`${axisKey}Y`)} label="Y" format={translate ? undefined : degrees} />
            <MoverKnob parameter={bound(`${axisKey}Z`)} label="Z" format={translate ? undefined : degrees} />
            <MoverKnob parameter={bound(axisKey)} label="AMOUNT" large format={(v) => `${Math.round(v * 100)}%`} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 px-4">
          {modeValue === MOVER_MODE_BURST && (
            <>
              <MoverKnob parameter={bound('burstBeats')} label="TIME" suffix="b" />
              <MoverKnob parameter={bound('sharpness')} label="SHARP" />
            </>
          )}
          {modeValue === MOVER_MODE_OSCILLATE && (
            <MoverKnob parameter={bound('cyclesPerBeat')} label="CYCLES" suffix="/b" />
          )}
          {modeValue !== MOVER_MODE_BURST && (
            <MoverKnob parameter={bound('returnBeats')} label="RETURN" suffix="b" />
          )}
          {orbit && (
            <>
              <MoverKnob parameter={bound('pivotX')} label="PIV X" bipolar />
              <MoverKnob parameter={bound('pivotY')} label="PIV Y" bipolar />
              <MoverKnob parameter={bound('pivotZ')} label="PIV Z" bipolar />
            </>
          )}
        </div>

        {unplaced.length > 0 && (
          <div className="px-3">
            <button
              aria-expanded={showMore}
              onClick={() => setShowMore((value) => !value)}
              className="flex items-center gap-1 text-[8px] font-bold tracking-[0.18em] text-white/30 transition-colors hover:text-white/60"
            >
              {showMore ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              BASIS
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
