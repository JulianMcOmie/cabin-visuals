// The code-instrument contract. A code instrument is ONE file that exports
// `instrument = defineInstrument({...})` from src/editor/instruments/custom/<pack>/.
// No registry edit, no picker entry, no glyph, no panel: the codegen registry
// (scripts/code-instruments.cjs) picks the file up, the generic settings panel
// renders its params, the MIDI editor shows its rows. See custom/CLAUDE.md.
//
// Type-only imports keep this module safe for node (CLI, tests).

import type { Camera, Color, Group, IUniform, WebGLRenderer } from 'three'
import type { ResolvedNote } from '../../core/visual/types'
import type { NoteQueries } from './notes'
import type { Look } from '../../core/visual/look'
import type { CameraPose } from '../../core/visual/cameraOwner'
import type { PanelSpec } from '../../userInterfaceRenderers/console/spec'

export type { Look, CameraPose, PanelSpec }

// ------------------------------------------------------------------ params

interface ParamSpecBase {
  label?: string
  /** Show only while another param is on (`'key'`) or equals a value (`'key=2'`). */
  showIf?: string
}
export interface NumSpec extends ParamSpecBase { kind: 'num'; default: number; min: number; max: number; step?: number; curve?: number; integer?: boolean }
export interface BoolSpec extends ParamSpecBase { kind: 'bool'; default: boolean }
export interface SelectSpec extends ParamSpecBase { kind: 'select'; options: string[]; default: number }
export interface ColorSpec extends ParamSpecBase { kind: 'color'; default: string }
export interface TextSpec extends ParamSpecBase { kind: 'text'; default: string; multiline?: boolean }
export type ParamSpec = NumSpec | BoolSpec | SelectSpec | ColorSpec | TextSpec
export type ParamSpecs = Record<string, ParamSpec>

// ------------------------------------------------------------------ MIDI rows

/** One row of the instrument's MIDI vocabulary: a label, or a label with options. */
export type RowSpec = string | { label: string; color?: string; emphasized?: boolean }
/** pitch → row. The editor shows exactly these rows (highest pitch on top);
 *  omit `rows` entirely for the full piano roll (pitch-reactive instruments). */
export type RowSpecs = Record<number, RowSpec>

// ------------------------------------------------------------------ contexts

/** Time + params + MIDI: everything a pure function of the beat may read.
 *  Shared by instrument frames, post passes and compositions. */
export interface MusicCtx extends NoteQueries {
  /** The playhead, fractional beats - THE clock. */
  beat: number
  /** beat / beatsPerBar. */
  bar: number
  /** Position inside the bar, 0..beatsPerBar. */
  beatInBar: number
  beatsPerBar: number
  secPerBeat: number
  bpm: number
  /** beat * secPerBeat - for motion that should keep its speed across tempos. */
  sec: number
  /** Numeric params (bools are 0/1, selects are the option index), defaults filled. */
  params: Record<string, number>
  /** Colour params as LINEAR THREE.Colors (reused objects - copy before keeping). */
  colors: Record<string, Color>
  /** Text params. */
  text: Record<string, string>
  /** The track's full note stream (absolute beats). */
  notes: readonly ResolvedNote[]
  /** Notes sounding now. */
  active: readonly ResolvedNote[]
  /** Seeded random in [0,1) - the only randomness allowed (see motion.hash/rng). */
  rand(...seed: number[]): number
  /** Another track's notes, as the same queries: a shared lane ('Kick') or any
   *  track by 'Scene/Track'. One Kick lane can drive every instrument in the
   *  song (cabin lanes --from-analysis writes them). Empty when absent. */
  lane(name: string): NoteQueries & { notes: readonly ResolvedNote[] }
}

