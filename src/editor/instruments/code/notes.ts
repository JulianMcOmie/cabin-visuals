// MIDI queries for code instruments: every question an instrument asks of its
// note stream ("what hit recently", "what is held", "what is coming", "how many
// so far") as a PURE function of (notes, beat). Nothing accumulates across
// frames, so a paused frame, a scrub and an export all agree.
//
// Type-only imports: this module is shared by the R3F runtime, the composition
// runtime and node tests.

import type { ResolvedNote } from '../../core/visual/types'

/** Which notes a query looks at: one pitch, several, a predicate, or all (omit). */
export type PitchQuery = number | readonly number[] | ((pitch: number) => boolean) | undefined

/** A note that has started (onset <= now). */
export interface Hit {
  note: ResolvedNote
  pitch: number
  /** 0..1 (MIDI velocity / 127). */
  velocity: number
  /** Absolute onset beat. */
  beat: number
  /** Beats since the onset (>= 0). */
  age: number
  /** Seconds since the onset. */
  ageSec: number
  /** Note length in beats. */
  dur: number
  /** Absolute beat the note ends. */
  end: number
  /** Still sounding? */
  held: boolean
  /** This note's position among ALL matching onsets so far (0-based) - a stable
   *  per-hit identity for seeding ("the 7th snare"), never a frame counter. */
  index: number
}

/** A note that has not started yet. */
export interface Upcoming {
  note: ResolvedNote
  pitch: number
  velocity: number
  beat: number
  /** Beats until the onset (> 0). */
  in: number
  dur: number
  /** Its index among matching onsets (continues the Hit numbering). */
  index: number
}

interface Sorted {
  notes: ResolvedNote[]
  beats: Float64Array
}

// Notes arrays are stable per resolve (instrumentFrame's signature relies on
// that), so a sort per identity is a sort per structural edit, not per frame.
const sortedCache = new WeakMap<readonly ResolvedNote[], Sorted>()

function sorted(notes: readonly ResolvedNote[]): Sorted {
  let s = sortedCache.get(notes)
  if (!s) {
    const arr = notes.slice().sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
    s = { notes: arr, beats: Float64Array.from(arr, (n) => n.beat) }
    sortedCache.set(notes, s)
  }
  return s
}

/** Index of the last note with beat <= t, or -1. */
function lastAtOrBefore(beats: Float64Array, t: number): number {
  let lo = 0, hi = beats.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (beats[m] <= t) lo = m + 1
    else hi = m
  }
  return lo - 1
}

export function matchPitch(q: PitchQuery, pitch: number): boolean {
  if (q === undefined) return true
  if (typeof q === 'number') return pitch === q
  if (typeof q === 'function') return q(pitch)
  return q.includes(pitch)
}

export interface NoteQueries {
  /** Onsets at or before now, newest first, within `withinBeats` (default: all). */
  hits(q?: PitchQuery, withinBeats?: number, max?: number): Hit[]
  /** The most recent onset (or null). */
  last(q?: PitchQuery): Hit | null
  /** The most recent onset that is still sounding (or null). */
  held(q?: PitchQuery): Hit | null
  /** Every sounding note, newest first. */
  holding(q?: PitchQuery): Hit[]
  /** The next onset after now (or null). */
  next(q?: PitchQuery): Upcoming | null
  /** Onsets after now within `withinBeats`, soonest first. */
  upcoming(q?: PitchQuery, withinBeats?: number, max?: number): Upcoming[]
  /** How many matching onsets have happened (optionally only since `fromBeat`). */
  count(q?: PitchQuery, fromBeat?: number): number
  /** Σ velocity·e^(−age/decay) over recent onsets: "how hard is it hitting". */
  pulse(q?: PitchQuery, decayBeats?: number): number
  /** An envelope that follows note on/off: rises over `attack` beats from each
   *  onset, holds while held, falls over `release` beats after the note ends.
   *  The max over overlapping notes, times velocity. */
  gate(q?: PitchQuery, attackBeats?: number, releaseBeats?: number): number
  /** Every matching note in [fromBeat, toBeat), in time order (score reads). */
  between(q: PitchQuery, fromBeat: number, toBeat: number): ResolvedNote[]
}

