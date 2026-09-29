// The code-instrument toolkit - everything an instrument file in
// instruments/custom/ imports, from one place:
//
//   import { defineInstrument, p, Strokes, SPRITE, ease, spring } from '../../code'
//
// See instruments/custom/CLAUDE.md for the contract and recipes.

export { defineInstrument, isCodeInstrument, type CodeInstrumentDef } from './define'
export { p, rowsFrom } from './params'
export { defineComposition, type CompositionCtx, type BoundScene, type CodeCompositionDef, type CodeCompositionSpec } from './composition'
export * from './motion'
export * as motion from './motion'
export { Strokes, Sprites, SPRITE, type SpriteKind, type BlendMode, type StrokeOpts } from './kit/batch'
export { particles, Particles, type ParticleOpts } from './kit/particles'
export { GLSL } from './kit/glsl'
export type { Hit, Upcoming, PitchQuery } from './notes'
export type {
  CodeInstrumentSpec, FrameCtx, SetupCtx, MusicCtx, PostCtx, PostPass, ParamSpecs, RowSpecs,
} from './types'
export type { LayerShader, CompositionLayer } from '../../core/directors/types'