export interface FrameCtx extends MusicCtx {
  trackId: string
  /** Decaying pulse from the latest note (engine's universal "a note hit"). */
  energy: number
  /** The object's current fade (movers, visibility). Already applied to materials
   *  that carry uOpacity - read it for anything else you fade by hand. */
  opacity: number
  /** Is the playhead inside one of this track's blocks? */
  inBlock: boolean
  /** The object's root: add your meshes here (local space; placement, movers and
   *  splitters apply outside it). For fullFrame instruments this is a screen
   *  anchor: x/y span ±viewport.width/2 × ±viewport.height/2 at z = 0. */
  root: Group
  camera: Camera
  gl: WebGLRenderer
  /** Canvas size in CSS px, and px per 1080p pixel (for resolution-independent sizes). */
  size: { width: number; height: number }
  px: number
  aspect: number
  /** World units that exactly fill the frame at the full-frame anchor depth. */
  viewport: { width: number; height: number }
  /** Take the camera for this frame when you move `ctx.camera` by hand (the
   *  `camera()` hook claims it for you). Released automatically - back to the
   *  default pose - when this track's scene leaves the screen. */
  claimCamera(): void
}

export interface SetupCtx {
  trackId: string
  root: Group
  camera: Camera
  gl: WebGLRenderer
  size: { width: number; height: number }
  px: number
  params: Record<string, number>
  colors: Record<string, Color>
  text: Record<string, string>
  /** Register something with dispose() to be cleaned up on unmount. Returns it. */
  own<T extends { dispose(): void }>(thing: T): T
}

// ------------------------------------------------------------------ post passes

/** Context for a scene post pass: music + params, plus the frame's shape. */
export interface PostCtx extends MusicCtx {
  trackId: string
  energy: number
  opacity: number
  aspect: number
  resolution: { width: number; height: number }
}

/**
 * A full-frame shader over the finished scene (after the built-in post passes,
 * before the scene effect chain). The fragment gets `uniform sampler2D tDiffuse`
 * (the scene so far), `varying vec2 vUv`, `uniform float uAspect, uBeat`,
 * `uniform vec2 uResolution`, plus your `uniforms`. Write gl_FragColor.
 */
export interface PostPass {
  fragment: string
  uniforms?: Record<string, IUniform>
  /** Set this frame's uniforms. Return false to skip the pass (an idle pass is free). */
  update?(ctx: PostCtx, uniforms: Record<string, IUniform>): boolean | void
}

// ------------------------------------------------------------------ the spec

export interface CodeInstrumentSpec<S = any> {
  /** Globally unique and persisted in projects: '<pack>.<name>', e.g. 'innuendo.chladni'. */
  id: string
  name: string
  /** One sentence for the library tooltip: what it looks like, what notes do. */
  description?: string
  /** Identity colour (hex) for its timeline row and notes. */
  color?: string
  params?: ParamSpecs
  rows?: RowSpecs
  /** A screen: pinned to the camera, drawn in viewport units (see FrameCtx.root). */
  fullFrame?: boolean
  /** Draw in the depth-cleared on-top pass by default. */
  onTop?: boolean
  castsShadows?: boolean
  /** Build three.js objects once (add them to ctx.root); return per-mount state. */
  setup?(ctx: SetupCtx): S
  /** Pose everything for this instant. MUST be a pure function of ctx (no
   *  accumulating across calls: frames may arrive in any order). */
  frame?(ctx: FrameCtx, state: S): void
  /** Optional scene-wide shader pass(es) this instrument drives. */
  post?: PostPass | PostPass[]
  /** Drive THE camera (there is one, shared by every scene) while this track's
   *  scene is on screen: return a pose each frame. Pure like frame(). */
  camera?(ctx: FrameCtx, state: S): CameraPose | void
  /** The frame's grade while this track's scene is on screen: bloom, exposure,
   *  saturation, contrast, vignette, grain, aberration, tint, fade. */
  look?(ctx: FrameCtx, state: S): Look | void
  /** The settings panel: a console spec (knobs, pills, segmented rows - see
   *  userInterfaceRenderers/console/spec.tsx), 'auto' (default: built from
   *  params - knobs for numbers, pills for colours, segments for selects), or
   *  false for the plain parameter list. */
  panel?: PanelSpec | 'auto' | false
  dispose?(state: S): void
}
