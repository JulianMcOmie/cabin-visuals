import type { UserInterfaceRendererDefinition } from './types'
import { BurstMoverUserInterfaceRenderer } from './BurstMoverUserInterface'
import { TranslationOscillatorUserInterfaceRenderer } from './TranslationOscillatorUserInterface'
import { RotateBurstMoverUserInterfaceRenderer } from './RotateBurstMoverUserInterface'
import { OrbitBurstMoverUserInterfaceRenderer } from './OrbitBurstMoverUserInterface'
import { ConstantRotateMoverUserInterfaceRenderer } from './ConstantRotateMoverUserInterface'
import { ConstantOrbitMoverUserInterfaceRenderer } from './ConstantOrbitMoverUserInterface'
import { VisibilityMoverUserInterfaceRenderer } from './VisibilityMoverUserInterface'
import { RadialSplitterUserInterfaceRenderer } from './RadialSplitterUserInterface'
import { GridSplitterUserInterfaceRenderer } from './GridSplitterUserInterface'
import { OffsetEffectUserInterfaceRenderer } from './OffsetEffectUserInterface'
import { RotateEffectUserInterfaceRenderer } from './RotateEffectUserInterface'
import { ScaleEffectUserInterfaceRenderer } from './ScaleEffectUserInterface'
import { KaleidoscopeEffectUserInterfaceRenderer } from './KaleidoscopeEffectUserInterface'
import { PixelateEffectUserInterfaceRenderer } from './PixelateEffectUserInterface'
import { ChromaticAberrationEffectUserInterfaceRenderer } from './ChromaticAberrationEffectUserInterface'
import { OpacityEffectUserInterfaceRenderer } from './OpacityEffectUserInterface'

// Bespoke settings surfaces for the non-object tracks, mirroring the object
// registry in index.ts: movers/splitters are keyed by their definition id,
// effects by their plugin id. A missing entry falls back to the generic
// ParamControl list in TrackEditor, so registration is always optional.

export const MOVER_USER_INTERFACES: Partial<Record<string, UserInterfaceRendererDefinition>> = {
  burst: BurstMoverUserInterfaceRenderer,
  rotateBurst: RotateBurstMoverUserInterfaceRenderer,
  orbitBurst: OrbitBurstMoverUserInterfaceRenderer,
  constantRotate: ConstantRotateMoverUserInterfaceRenderer,
  constantOrbit: ConstantOrbitMoverUserInterfaceRenderer,
  translationOscillator: TranslationOscillatorUserInterfaceRenderer,
  visibility: VisibilityMoverUserInterfaceRenderer,
  radial: RadialSplitterUserInterfaceRenderer,
  grid: GridSplitterUserInterfaceRenderer,
}

export const EFFECT_USER_INTERFACES: Partial<Record<string, UserInterfaceRendererDefinition>> = {
  offset: OffsetEffectUserInterfaceRenderer,
  rotate: RotateEffectUserInterfaceRenderer,
  scale: ScaleEffectUserInterfaceRenderer,
  kaleidoscope: KaleidoscopeEffectUserInterfaceRenderer,
  pixelate: PixelateEffectUserInterfaceRenderer,
  chromaticAberration: ChromaticAberrationEffectUserInterfaceRenderer,
  opacity: OpacityEffectUserInterfaceRenderer,
}

export function getMoverUserInterface(definitionId: string | undefined): UserInterfaceRendererDefinition | undefined {
  return definitionId ? MOVER_USER_INTERFACES[definitionId] : undefined
}

export function getEffectUserInterface(pluginId: string): UserInterfaceRendererDefinition | undefined {
  return EFFECT_USER_INTERFACES[pluginId]
}