export function makeNoteQueries(notes: readonly ResolvedNote[], beat: number, secPerBeat: number): NoteQueries {
  const s = sorted(notes)
  const arr = s.notes
  const nowIdx = lastAtOrBefore(s.beats, beat)

  // index among matching onsets for notes[i] - counts matches in [0, i)
  const matchIndex = (q: PitchQuery, i: number) => {
    let c = 0
    for (let k = 0; k < i; k++) if (matchPitch(q, arr[k].pitch)) c++
    return c
  }

  const toHit = (n: ResolvedNote, index: number): Hit => {
    const age = beat - n.beat
    return {
      note: n, pitch: n.pitch, velocity: n.velocity / 127, beat: n.beat, age, ageSec: age * secPerBeat,
      dur: n.durationBeats, end: n.beat + n.durationBeats, held: beat < n.beat + n.durationBeats, index,
    }
  }

  const hits: NoteQueries['hits'] = (q, withinBeats = Infinity, max = Infinity) => {
    const out: Hit[] = []
    // walk back from now; indices assigned after we know how many matched before
    const picked: number[] = []
    for (let i = nowIdx; i >= 0 && picked.length < max; i--) {
      if (beat - arr[i].beat > withinBeats) break
      if (matchPitch(q, arr[i].pitch)) picked.push(i)
    }
    if (picked.length === 0) return out
    let idx = matchIndex(q, picked[picked.length - 1])
    // picked is newest-first; assign ascending indices oldest-first
    const indices = new Array<number>(picked.length)
    for (let k = picked.length - 1; k >= 0; k--) indices[k] = idx++
    for (let k = 0; k < picked.length; k++) out.push(toHit(arr[picked[k]], indices[k]))
    return out
  }

  const count: NoteQueries['count'] = (q, fromBeat = -Infinity) => {
    let c = 0
    for (let i = nowIdx; i >= 0; i--) {
      if (arr[i].beat < fromBeat) break
      if (matchPitch(q, arr[i].pitch)) c++
    }
    return c
  }

  return {
    hits,
    last: (q) => hits(q, Infinity, 1)[0] ?? null,
    held: (q) => {
      for (let i = nowIdx; i >= 0; i--) {
        const n = arr[i]
        if (matchPitch(q, n.pitch) && beat < n.beat + n.durationBeats) return toHit(n, matchIndex(q, i))
        // notes longer than 64 beats are rare; stop scanning far back
        if (beat - n.beat > 64) break
      }
      return null
    },
    holding: (q) => {
      const out: Hit[] = []
      for (let i = nowIdx; i >= 0; i--) {
        const n = arr[i]
        if (beat - n.beat > 64) break
        if (matchPitch(q, n.pitch) && beat < n.beat + n.durationBeats) out.push(toHit(n, -1))
      }
      return out
    },
    next: (q) => {
      for (let i = nowIdx + 1; i < arr.length; i++) {
        const n = arr[i]
        if (n.beat <= beat) continue
        if (matchPitch(q, n.pitch)) {
          return { note: n, pitch: n.pitch, velocity: n.velocity / 127, beat: n.beat, in: n.beat - beat, dur: n.durationBeats, index: matchIndex(q, i) }
        }
      }
      return null
    },
    upcoming: (q, withinBeats = Infinity, max = Infinity) => {
      const out: Upcoming[] = []
      let idx = -1
      for (let i = nowIdx + 1; i < arr.length && out.length < max; i++) {
        const n = arr[i]
        if (n.beat <= beat) continue
        if (n.beat - beat > withinBeats) break
        if (!matchPitch(q, n.pitch)) continue
        if (idx < 0) idx = matchIndex(q, i)
        out.push({ note: n, pitch: n.pitch, velocity: n.velocity / 127, beat: n.beat, in: n.beat - beat, dur: n.durationBeats, index: idx++ })
      }
      return out
    },
    count,
    pulse: (q, decayBeats = 0.5) => {
      let sum = 0
      for (let i = nowIdx; i >= 0; i--) {
        const age = beat - arr[i].beat
        if (age > decayBeats * 8) break
        if (matchPitch(q, arr[i].pitch)) sum += (arr[i].velocity / 127) * Math.exp(-age / decayBeats)
      }
      return sum
    },
    gate: (q, attackBeats = 0.02, releaseBeats = 0.25) => {
      let g = 0
      for (let i = nowIdx; i >= 0; i--) {
        const n = arr[i]
        const age = beat - n.beat
        if (age > 64) break
        if (!matchPitch(q, n.pitch)) continue
        const end = n.beat + n.durationBeats
        const rise = attackBeats > 0 ? Math.min(1, age / attackBeats) : 1
        const v = beat < end ? rise : Math.min(1, n.durationBeats / Math.max(1e-9, attackBeats)) * Math.exp(-(beat - end) / Math.max(1e-9, releaseBeats))
        g = Math.max(g, v * (n.velocity / 127))
      }
      return g
    },
    between: (q, fromBeat, toBeat) => {
      const out: ResolvedNote[] = []
      const start = Math.max(0, lastAtOrBefore(s.beats, fromBeat - 1e-9) + 1)
      for (let i = start; i < arr.length && arr[i].beat < toBeat; i++) if (matchPitch(q, arr[i].pitch)) out.push(arr[i])
      return out
    },
  }
}
