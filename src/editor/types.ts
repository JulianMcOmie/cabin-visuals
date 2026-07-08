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

export type MidiMode = 'none' | 'continuous' | 'amount' | 'ballistic'

export type SubsetWeightSpec =
  | { mode: 'all' }
  | { mode: 'odd' }
  | { mode: 'even' }
  | { mode: 'firstHalf' }
  | { mode: 'secondHalf' }
  | { mode: 'checkerWhite' }
  | { mode: 'checkerBlack' }
  | { mode: 'gradient'; slope: number; phase: number }

/**
 * A positioned, trimmed reference to an audio clip — the audio analogue of a MIDI
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
  /** Edge fades in seconds — reserved for a later phase. */
  fadeIn?: number
  fadeOut?: number
}

export type InterpolationMode = 'step' | 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'exponential' | 'smooth-step'

/**
 * A modulator's routing: which port it drives, over what scope, scaled by how much.
 * `scope` is what lets one modulator hit a single track, a whole tag group, or
 * (phase 5) a subtree. `port` is the target objects' port key; `amount` scales the
 * modulator's output before it's combined at the port.
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
  blocks: Block[]
  parentId?: string
  childIds: string[]
  /** Cross-cutting labels for group modulation — a modulator can target a tag. */
  tags?: string[]
  /** Modulator-only: the ports this modulator drives (one modulator → many ports). */
  targets?: Routing[]
  targetParam?: string
  interpolation?: InterpolationMode
  /** For an `ability` child track: which of the parent instrument's abilities it drives
   *  (matches an `AbilityLaneDef.key`). Its blocks/notes are the ability's trigger stream. */
  abilityKey?: string
  /** For a `mover` track: which mover def this row applies. */
  moverId?: string
  /** Mover wet/dry. Muting a mover bypasses it; it never blackouts the parent. */
  depth?: number
  /** Mover input base values, keyed by the def's input names. */
  inputValues?: Record<string, number>
  envelope?: { attack: number; decay: number }
  midiMode?: MidiMode
  midiTargetInput?: string
  weight?: SubsetWeightSpec
  opMode?: 'transform' | 'add'
  /** Visual effects applied to this object's rendered output (transform/clone/shader). */
  effects?: EffectInstance[]
  /** Audio-track-only: the positioned clips this lane plays (type === 'audio'). */
  audioBlocks?: AudioBlock[]
}
