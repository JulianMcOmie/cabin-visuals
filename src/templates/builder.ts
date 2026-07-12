import type { Block, Note, Track, TrackType, Routing } from '../editor/types'
import type { ProjectDocument } from '../persistence/types'

// Authoring helpers for template documents. Templates are plain v2 project
// documents built at module load; ids only need to be unique within one
// document (rows are independent JSONB), so a readable counter beats UUIDs.
// NOTE: templates write every pattern in full across the block's whole length
// and keep loop: false - they never lean on the resolver's loop expansion.

let seq = 0
const nid = (hint: string) => `tpl-${hint}${(seq++).toString(36)}`

/** One note. Beats are relative to the containing block's start. */
export function n(startBeat: number, pitch: number, durationBeats = 0.5, velocity = 100): Note {
  return { id: nid('n'), startBeat, durationBeats, pitch, velocity }
}

/** A pitch repeating every `every` beats across `total` beats (drum-style). */
export function pulse(
  pitch: number,
  every: number,
  total: number,
  opts: { dur?: number; vel?: number; offset?: number } = {},
): Note[] {
  const out: Note[] = []
  for (let b = opts.offset ?? 0; b < total; b += every) out.push(n(b, pitch, opts.dur ?? 0.25, opts.vel ?? 100))
  return out
}

/** Cycle through `pitches` on a fixed grid - the classic arpeggio. */
export function arp(
  pitches: number[],
  step: number,
  total: number,
  opts: { dur?: number; vel?: number } = {},
): Note[] {
  const out: Note[] = []
  let i = 0
  for (let b = 0; b < total; b += step, i++) {
    out.push(n(b, pitches[i % pitches.length], opts.dur ?? step * 0.9, opts.vel ?? 96))
  }
  return out
}

/** Explicit rhythm rows: [startBeat, pitch, durationBeats?, velocity?]. */
export function hits(rows: Array<[number, number, number?, number?]>): Note[] {
  return rows.map(([b, p, d, v]) => n(b, p, d ?? 0.5, v ?? 100))
}

/** Repeat a hand-written bar-pattern every `period` beats across `total` beats. */
export function every(period: number, total: number, pattern: Note[]): Note[] {
  const out: Note[] = []
  for (let base = 0; base < total; base += period) {
    for (const note of pattern) {
      if (base + note.startBeat < total) {
        out.push({ ...note, id: nid('n'), startBeat: base + note.startBeat })
      }
    }
  }
  return out
}

export function block(startBar: number, durationBars: number, notes: Note[]): Block {
  return { id: nid('b'), startBar, durationBars, loop: false, notes }
}

export interface TrackSpec {
  name: string
  instrumentId: string
  blocks?: Block[]
  color?: string
  params?: Record<string, number>
  stringParams?: Record<string, string>
  type?: TrackType
  targets?: Routing[]
  /** For type 'ability': which parent-instrument ability lane this drives. */
  abilityKey?: string
  children?: TrackSpec[]
}

/** A track with editor-default fields filled in; children become child tracks. */
export function track(spec: TrackSpec): Track & { __children?: Track[] } {
  const t: Track & { __children?: Track[] } = {
    id: nid('t'),
    name: spec.name,
    type: spec.type ?? 'base',
    instrumentId: spec.instrumentId,
    color: spec.color ?? '#6366f1',
    muted: false,
    solo: false,
    blocks: spec.blocks ?? [],
    childIds: [],
  }
  if (spec.params) t.params = spec.params
  if (spec.stringParams) t.stringParams = spec.stringParams
  if (spec.targets) t.targets = spec.targets
  if (spec.abilityKey) t.abilityKey = spec.abilityKey
  if (spec.children) t.__children = spec.children.map((c) => track(c))
  return t
}

/** Assemble a full v2 document from root tracks (wiring parent/child ids). */
export function doc(opts: {
  bpm: number
  totalBars?: number
  beatsPerBar?: number
  tracks: Array<Track & { __children?: Track[] }>
}): ProjectDocument {
  const tracks: Record<string, Track> = {}
  const rootTrackIds: string[] = []

  const add = (t: Track & { __children?: Track[] }, parentId?: string) => {
    const { __children, ...clean } = t
    if (parentId) clean.parentId = parentId
    tracks[clean.id] = clean
    for (const child of __children ?? []) {
      clean.childIds.push(child.id)
      add(child, clean.id)
    }
  }
  for (const t of opts.tracks) {
    add(t)
    rootTrackIds.push(t.id)
  }

  const mainId = nid('main')
  const sceneId = nid('scene')
  return {
    schemaVersion: 5,
    bpm: opts.bpm,
    beatsPerBar: opts.beatsPerBar ?? 4,
    totalBars: opts.totalBars ?? 16,
    scenes: {
      [mainId]: { id: mainId, name: 'Main', isMain: true, tracks: {}, rootTrackIds: [] },
      [sceneId]: { id: sceneId, name: 'Scene 1', isMain: false, tracks, rootTrackIds },
    },
    sceneOrder: [mainId, sceneId],
    audioTracks: {},
    audioRootTrackIds: [],
    audioClips: {},
  }
}
