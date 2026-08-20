'use client'

// Bespoke settings for Strobe, built from the console kit (./console):
// full-bleed, no card chrome, washed with the accent's dark shade. A live
// preview that actually flashes, the rate vocabulary, then STYLE / DEPTH /
// WIDTH.
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

import { useRef, useState, type ReactElement } from 'react'
import {
  STROBE_RATE_ROWS,
  STROBE_REFERENCE_FPS,
  STROBE_STYLE_BLACKOUT,
  STROBE_STYLE_FLASH,
  STROBE_STYLE_INVERT,
  strobeCycleBeats,
  strobeGate,
  type StrobeRateRow,
} from '../instruments/Strobe'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  Segmented,
  usePreviewLoop,
  type SelectBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** Strobe exposes no color param, so its accent is the white of the flash its
 *  identity color and library icon already use - one identity across the app,
 *  and a black/white panel for an instrument whose whole vocabulary (invert,
 *  blackout, flash) is black and white. */
const ACCENT = '#ffffff'

// ── Live preview ────────────────────────────────────────────────────────────

/** The tempo the preview imagines (120bpm), matching Bass Ripple's preview so the
 *  two panels tick alike. Musical rows are scaled by it; frame rows ignore it,
 *  which is the whole distinction the preview needs to show. */
const PREVIEW_SEC_PER_BEAT = 0.5

/** How long one on/off cycle of `row` lasts in the preview, in seconds.
 *  `strobeCycleBeats` already folds frame rows onto the beat axis, so one
 *  conversion covers both kinds. */
function previewSecondsPerCycle(row: StrobeRateRow): number {
  return strobeCycleBeats(row, PREVIEW_SEC_PER_BEAT) * PREVIEW_SEC_PER_BEAT
}

/** A scrap of stage for the flash to act on. A greyscale value ramp, keeping
 *  the panel on the instrument's black/white theme - inversion stays legible
 *  because VALUE visibly flips: the near-white circle goes near-black, the two
 *  mid greys trade places, and the near-black ground goes white.
 *
 *  The viewBox is deliberately WIDE (the panel is a letterbox roughly 5:1) and
 *  every shape stays inside the middle band: `slice` scales to cover, so a
 *  square-ish viewBox would blow up and crop the stage out of frame, and shapes
 *  near the top or bottom edge would be the first thing lost at other widths. */
function PreviewStage() {
  return (
    <svg viewBox="0 0 520 120" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <rect width="520" height="120" fill="#05070c" />
      <circle cx="150" cy="56" r="27" fill="#e8e8e8" />
      <path d="M260 27 L289 79 L231 79 Z" fill="#b3b3b3" />
      <rect x="330" y="34" width="52" height="46" rx="5" fill="#404040" />
      <rect x="150" y="94" width="232" height="7" rx="3.5" fill={ACCENT} />
      <path d="M0 110 H520" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
    </svg>
  )
}

