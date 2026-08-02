import type { UserInterfaceRendererDefinition } from './types'
import { MoverUserInterfaceRenderer } from './MoverUserInterface'
import { WaypointsUserInterfaceRenderer } from './WaypointsUserInterface'
import { VisibilityMoverUserInterfaceRenderer } from './VisibilityMoverUserInterface'
import { BypassUserInterfaceRenderer } from './BypassUserInterface'
import { MeteorImpactMoverUserInterfaceRenderer } from './MeteorImpactMoverUserInterface'
import { ColorizerUserInterfaceRenderer } from './ColorizerUserInterface'
import { GradientColorizerUserInterfaceRenderer } from './GradientColorizerUserInterface'
import { CosinePaletteUserInterfaceRenderer } from './CosinePaletteUserInterface'
import { ImpactScatterMoverUserInterfaceRenderer } from './ImpactScatterMoverUserInterface'
import { ImpactPulseMoverUserInterfaceRenderer } from './ImpactPulseMoverUserInterface'
import { ConveyorMoverUserInterfaceRenderer } from './ConveyorMoverUserInterface'
import { SymmetricMotionMoverUserInterfaceRenderer } from './SymmetricMotionMoverUserInterface'
import { SymmetricRotationMoverUserInterfaceRenderer } from './SymmetricRotationMoverUserInterface'
import { ContourMoverUserInterfaceRenderer } from './ContourMoverUserInterface'
import { RadialMotionMoverUserInterfaceRenderer } from './RadialMotionMoverUserInterface'
import { RadialSplitterUserInterfaceRenderer } from './RadialSplitterUserInterface'
import { LineSplitterUserInterfaceRenderer } from './LineSplitterUserInterface'
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
import { DeformEffectUserInterfaceRenderer } from './DeformEffectUserInterface'

// Bespoke settings surfaces for the non-object tracks, mirroring the object
// registry in index.ts: movers/splitters are keyed by their definition id,
// effects by their plugin id. A missing entry falls back to the generic
// ParamControl list in TrackEditor, so registration is always optional.

export const MOVER_USER_INTERFACES: Partial<Record<string, UserInterfaceRendererDefinition>> = {
  mover: MoverUserInterfaceRenderer,
  waypoints: WaypointsUserInterfaceRenderer,
  visibility: VisibilityMoverUserInterfaceRenderer,
  bypass: BypassUserInterfaceRenderer,
  meteorImpact: MeteorImpactMoverUserInterfaceRenderer,
  // The Colorizer's definition id is still its original `calmHueRotate`.
  calmHueRotate: ColorizerUserInterfaceRenderer,
  gradient: GradientColorizerUserInterfaceRenderer,
  cosinePalette: CosinePaletteUserInterfaceRenderer,
  impactScatter: ImpactScatterMoverUserInterfaceRenderer,
  impactPulse: ImpactPulseMoverUserInterfaceRenderer,
  conveyor: ConveyorMoverUserInterfaceRenderer,
  symmetricMotion: SymmetricMotionMoverUserInterfaceRenderer,
  symmetricRotation: SymmetricRotationMoverUserInterfaceRenderer,
  contour: ContourMoverUserInterfaceRenderer,
  radialMotion: RadialMotionMoverUserInterfaceRenderer,
  radial: RadialSplitterUserInterfaceRenderer,
  line: LineSplitterUserInterfaceRenderer,
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
  deform: DeformEffectUserInterfaceRenderer,
}

export function getMoverUserInterface(definitionId: string | undefined): UserInterfaceRendererDefinition | undefined {
  return definitionId ? MOVER_USER_INTERFACES[definitionId] : undefined
}

export function getEffectUserInterface(pluginId: string): UserInterfaceRendererDefinition | undefined {
  return EFFECT_USER_INTERFACES[pluginId]
}
