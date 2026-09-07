import type { UserInterfaceRendererDefinition } from './types'
import { lazyPanel } from './lazyPanel'
import { gradeScenePlugin } from '../effects/scene/grade'
import { lensScenePlugin } from '../effects/scene/lens'
import { blurScenePlugin } from '../effects/scene/blur'
import { grainScenePlugin } from '../effects/scene/grain'
import { crushScenePlugin } from '../effects/scene/crush'
import { glitchScenePlugin } from '../effects/scene/glitch'
import { mirrorScenePlugin } from '../effects/scene/mirror'

// Bespoke settings surfaces for the non-object tracks, mirroring the object
// registry in index.ts: movers/splitters are keyed by their definition id,
// effects by their plugin id. A missing entry falls back to the generic
// ParamControl list in TrackEditor, so registration is always optional.
// Every panel loads on demand (lazyPanel.ts) — the maps stay synchronous.

export const MOVER_USER_INTERFACES: Partial<Record<string, UserInterfaceRendererDefinition>> = {
  mover: lazyPanel(() => import('./MoverUserInterface'), 'MoverUserInterfaceRenderer'),
  waypoints: lazyPanel(() => import('./WaypointsUserInterface'), 'WaypointsUserInterfaceRenderer'),
  visibility: lazyPanel(() => import('./VisibilityMoverUserInterface'), 'VisibilityMoverUserInterfaceRenderer'),
  bypass: lazyPanel(() => import('./BypassUserInterface'), 'BypassUserInterfaceRenderer'),
  meteorImpact: lazyPanel(() => import('./MeteorImpactMoverUserInterface'), 'MeteorImpactMoverUserInterfaceRenderer'),
  // The Colorizer's definition id is still its original `calmHueRotate`.
  calmHueRotate: lazyPanel(() => import('./ColorizerUserInterface'), 'ColorizerUserInterfaceRenderer'),
  gradient: lazyPanel(() => import('./GradientColorizerUserInterface'), 'GradientColorizerUserInterfaceRenderer'),
  cosinePalette: lazyPanel(() => import('./CosinePaletteUserInterface'), 'CosinePaletteUserInterfaceRenderer'),
  hueRotate: lazyPanel(() => import('./HueRotateUserInterface'), 'HueRotateUserInterfaceRenderer'),
  impactScatter: lazyPanel(() => import('./ImpactScatterMoverUserInterface'), 'ImpactScatterMoverUserInterfaceRenderer'),
  impactPulse: lazyPanel(() => import('./ImpactPulseMoverUserInterface'), 'ImpactPulseMoverUserInterfaceRenderer'),
  conveyor: lazyPanel(() => import('./ConveyorMoverUserInterface'), 'ConveyorMoverUserInterfaceRenderer'),
  symmetricMotion: lazyPanel(() => import('./SymmetricMotionMoverUserInterface'), 'SymmetricMotionMoverUserInterfaceRenderer'),
  symmetricRotation: lazyPanel(() => import('./SymmetricRotationMoverUserInterface'), 'SymmetricRotationMoverUserInterfaceRenderer'),
  contour: lazyPanel(() => import('./ContourMoverUserInterface'), 'ContourMoverUserInterfaceRenderer'),
  radialMotion: lazyPanel(() => import('./RadialMotionMoverUserInterface'), 'RadialMotionMoverUserInterfaceRenderer'),
  radial: lazyPanel(() => import('./RadialSplitterUserInterface'), 'RadialSplitterUserInterfaceRenderer'),
  line: lazyPanel(() => import('./LineSplitterUserInterface'), 'LineSplitterUserInterfaceRenderer'),
  symmetry: lazyPanel(() => import('./SymmetrySplitterUserInterface'), 'SymmetrySplitterUserInterfaceRenderer'),
  grid: lazyPanel(() => import('./GridSplitterUserInterface'), 'GridSplitterUserInterfaceRenderer'),
  approach: lazyPanel(() => import('./ApproachSplitterUserInterface'), 'ApproachSplitterUserInterfaceRenderer'),
  tunnel: lazyPanel(() => import('./TunnelSplitterUserInterface'), 'TunnelSplitterUserInterfaceRenderer'),
}

// The scene chain's seven devices are one family sharing a chassis, so they
// live in one module (SceneFxUserInterface.tsx) exporting a map keyed by
// plugin id; each entry here reaches into that map once it loads.
const sceneFxPanel = (pluginId: string): UserInterfaceRendererDefinition =>
  lazyPanel(
    () => import('./SceneFxUserInterface').then((m) => m.SCENE_FX_USER_INTERFACES),
    pluginId,
  )

export const EFFECT_USER_INTERFACES: Partial<Record<string, UserInterfaceRendererDefinition>> = {
  offset: lazyPanel(() => import('./OffsetEffectUserInterface'), 'OffsetEffectUserInterfaceRenderer'),
  rotate: lazyPanel(() => import('./RotateEffectUserInterface'), 'RotateEffectUserInterfaceRenderer'),
  scale: lazyPanel(() => import('./ScaleEffectUserInterface'), 'ScaleEffectUserInterfaceRenderer'),
  kaleidoscope: lazyPanel(() => import('./KaleidoscopeEffectUserInterface'), 'KaleidoscopeEffectUserInterfaceRenderer'),
  kaleidoSkin: lazyPanel(() => import('./KaleidoSkinEffectUserInterface'), 'KaleidoSkinEffectUserInterfaceRenderer'),
  pixelate: lazyPanel(() => import('./PixelateEffectUserInterface'), 'PixelateEffectUserInterfaceRenderer'),
  chromaticAberration: lazyPanel(() => import('./ChromaticAberrationEffectUserInterface'), 'ChromaticAberrationEffectUserInterfaceRenderer'),
  opacity: lazyPanel(() => import('./OpacityEffectUserInterface'), 'OpacityEffectUserInterfaceRenderer'),
  deform: lazyPanel(() => import('./DeformEffectUserInterface'), 'DeformEffectUserInterfaceRenderer'),
  [gradeScenePlugin.id]: sceneFxPanel(gradeScenePlugin.id),
  [lensScenePlugin.id]: sceneFxPanel(lensScenePlugin.id),
  [blurScenePlugin.id]: sceneFxPanel(blurScenePlugin.id),
  [grainScenePlugin.id]: sceneFxPanel(grainScenePlugin.id),
  [crushScenePlugin.id]: sceneFxPanel(crushScenePlugin.id),
  [glitchScenePlugin.id]: sceneFxPanel(glitchScenePlugin.id),
  [mirrorScenePlugin.id]: sceneFxPanel(mirrorScenePlugin.id),
}

export function getMoverUserInterface(definitionId: string | undefined): UserInterfaceRendererDefinition | undefined {
  return definitionId ? MOVER_USER_INTERFACES[definitionId] : undefined
}

export function getEffectUserInterface(pluginId: string): UserInterfaceRendererDefinition | undefined {
  return EFFECT_USER_INTERFACES[pluginId]
}
