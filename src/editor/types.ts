export interface Note {
  id: string
  startBeat: number
  durationBeats: number
  pitch: number
  velocity: number
}

export interface Block {
  id: string
  startBar: number
  durationBars: number
  loop: boolean
  /** Optional source-loop length; when absent, looped blocks infer it from note contents. */
  loopLengthBars?: number
  notes: Note[]
}

export type TrackType =
  | 'base'
  | 'add'
  | 'mute'
  | 'suppress'
  | 'override'
  | 'automation'
  | 'ability'
  | 'mover'
  | 'audio'
  | 'envelope'
  | 'splitter'
  | 'director'

export type SceneId = string

/** A self-contained editable visual world. Main is represented by the same shape,
 * but accepts director tracks instead of object instruments. */
export interface Scene {
  id: SceneId
  name: string
  isMain: boolean
  tracks: Record<string, Track>
  rootTrackIds: string[]
}

/**
 * ADSR parameters for an `envelope` child track, all in BEATS (tempo-musical and
 * deterministic - the gain is a closed-form function of the playhead beat, per the
 * pause invariant). sustainLevel is a 0..1 level, not a time.
 */
export interface AdsrEnvelope {
  attackBeats: number
  decayBeats: number
  sustainLevel: number
  releaseBeats: number
}

/**
 * A positioned, trimmed reference to an audio clip - the audio analogue of a MIDI
 * Block. The clip (bytes + descriptor) is the material; this is the placement.
 * The beat window it occupies is DERIVED at schedule time from startBar + trim +
 * tempo, never stored: audio is fixed seconds, so its width in beats follows the
 * project bpm (audio is never resampled).
 */
export interface AudioBlock {
  id: string
  /** → AudioClip.ref (AudioStore's audioClips catalog; bytes via core/audio). */
  clipRef: string
  /** Timeline position (mirrors Block.startBar). */
  startBar: number
  /** Seconds into the clip where playback begins (default 0). */
  trimStart: number
  /** Seconds into the clip where playback ends (default = clip duration). */
  trimEnd: number
  /** Per-block volume (linear, 1 = unity). */
  gain?: number
  /** Edge fades in seconds - reserved for a later phase. */
  fadeIn?: number
  fadeOut?: number
}

export type InterpolationMode = 'step' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'exponential' | 'smooth-step'

/**
 * A targeting route for a top-level mover: `scope` picks a single track, a whole
 * tag group, or a subtree of objects the mover applies to. (`port`/`amount` are
 * legacy fields from the retired modulator system - still present in saved
 * documents, ignored by the engine.)
 */
export interface Routing {
  port: string
  scope:
    | { kind: 'track'; id: string }
    | { kind: 'tag'; tag: string }
    | { kind: 'subtree'; id: string }
  amount: number
}

/** A visual effect plugin attached to a track: which plugin, on/off, param values. */
export interface EffectInstance {
  id: string
  pluginId: string
  enabled: boolean
  settings: Record<string, number>
}

export interface Track {
  id: string
  name: string
  type: TrackType
  instrumentId: string
  /** User-set instrument parameter values (keys defined by the instrument schema). */
  params?: Record<string, number>
  /** String-valued instrument params (color / string types), kept apart from the numeric
   *  `params` so the engine's numeric paths stay untouched. */
  stringParams?: Record<string, string>
  color: string
  muted: boolean
  solo: boolean
  /** Draw this object on top of everything else (depth-ignored overlay).
   *  Unset = the instrument's own default (e.g. Text Display defaults on). */
  onTop?: boolean
  blocks: Block[]
  parentId?: string
  childIds: string[]
  /** Cross-cutting labels - a top-level mover can target a tag group. */
  tags?: string[]
  /** Top-level movers only: the objects this mover applies to. */
  targets?: Routing[]
  targetParam?: string
  interpolation?: InterpolationMode
  /** For an `ability` child track: which of the parent instrument's abilities it drives
   *  (matches an `AbilityLaneDef.key`). Its blocks/notes are the ability's trigger stream. */
  abilityKey?: string
  /** For an `envelope` child track: its ADSR shape (beats / 0..1 sustain). The track's
   *  notes are the gates; `targetParam` addresses the modulated parent param (same
   *  addressing as automation, plus the reserved 'opacity' key). */
  adsr?: AdsrEnvelope
  /** Envelope wet/dry (0..1): scales the gain before it modulates the target. */
  envDepth?: number
  /** Envelope target value: the param value reached at full gain (base + (envTarget -
   *  base) * gain). Unused for the reserved 'opacity' target, which multiplies. */
  envTarget?: number
  /** For a `mover` track: which MoverOrSplitterDefinition this row applies. */
  moverId?: string
  /** For a `splitter` track: which MoverOrSplitterDefinition this row applies. */
  splitterId?: string
  /** Main-scene-only: the director plugin this track instantiates. */
  directorId?: string
  /** Director MIDI rows bind stable pitches to scene identities. */
  sceneBindings?: Array<{ pitch: number; sceneId: SceneId }>
  /** Mover/splitter param values, keyed by the definition's param keys. */
  inputValues?: Record<string, number>
  /** Visual effects applied to this object's rendered output (transform/clone/shader). */
  effects?: EffectInstance[]
  /** Audio-track-only: the positioned clips this lane plays (type === 'audio'). */
  audioBlocks?: AudioBlock[]
  /** Video-instrument-only: the ordered pads of its bank. Order is the MIDI
   *  mapping - index 0 answers baseNote. Bytes live behind core/video. */
  videoPads?: VideoPad[]
  /** Photo-instrument-only: the ordered photos of its bank. Order is the MIDI
   *  mapping - index 0 answers baseNote. Bytes live behind core/photo. */
  photoPads?: PhotoPad[]
}

/**
 * One photo in a Photo track's bank: a reference to an uploaded still image. A
 * note hit cuts to it full-frame; it latches until the next note-on. No
 * in-point - a still image has no timeline, so placement is just the ref.
 */
export interface PhotoPad {
  /** Source photo ref (PhotoStore catalog / core/photo bytes). */
  ref: string
}

/**
 * One pad in a Video track's bank: a moment chosen from an uploaded source. A
 * note hit plays the source from `inPoint` (the decode engine keeps that
 * moment's frames permanently warm, so triggers land next display tick).
 * Non-destructive - many pads can share one uploaded source.
 */
export interface VideoPad {
  /** Source video ref (VideoStore catalog / core/video bytes). */
  ref: string
  /** Seconds into the source where this pad's clip begins. */
  inPoint: number
}
