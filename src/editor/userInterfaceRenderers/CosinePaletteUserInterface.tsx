'use client'

// Bespoke settings for the Cosine Palette colorizer, on the console kit. The
// hero is the PERIOD ITSELF: a full-bleed strip drawn from the definition's
// own cosinePaletteLut(), rotated by SCROLL, so the picture is byte-for-byte
// what the stage samples (the Gradient panel's contract, one door down).
//
// Layout settled in the 2026-08-13 mock round: the working knobs run on top
// (SCROLL / AMOUNT / SPAN), the three phase knobs sit right under them wearing
// their own channel colors - the R knob IS red, so "stagger the channels" is
// visible in the hardware rather than explained - then the two labelled
// segments (PALETTE presets, MAP), then the palette-shape row and the kick
// pair. OFFSET and the perceptual/linear MIX fold into MORE unlisted.
//
// The accent is the definition's identity olive, imported - never re-declared -
// so the console matches the notes written in it (identityColors.ts is the
// single source). A `{ param }` identity is impossible here: the subject is
// every hue at once.

import { useMemo } from 'react'
import {
  cosinePaletteLut,
  type CosinePaletteSettings,
} from '../core/visualCopies/cosinePalette'
import { COSINE_PALETTE_COLOR } from '../core/visualCopies/identityColors'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  Segmented,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** The channel knobs wear their channels. Voiced for the dark console rather
 *  than primaries: pure #f00/#00f arcs read as alarm and vanish respectively. */
const CHANNEL_ACCENTS = { r: '#ff5d5d', g: '#4ade80', b: '#5b9dff' } as const

/** Short segment faces for the six mapping modes - the def's own labels
 *  ("Spherical", "Copy index") overflow a six-way split at panel widths. */
const MAP_SEGMENTS = [
  { value: 0, label: 'X' },
  { value: 1, label: 'Y' },
  { value: 2, label: 'Radial' },
  { value: 3, label: 'Sphere' },
  { value: 4, label: 'Depth' },
  { value: 5, label: 'Index' },
]

/** A quiet caps caption over a segmented control, in the knob-label voice. */
function SegmentCaption({ children }: { children: string }) {
  return <div className="mb-1 text-[9px] font-semibold tracking-[0.1em] text-white/40">{children}</div>
}

/** Enough stops that the strip is visually continuous at panel widths; the
 *  stage's own 256-entry LUT would just be a longer CSS string. */
const STRIP_STOPS = 48

export const CosinePaletteUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bindPanel(parameters)
  const palette = pool.select('palette')
  const scroll = pool.num('scroll')
  const phaseR = pool.num('phaseR')
  const phaseG = pool.num('phaseG')
  const phaseB = pool.num('phaseB')
  const bright = pool.num('bright')
  const range = pool.num('range')
  const cycles = pool.num('cycles')
  const mode = pool.select('mode')
  const span = pool.num('span')
  const amount = pool.num('amount')
  const kick = pool.num('kick')
  const kickDecay = pool.num('kickDecay')

  // Hooks before the fallback return, unconditionally. Only the values the
  // formula reads reach cosinePaletteLut, so the memo re-fires on exactly the
  // edits that repaint the strip; SCROLL rotates the finished period instead.
  const strip = useMemo(() => {
    const settings = {
      palette: palette?.value ?? 0,
      phaseR: phaseR?.value ?? 0,
      phaseG: phaseG?.value ?? 0,
      phaseB: phaseB?.value ?? 0,
      bright: bright?.value ?? 0.5,
      range: range?.value ?? 0.5,
    } as CosinePaletteSettings
    const lut = cosinePaletteLut(settings, STRIP_STOPS)
    const turn = ((scroll?.value ?? 0) % 1 + 1) % 1
    const shift = Math.round(turn * STRIP_STOPS)
    const stops = Array.from({ length: STRIP_STOPS + 1 }, (_, i) => {
      const hex = lut[(i + shift) % STRIP_STOPS]
      return `${hex} ${(i / STRIP_STOPS) * 100}%`
    })
    return `linear-gradient(90deg, ${stops.join(', ')})`
  }, [palette?.value, phaseR?.value, phaseG?.value, phaseB?.value, bright?.value, range?.value, scroll?.value])

  if (pool.missing) return <ParameterList parameters={parameters} />

  return (
    <Console accent={COSINE_PALETTE_COLOR} testId="cosine-palette-user-interface">
      {/* One period, full-bleed - the window slot. SCROLL visibly slides it,
          so the headline automation target has a picture before it has notes. */}
      <div
        data-testid="cosine-palette-strip"
        className="h-9 border-b border-white/10"
        style={{ background: strip }}
      />

      <div className="flex flex-col gap-2.5 px-3 pb-3 pt-2.5">
        <ControlRow className="justify-between gap-1 px-1">
          <Knob b={scroll} label="SCROLL" ariaLabel="Palette scroll phase" large format={(v) => v.toFixed(2)} />
          <Knob b={amount} label="AMOUNT" ariaLabel="Palette amount" format={(v) => `${Math.round(v * 100)}%`} />
          <Knob b={span} label="SPAN" ariaLabel="World units per palette period" />
        </ControlRow>

        {/* The creative core: per-channel phase, each knob lit in its own
            channel. Signed offsets around the preset, so bipolar arcs. */}
        <ControlRow className="justify-between gap-1 px-1">
          <Knob b={phaseR} label="R" ariaLabel="Red phase offset" accent={CHANNEL_ACCENTS.r} bipolar format={(v) => v.toFixed(2)} />
          <Knob b={phaseG} label="G" ariaLabel="Green phase offset" accent={CHANNEL_ACCENTS.g} bipolar format={(v) => v.toFixed(2)} />
          <Knob b={phaseB} label="B" ariaLabel="Blue phase offset" accent={CHANNEL_ACCENTS.b} bipolar format={(v) => v.toFixed(2)} />
        </ControlRow>

        <div>
          <SegmentCaption>PALETTE</SegmentCaption>
          <Segmented b={palette} name="Palette preset" />
        </div>
        <div>
          <SegmentCaption>MAP</SegmentCaption>
          <Segmented b={mode} options={MAP_SEGMENTS} name="Mapping mode" />
        </div>

        <ControlRow className="justify-between gap-1 px-1">
          <Knob b={bright} label="BRIGHT" ariaLabel="Palette brightness (a)" format={(v) => v.toFixed(2)} />
          <Knob b={range} label="RANGE" ariaLabel="Palette range (b)" format={(v) => v.toFixed(2)} />
          <Knob b={cycles} label="CYCLES" ariaLabel="Palette cycles (c)" format={(v) => `${v.toFixed(1)}×`} />
        </ControlRow>

        <ControlRow className="gap-1 px-1">
          <Knob b={kick} label="KICK" ariaLabel="Kick phase shove" format={(v) => v.toFixed(2)} />
          <Knob b={kickDecay} label="DECAY" ariaLabel="Kick decay in beats" suffix="b" format={(v) => v.toFixed(2)} />
        </ControlRow>

        <More parameters={pool.rest()} label="MORE" className="" />
      </div>
    </Console>
  )
}
