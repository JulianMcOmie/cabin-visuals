import { Color } from 'three'
import type { ResolvedNote } from '../../core/visual/types'
import { makeNoteQueries } from './notes'
import { hash } from './motion'
import { world } from './world'
import type { MusicCtx, ParamSpecs } from './types'

const NO_NOTES: readonly ResolvedNote[] = []

// Builds the music half of every code context (instrument frame, post pass,
// composition) from plain inputs, so all three read the same names the same way.
// React-free and three-light (Color only).

/** Numeric defaults, colour and text defaults, derived once per spec. */
export interface SpecDefaults {
  params: Record<string, number>
  colors: Record<string, string>
  text: Record<string, string>
}

export function specDefaults(specs: ParamSpecs | undefined): SpecDefaults {
  const out: SpecDefaults = { params: {}, colors: {}, text: {} }
  for (const [key, s] of Object.entries(specs ?? {})) {
    if (s.kind === 'num') out.params[key] = s.default
    else if (s.kind === 'bool') out.params[key] = s.default ? 1 : 0
    else if (s.kind === 'select') out.params[key] = s.default
    else if (s.kind === 'color') out.colors[key] = s.default
    else out.text[key] = s.default
  }
  return out
}

/** Reused Color objects per consumer, so a frame allocates no colours. */
export class ColorCache {
  private readonly map: Record<string, Color> = {}
  resolve(defaults: Record<string, string>, stored: Record<string, string> | undefined): Record<string, Color> {
    for (const key in defaults) {
      const hex = stored?.[key] ?? defaults[key]
      let c = this.map[key]
      if (!c) c = this.map[key] = new Color()
      try { c.set(hex) } catch { c.set(defaults[key]) }
    }
    return this.map
  }
}

export interface MusicInputs {
  beat: number
  secPerBeat: number
  beatsPerBar: number
  params: Record<string, number> | undefined
  stringParams: Record<string, string> | undefined
  notes: readonly ResolvedNote[]
  active?: readonly ResolvedNote[]
}

export function makeMusicCtx(input: MusicInputs, defaults: SpecDefaults, colors: ColorCache): MusicCtx {
  const { beat, secPerBeat, beatsPerBar } = input
  const params: Record<string, number> = { ...defaults.params }
  if (input.params) for (const k in input.params) params[k] = input.params[k]
  const text: Record<string, string> = { ...defaults.text }
  if (input.stringParams) for (const k in defaults.text) if (input.stringParams[k] !== undefined) text[k] = input.stringParams[k]
  const q = makeNoteQueries(input.notes, beat, secPerBeat)
  const active = input.active ?? input.notes.filter((n) => beat >= n.beat && beat < n.beat + n.durationBeats)
  let lanes: Map<string, ReturnType<MusicCtx['lane']>> | undefined
  return {
    ...q,
    beat,
    bar: beat / beatsPerBar,
    beatInBar: ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar,
    beatsPerBar,
    secPerBeat,
    bpm: 60 / secPerBeat,
    sec: beat * secPerBeat,
    params,
    colors: colors.resolve(defaults.colors, input.stringParams),
    text,
    notes: input.notes,
    active,
    rand: (...seed: number[]) => hash(...seed),
    lane: (name: string) => {
      lanes ??= new Map()
      let l = lanes.get(name)
      if (!l) {
        const notes = world().laneNotes(name) ?? NO_NOTES
        l = { ...makeNoteQueries(notes, beat, secPerBeat), notes }
        lanes.set(name, l)
      }
      return l
    },
  }
}
