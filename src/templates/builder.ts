import { DEFAULT_SCENE_BACKGROUND, type AdsrEnvelope, type Block, type EffectInstance, type InterpolationMode, type Note, type Track, type TrackType, type Routing, type VideoPad } from '../editor/types'
import type { VideoClip } from '../editor/store/VideoStore'
import type { ViewAspect } from '../editor/store/ProjectStore'
import type { ProjectDocument } from '../persistence/types'
import { OBJECT_TRACK_COLOR } from '../editor/utils/trackColors'

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
  /** For type 'mover'/'splitter': the MoverOrSplitterDefinition id + params. */
  moverId?: string
  splitterId?: string
  inputValues?: Record<string, number>
  /** For type 'automation': the parent param (or fx:<id>:<key>) it drives. */
  targetParam?: string
  interpolation?: InterpolationMode
  /** For type 'envelope': the gate lane's ADSR shape, depth, and target value
   *  (targetParam addresses the param / fx setting / 'opacity'). */
  adsr?: AdsrEnvelope
  envDepth?: number
  envTarget?: number
  /** Automation noise mode: notes become gates around their pitch-value. */
  noise?: Track['noise']
  /** Visual effect plugins on this track (build with the fx() helper). */
  effects?: EffectInstance[]
  /** For the Video instrument: the ordered pad bank. Template pads reference
   *  PUBLIC APP ASSETS (refs starting with '/'), shipped in /public - the
   *  matching source descriptors go in doc()'s videoClips. */
  videoPads?: VideoPad[]
  children?: TrackSpec[]
}

/** An effect instance with a readable unique id - keep the returned value if
 *  an automation child needs to address it via fxTarget(). */
export function fx(pluginId: string, settings: Record<string, number>, enabled = true): EffectInstance {
  return { id: nid('fx'), pluginId, enabled, settings }
}

/** The automation targetParam addressing one fx() instance's setting (same
 *  namespacing as src/editor/effects/automation.ts). */
export function fxTarget(instance: EffectInstance, key: string): string {
  return `fx:${instance.id}:${key}`
}

/** A track with editor-default fields filled in; children become child tracks. */
export function track(spec: TrackSpec): Track & { __children?: Track[] } {
  const t: Track & { __children?: Track[] } = {
    id: nid('t'),
    name: spec.name,
    type: spec.type ?? 'base',
    instrumentId: spec.instrumentId,
    color: spec.color ?? OBJECT_TRACK_COLOR,
    muted: false,
    solo: false,
    blocks: spec.blocks ?? [],
    childIds: [],
  }
  if (spec.params) t.params = spec.params
  if (spec.stringParams) t.stringParams = spec.stringParams
  if (spec.targets) t.targets = spec.targets
  if (spec.abilityKey) t.abilityKey = spec.abilityKey
  if (spec.moverId) t.moverId = spec.moverId
  if (spec.splitterId) t.splitterId = spec.splitterId
  if (spec.inputValues) t.inputValues = spec.inputValues
  if (spec.targetParam) t.targetParam = spec.targetParam
  if (spec.interpolation) t.interpolation = spec.interpolation
  if (spec.adsr) t.adsr = spec.adsr
  if (spec.envDepth !== undefined) t.envDepth = spec.envDepth
  if (spec.envTarget !== undefined) t.envTarget = spec.envTarget
  if (spec.noise) t.noise = spec.noise
  if (spec.effects) t.effects = spec.effects
  if (spec.videoPads) t.videoPads = spec.videoPads
  if (spec.children) t.__children = spec.children.map((c) => track(c))
  return t
}

/** Assemble a full v2 document from root tracks (wiring parent/child ids). */
export function doc(opts: {
  bpm: number
  totalBars?: number
  beatsPerBar?: number
  tracks: Array<Track & { __children?: Track[] }>
  /** Source catalog for any videoPads above (public-asset refs). */
  videoClips?: Record<string, VideoClip>
  /** Template-shipped audio tracks (public-asset refs, e.g. a voiceover and a
   *  music bed). Land via hydrate on project creation; applyTemplate
   *  deliberately keeps the project's own audio instead. `trimEnd` defaults to
   *  the source duration - pass it to end the block before the file does. */
  audio?: Array<{ name: string; ref: string; fileName: string; duration: number; trimEnd?: number }>
  /** Canvas aspect the template is authored for (e.g. '9:16' for short-form).
   *  Applied when a project is CREATED from the template (hydrate honors the
   *  document field); applyTemplate deliberately never reshapes an existing
   *  project's canvas. */
  viewAspect?: ViewAspect
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
    schemaVersion: 8,
    bpm: opts.bpm,
    beatsPerBar: opts.beatsPerBar ?? 4,
    totalBars: opts.totalBars ?? 16,
    scenes: {
      [mainId]: { id: mainId, name: 'Main', isMain: true, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
      [sceneId]: { id: sceneId, name: 'Scene 1', isMain: false, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks, rootTrackIds },
    },
    sceneOrder: [mainId, sceneId],
    ...(opts.audio?.length
      ? (() => {
          const audioTracks: ProjectDocument['audioTracks'] = {}
          const audioRootTrackIds: string[] = []
          const audioClips: ProjectDocument['audioClips'] = {}
          for (const a of opts.audio) {
            const audioId = nid('aud')
            audioTracks[audioId] = {
              id: audioId,
              name: a.name,
              type: 'audio' as const,
              instrumentId: '',
              color: '#ef4444',
              muted: false,
              solo: false,
              blocks: [],
              childIds: [],
              audioBlocks: [{ id: nid('ab'), clipRef: a.ref, startBar: 0, trimStart: 0, trimEnd: a.trimEnd ?? a.duration }],
            }
            audioRootTrackIds.push(audioId)
            audioClips[a.ref] = { ref: a.ref, fileName: a.fileName, duration: a.duration }
          }
          return { audioTracks, audioRootTrackIds, audioClips }
        })()
      : { audioTracks: {}, audioRootTrackIds: [], audioClips: {} }),
    ...(opts.videoClips ? { videoClips: opts.videoClips } : {}),
    ...(opts.viewAspect ? { viewAspect: opts.viewAspect } : {}),
  }
}
