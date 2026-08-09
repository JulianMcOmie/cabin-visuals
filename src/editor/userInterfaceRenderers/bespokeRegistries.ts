import type { UserInterfaceRendererDefinition } from './types'
import { MoverUserInterfaceRenderer } from './MoverUserInterface'
import { WaypointsUserInterfaceRenderer } from './WaypointsUserInterface'
import { VisibilityMoverUserInterfaceRenderer } from './VisibilityMoverUserInterface'
import { MeteorImpactMoverUserInterfaceRenderer } from './MeteorImpactMoverUserInterface'
import { ColorizerUserInterfaceRenderer } from './ColorizerUserInterface'
import { GradientColorizerUserInterfaceRenderer } from './GradientColorizerUserInterface'
import { ImpactScatterMoverUserInterfaceRenderer } from './ImpactScatterMoverUserInterface'
import { ImpactPulseMoverUserInterfaceRenderer } from './ImpactPulseMoverUserInterface'
import { ConveyorMoverUserInterfaceRenderer } from './ConveyorMoverUserInterface'
import { SymmetricMotionMoverUserInterfaceRenderer } from './SymmetricMotionMoverUserInterface'
import { RadialMotionMoverUserInterfaceRenderer } from './RadialMotionMoverUserInterface'
import { RadialSplitterUserInterfaceRenderer } from './RadialSplitterUserInterface'
import { GridSplitterUserInterfaceRenderer } from './GridSplitterUserInterface'
import { SymmetrySplitterUserInterfaceRenderer } from './SymmetrySplitterUserInterface'
import { ApproachSplitterUserInterfaceRenderer } from './ApproachSplitterUserInterface'
import { TunnelSplitterUserInterfaceRenderer } from './TunnelSplitterUserInterface'
import { OffsetEffectUserInterfaceRenderer } from './OffsetEffectUserInterface'
import { RotateEffectUserInterfaceRenderer } from './RotateEffectUserInterface'
import { ScaleEffectUserInterfaceRenderer } from './ScaleEffectUserInterface'
import { KaleidoscopeEffectUserInterfaceRenderer } from './KaleidoscopeEffectUserInterface'
import { KaleidoSkinEffectUserInterfaceRenderer } from './KaleidoSkinEffectUserInterface'
import { PixelateEffectUserInterfaceRenderer } from './PixelateEffectUserInterface'
import { ChromaticAberrationEffectUserInterfaceRenderer } from './ChromaticAberrationEffectUserInterface'
import { OpacityEffectUserInterfaceRenderer } from './OpacityEffectUserInterface'

// Bespoke settings surfaces for the non-object tracks, mirroring the object
// registry in index.ts: movers/splitters are keyed by their definition id,
// effects by their plugin id. A missing entry falls back to the generic
// ParamControl list in TrackEditor, so registration is always optional.

export const MOVER_USER_INTERFACES: Partial<Record<string, UserInterfaceRendererDefinition>> = {
  mover: MoverUserInterfaceRenderer,
  waypoints: WaypointsUserInterfaceRenderer,
  visibility: VisibilityMoverUserInterfaceRenderer,
  meteorImpact: MeteorImpactMoverUserInterfaceRenderer,
  // The Colorizer's definition id is still its original `calmHueRotate`.
  calmHueRotate: ColorizerUserInterfaceRenderer,
  gradient: GradientColorizerUserInterfaceRenderer,
  impactScatter: ImpactScatterMoverUserInterfaceRenderer,
  impactPulse: ImpactPulseMoverUserInterfaceRenderer,
  conveyor: ConveyorMoverUserInterfaceRenderer,
  symmetricMotion: SymmetricMotionMoverUserInterfaceRenderer,
  radialMotion: RadialMotionMoverUserInterfaceRenderer,
  radial: RadialSplitterUserInterfaceRenderer,
  symmetry: SymmetrySplitterUserInterfaceRenderer,
  grid: GridSplitterUserInterfaceRenderer,
  approach: ApproachSplitterUserInterfaceRenderer,
  tunnel: TunnelSplitterUserInterfaceRenderer,
}

export const EFFECT_USER_INTERFACES: Partial<Record<string, UserInterfaceRendererDefinition>> = {
  offset: OffsetEffectUserInterfaceRenderer,
  rotate: RotateEffectUserInterfaceRenderer,
  scale: ScaleEffectUserInterfaceRenderer,
  kaleidoscope: KaleidoscopeEffectUserInterfaceRenderer,
  kaleidoSkin: KaleidoSkinEffectUserInterfaceRenderer,
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
