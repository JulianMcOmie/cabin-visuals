/** The transcribed Lyrics track's word timing in SECONDS - the source of
 *  truth for that one track. Its note beats are DERIVED from this (through
 *  the audio block's trim + the current BPM) and re-derived whenever the BPM
 *  changes, so a tempo correction never moves words off their sung time. */
export interface LyricTimingWord {
  word: string
  start: number
  end: number
}

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
  | 'automation'
  | 'ability'
  | 'mover'
  | 'audio'
  | 'envelope'
  | 'splitter'
  // A folder over member tracks (⌘⇧G). Carries the canonical tf* transform
  // (inherited by the subtree via world-matrix composition), automation lanes
  // on those params, an effect chain broadcast to member objects, and
  // mover/splitter children that append to each member's chain - a chain child
  // applies to the members ABOVE it in the group's child order (children read
  // as a top-to-bottom pipeline), composed per member in the member's own
  // frame. Purely additive in persistence: Track's shape is unchanged.
  | 'group'
  // A rack of alternative DEVICES with one MIDI lane over them: each child gets
  // a row, and the lane says which of them are running at this beat. It splices
  // its children into the chain it sits in, contiguously and in child order, so
  // with every row held it is bit-identical to those devices being plain chain
  // siblings - which is the property the whole design rests on. `params.mode`
  // picks how notes choose the subset (core/visualCopies/switcher.ts);
  // `switcherBindings` binds a stable pitch to each child. Purely additive in
  // persistence, like 'group'.
  | 'switcher'
// 'director' was retired in schema v12: a scene composer is now an ordinary
// 'base' track whose instrumentId names a composition instrument
// (core/directors). upgrade.ts rewrites old saves.
// 'wordFormation' was retired in schema v15: lyric clips carry a LAYOUT that
// replaces formation lanes (upgrade.ts converts and drops the child tracks).

/** How a lyric clip arranges its words on screen. An open vocabulary - new
 *  kinds append here and get a card in the clip editor; the engine treats an
 *  unknown kind as 'one' so an older build never crashes on a newer save. */
export type LyricLayoutKind = 'one' | 'row' | 'stack' | 'scatter' | 'grid' | 'circle'

export interface LyricClipLayout {
  kind: LyricLayoutKind
  /** Grid only: columns. Absent = 2. */
  cols?: number
}

/**
 * A lyric clip: a span of the timeline that OWNS its words. A Text Display
 * note takes the next unclaimed word from the clip its beat falls inside -
 * word binding is local to a phrase, so pasting/moving notes can never shift
 * lyrics outside their own clip. Words keep Text Display's inline powers
 * (`!a phrase!` grouping, `|syl|la|bles|`). Beats are ABSOLUTE project beats
 * (clips are track fields, not block contents).
 */
export interface LyricClip {
  id: string
  startBeat: number
  durationBeats: number
  words: string[]
  layout: LyricClipLayout
}

/** Per-lane word effects (applied to every word played on the lane). */
export type StyleLaneFx = 'shake' | 'rainbow' | 'outline'

/**
 * One style lane of a Text Display track: a named look that a piano-roll ROW
 * wears. A note's pitch picks the lane, so note height styles the word.
 * `font` indexes Text Display's FONT_STACKS; `size` multiplies the track's
 * Font Size; `color` is the word color (track-level Rainbow/Hue still win).
 */
export interface StyleLane {
  name: string
  font: number
  color: string
  size: number
  fx?: StyleLaneFx[]
}

export type SceneId = string
export const DEFAULT_SCENE_BACKGROUND = '#000000'

export type SceneGradientKind = 'linear' | 'mirror' | 'radial'

/** Two-stop backdrop gradient. `from` sits at the start of the CSS-style
 * gradient line (the bottom at angle 0), at BOTH edges for mirror, and at the
 * center for radial. `angle` is CSS convention - degrees clockwise from
 * "to top" - and is ignored by radial. The whole object is kept around while
 * `enabled` is false so switching backdrop modes never loses the setup. */
export interface SceneGradient {
  enabled: boolean
  kind: SceneGradientKind
  from: string
  to: string
  angle: number
}