function StrobePreview({ style, depth, width, secondsPerCycle }: {
  style: number
  depth: number
  width: number
  secondsPerCycle: number
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const veilRef = useRef<HTMLDivElement>(null)
  // The loop reads the LATEST values without restarting: re-arming the animation
  // on every knob turn would reset the phase and make the flash stutter while
  // being adjusted, which is exactly when it needs to be steady.
  const live = useRef({ style, depth, width, secondsPerCycle })
  live.current = { style, depth, width, secondsPerCycle }

  // Styles are written imperatively, never through state: at the fastest rate
  // this fires ~32 times a second, and re-rendering the panel that often to
  // flash a div would be absurd. The stage mutates; React owns the layout.
  const hostRef = usePreviewLoop((tSec) => {
    // Seconds, not beats: strobeGate is unit-agnostic, and seconds is the axis
    // both row kinds already agree on here.
    const current = live.current
    const lit = strobeGate(tSec, current.secondsPerCycle, current.width) * current.depth
    const stage = stageRef.current
    const veil = veilRef.current
    if (stage && veil) {
      const inverting = current.style === STROBE_STYLE_INVERT
      stage.style.filter = inverting && lit > 0 ? `invert(${lit})` : 'none'
      veil.style.background = current.style === STROBE_STYLE_FLASH ? '#ffffff' : '#000000'
      veil.style.opacity = inverting ? '0' : String(lit)
    }
  })

  return (
    <PreviewWindow height={76} testId="strobe-preview">
      <div ref={(el) => { stageRef.current = el; hostRef.current = el }} className="absolute inset-0">
        <PreviewStage />
      </div>
      <div ref={veilRef} className="pointer-events-none absolute inset-0 opacity-0" />
    </PreviewWindow>
  )
}

// ── The rate legend ─────────────────────────────────────────────────────────

/** One chip per row: the division it plays, with its pitch beneath. */
function RateChip({ row, active, onSelect }: {
  row: StrobeRateRow
  active: boolean
  onSelect: (pitch: number) => void
}) {
  const [division] = row.label.split(' · ')
  return (
    <button
      type="button"
      aria-pressed={active}
      title={`${row.label} · pitch ${row.pitch}`}
      onClick={() => onSelect(row.pitch)}
      // Single line, division and pitch side by side: three stacked families of
      // two-line chips overran the panel and pushed the knobs out of view.
      className={`flex min-w-0 flex-1 items-baseline justify-center gap-1 overflow-hidden rounded-sm border px-1 py-[2px] transition-colors ${
        active
          ? 'border-transparent bg-white text-black'
          : 'border-white/10 bg-black/25 text-white/55 hover:bg-white/[0.06]'
      }`}
    >
      <span className="font-mono text-[9px] leading-tight tabular-nums">{division}</span>
      <span className={`font-mono text-[7px] leading-tight tabular-nums ${active ? 'text-black/50' : 'text-white/25'}`}>
        {row.pitch}
      </span>
    </button>
  )
}

/** The three families, in row order. Splitting by which axis a row is on is not
 *  decoration: musical rows stretch with the tempo and frame rows do not, which
 *  is the one thing a user has to know before picking between them. */
const RATE_GROUPS: Array<{ label: string; rows: StrobeRateRow[] }> = [
  { label: 'STRAIGHT', rows: STROBE_RATE_ROWS.filter((row) => row.beatsPerCycle !== undefined && !row.triplet) },
  { label: 'TRIPLET', rows: STROBE_RATE_ROWS.filter((row) => row.triplet === true) },
  { label: 'FRAMES', rows: STROBE_RATE_ROWS.filter((row) => row.framesPerCycle !== undefined) },
]

/** The rows the piano roll will show, with the pitch that plays each one. Picking
 *  a chip only aims the preview - rate is played, not set, so this writes nothing
 *  to the track. `1/16` is pre-selected: it is the row the instrument emphasizes
 *  and the "rapid fire" the strobe is for.
 *
 *  One labelled line per family. Twelve chips do not fit on a single line at the
 *  panel's narrow end, and a labelled row also answers "why are there two kinds
 *  of number here" without a paragraph. This pushes the panel a little past the
 *  design guide's ~240px budget; the vocabulary tripled, so the legend earned
 *  the height, and the preview gave some back. */
function RateLegend({ selected, onSelect }: {
  selected: number
  onSelect: (pitch: number) => void
}) {
  return (
    <div className="px-3 pt-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">RATE</span>
        <span className="text-[8px] text-white/25">played as a MIDI row</span>
      </div>
      <div className="flex flex-col gap-1">
        {RATE_GROUPS.map((group) => (
          <div key={group.label} className="flex items-stretch gap-1">
            <span className="w-[46px] flex-none self-center text-[7px] font-semibold leading-tight tracking-[0.1em] text-white/30">
              {group.label}
            </span>
            {group.rows.map((row) => (
              <RateChip key={row.pitch} row={row} active={row.pitch === selected} onSelect={onSelect} />
            ))}
            {/* Keep every family's chips the same width as the widest family's,
                so the three lines read as one table instead of three sizes. */}
            {Array.from({ length: 5 - group.rows.length }, (_, i) => (
              <span key={`pad-${i}`} className="min-w-0 flex-1" aria-hidden="true" />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-0.5 text-[7px] leading-snug text-white/25">
        T = triplet. f rows flash on a {STROBE_REFERENCE_FPS}fps grid at a fixed Hz, ignoring tempo.
      </p>
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

/** The kit's segmented control wearing the style glyphs, in a knob-shaped
 *  column: caption and readout beneath so it sits on the knobs' baseline. */
function StyleSelector({ b }: { b: SelectBinding | null }) {
  if (!b) return null
  const selected = Math.round(b.value)
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <Segmented
        b={b}
        options={b.def.options.map((option) => ({
          value: option.value,
          label: `${option.label} on every flash`,
          glyph: (
            <svg width="16" height="16" viewBox="0 0 16 16">
              {STYLE_GLYPHS[option.value] ?? STYLE_GLYPHS[STROBE_STYLE_INVERT]}
            </svg>
          ),
        }))}
        name="Style"
      />
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">STYLE</span>
      <span className="font-mono text-[9px] text-white/70">
        {b.def.options.find((option) => option.value === selected)?.label.toUpperCase() ?? ''}
      </span>
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

/** Which row the preview flashes at, defaulting to the one the instrument
 *  emphasizes. Tracked by PITCH (a row's stable identity) rather than by cycle
 *  length, which is no longer unique across the two axes. View state only - it
 *  never reaches the track. */
const DEFAULT_PREVIEW_PITCH = (STROBE_RATE_ROWS.find((row) => row.emphasized) ?? STROBE_RATE_ROWS[0]).pitch

/** Both knobs are 0..1 fractions of something - how far the frame flips, how
 *  much of the cycle is lit - and percent is how you talk about that. */
const asPercent = (value: number) => `${Math.round(value * 100)}%`

export const StrobeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const style = b.select('style')
  const depth = b.num('depth')
  const width = b.num('width')
  const [previewPitch, setPreviewPitch] = useState(DEFAULT_PREVIEW_PITCH)
  const previewRow = STROBE_RATE_ROWS.find((row) => row.pitch === previewPitch) ?? STROBE_RATE_ROWS[0]

  if (!style || !depth || !width) return <ParameterList parameters={parameters} />

  return (
    <Console accent={ACCENT} testId="strobe-user-interface">
      <StrobePreview
        style={Math.round(style.value)}
        depth={depth.value}
        width={width.value}
        secondsPerCycle={previewSecondsPerCycle(previewRow)}
      />
      <RateLegend selected={previewPitch} onSelect={setPreviewPitch} />
      <ControlRow spill className="justify-center gap-5 px-4 pb-2 pt-1.5">
        <StyleSelector b={style} />
        <Knob b={depth} label="DEPTH" large format={asPercent} />
        <Knob b={width} label="WIDTH" format={asPercent} />
      </ControlRow>
      <More parameters={b.rest()} />
    </Console>
  )
}