export function defaultSceneGradient(): SceneGradient {
  return { enabled: false, kind: 'linear', from: '#1b2c55', to: '#000000', angle: 0 }
}

export type SceneBackdropMode = 'color' | 'gradient' | 'transparent'

/** Which backdrop the scene actually wears - transparency wins, then an
 * enabled gradient, else the flat color. The two underlying fields never
 * fight because ProjectStore.setSceneBackdropMode writes them together. */
export function sceneBackdropMode(scene: Pick<Scene, 'backgroundTransparent' | 'backgroundGradient'>): SceneBackdropMode {
  if (scene.backgroundTransparent) return 'transparent'
  if (scene.backgroundGradient?.enabled) return 'gradient'
  return 'color'
}

/** A self-contained editable visual world. Main is represented by the same shape,
 * but accepts director tracks instead of object instruments. */
export interface Scene {
  id: SceneId
  name: string
  isMain: boolean
  backgroundColor: string
  backgroundTransparent: boolean
  /** Absent on older documents - readers treat that as a disabled gradient. */
  backgroundGradient?: SceneGradient
  tracks: Record<string, Track>
  rootTrackIds: string[]
  /** The template THIS scene wears (multi-scene projects can differ per
   *  scene). Absent on older documents - readers fall back to the
   *  project-level appliedTemplateId. */
  appliedTemplateId?: string | null
  /** Scene-level effect chain. Document + inspector UI only for now: the
   *  visual engine does not yet apply these to the scene's rendered output. */
  effects?: EffectInstance[]
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

/** What an automation lane's notes MEAN: value keyframes joined by a curve, gates
 *  for seeded noise, ADSR bursts, or onset-to-onset cycles of a motion curve.
 *  Never stored directly - it is implied by which config the track carries
 *  (`Track.noise` / `Track.burst` / `Track.cycle`); read it through
 *  `automationMode()` in core/visual/automation.ts so the precedence stays in one
 *  place. */
export type AutomationMode = 'curve' | 'noise' | 'burst' | 'cycle'

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

/**
 * Which of the copies handed to a mover/splitter row it actually acts on.
 * Absent = all of them (the default, and what every save written before this
 * field means). The copies are cut into `slices` by `rule` - `every` interleaves
 * (`index % slices`), `runs` takes contiguous stretches - and `on` lists the
 * 0-based slices the device applies to; a copy in any other slice passes through
 * untouched.
 *
 * The semantics and the gate live in `core/visualCopies/copyTargets.ts`, whose
 * `CopyTargetSelection` this mirrors structurally. It is declared twice on
 * purpose: the document schema must not depend on the engine (see this file's
 * header note in editor/CLAUDE.md), and resolve.ts passes one shape to the other
 * so they cannot drift without a type error there.
 */
export interface CopyTargets {
  rule: 'every' | 'runs'
  slices: number
  on: number[]
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
  /** Set ONLY on the transcribed Lyrics track: sung-seconds word timing that
   *  its note beats are re-derived from on BPM changes. */
  lyricTiming?: LyricTimingWord[]
  /** Lyrics tracks only: how lyricTiming becomes notes+text - one WORD per
   *  note (default), or grouped LINES shown whole (one note per line, the
   *  line wrapped in Text Display's !...! phrase syntax). Note rebuilds
   *  (setLyricGrouping, BPM rescale) honor it; timing stays word-level. */
  lyricGrouping?: 'words' | 'lines'
  /** Automation tracks only: flips the lane into noise mode - notes gate
   *  seeded random bursts around their pitch-value instead of keyframing.
   *  (See core/visual/automation.ts NoiseConfig.) */
  noise?: { rate: number; smoothness: number; range: number; seed: number }
  /** Automation tracks only: flips the lane into burst mode - each note fires an
   *  ADSR envelope that carries the param from whatever is underneath toward the
   *  note's pitch-value, scaled by velocity and by `intensity`. Wins over `noise`
   *  if both are somehow set. (See core/visual/automation.ts BurstConfig.) */
  burst?: {
    attackBeats: number; decayBeats: number; sustainLevel: number; releaseBeats: number; intensity: number
    /** Envelope shape: absent/'adsr' = the classic piecewise ADSR; 'bezier'
     *  rides a user cubic-bezier (control Ys past 1 overshoot); 'spring' is a
     *  damped-spring simulation (stiffness/damping/mass, per-beat). */
    shape?: 'adsr' | 'bezier' | 'spring'
    bezier?: { x1: number; y1: number; x2: number; y2: number; riseBeats: number; fallBeats: number }
    spring?: { stiffness: number; damping: number; mass: number }
  }
  /** Automation tracks only: flips the lane into cycle mode - the motion curve
   *  (one cubic bezier y(x), endpoint heights included so the user decides
   *  whether the wave is seamless) plays once between each pair of consecutive
   *  note ONSETS, stretched to fit. The earlier note's pitch-value is the
   *  cycle's high (curve y = 1); `floor` is its resting value (y = 0). With
   *  `invert`, the note's value becomes the LOW and `ceiling` the constant
   *  high. (See core/visual/automation.ts CycleConfig.) */
  cycle?: {
    y0: number; x1: number; y1: number; x2: number; y2: number; y3: number
    invert?: boolean
    /** Param units. Absent = 0 (clamped into the param's range). */
    floor?: number
    /** Param units, invert mode's constant high. Absent = the param's max. */
    ceiling?: number
    /** Cycles span each note's own LENGTH instead of the gap to the next onset. */
    noteSpan?: boolean
  }
  /** Automation tracks only: how the pitch rows spread onto the value range -
   *  a value sub-range, a row count, integer snapping, and the spread's curve.
   *  Absent = the historical full-span linear mapping. The math lives in
   *  core/trackTypes.ts (pitchToValueRanged); engine and editor both read it. */
  automationRange?: { min?: number; max?: number; rows?: number; integer?: boolean; curve?: 'linear' | 'fineLow' | 'fineHigh' | 'sCurve' }
  /** Automation tracks only: master output gain on the whole lane, whatever its
   *  mode - every value it produces (keyframes, noise wander and deviation,
   *  burst targets) is multiplied by this and clamped back to the param's range.
   *  1 = as written (default), 0 = the lane flattens to zero, up to
   *  AUTOMATION_AMOUNT_MAX for boosting a lane written low. */
  automationAmount?: number
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
  /** Mover/splitter rows only: which of the copies reaching this row it acts on.
   *  Absent = all of them. See `CopyTargets`. */
  copyTargets?: CopyTargets
  targetParam?: string
  /** Automation-lane only: the target the lane drove before a drag onto a parent
   *  that couldn't take it forced a default (store's remapAutomationTarget).
   *  Restored - and cleared - when a later move lands somewhere it fits again;
   *  a deliberate retarget (setAutomationTarget) forgets it. */
  previousTargetParam?: string
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
  /** A composition instrument's MIDI rows bind stable pitches to scene
   *  identities (Main-scene tracks; see core/directors). */
  sceneBindings?: Array<{ pitch: number; sceneId: SceneId }>
  /** A switcher track's MIDI rows bind stable pitches to its CHILD devices, the
   *  same contract `sceneBindings` keeps for scenes and for the same reason: a
   *  row's pitch is the saved value, so deriving it from the child's index would
   *  silently re-time every note on the lane whenever a child is reordered or
   *  removed. Read it through `orderedSwitcherBindings` (core/switcherBindings.ts),
   *  which self-heals stale lists rather than trusting them. */
  switcherBindings?: Array<{ pitch: number; childTrackId: string }>
  /** Mover/splitter param values, keyed by the definition's param keys. */
  inputValues?: Record<string, number>
  /** Text-Display-only: the lyric clips that own this track's words
   *  (core/visual/lyricClips.ts resolves notes against them). */
  lyricClips?: LyricClip[]
  /** Text-Display-only: the style lanes its piano-roll rows wear (pitch picks
   *  the lane; absent = the default lane set). */
  styleLanes?: StyleLane[]
  /** Visual effects applied to this object's rendered output (transform/clone/shader). */
  effects?: EffectInstance[]
  /** Audio-track-only: the positioned clips this lane plays (type === 'audio'). */
  audioBlocks?: AudioBlock[]
  /** Audio-track-only: linear output gain (1 = unity, up to 1.5). Neutral is
   *  stored as ABSENCE (like automationAmount), so old documents read as 1. */
  volume?: number
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
