import { parametersUserInterfaceRenderer } from './ParametersUserInterface'
import { lazyPanel } from './lazyPanel'
import type { UserInterfaceRendererDefinition } from './types'
import type { UserInterfaceRendererId } from './ids'

export type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
export type { UserInterfaceRendererId } from './ids'
export { ParamControl, ParamSlider, ParamToggle } from './ParameterControl'

// Every bespoke panel loads on demand (see lazyPanel.ts). Only `parameters`
// (the generic list, also the console kit's fallback) stays static: it is tiny
// and always in the bundle anyway.
export const USER_INTERFACE_RENDERERS: Record<UserInterfaceRendererId, UserInterfaceRendererDefinition> = {
  parameters: parametersUserInterfaceRenderer,
  video: lazyPanel(() => import('./VideoUserInterface'), 'VideoUserInterfaceRenderer'),
  photo: lazyPanel(() => import('./PhotoUserInterface'), 'PhotoUserInterfaceRenderer'),
  cube: lazyPanel(() => import('./CubeUserInterface'), 'CubeUserInterfaceRenderer'),
  kaleidoSolid: lazyPanel(() => import('./KaleidoSolidUserInterface'), 'KaleidoSolidUserInterfaceRenderer'),
  textDisplay: lazyPanel(() => import('./TextDisplayUserInterface'), 'TextDisplayUserInterfaceRenderer'),
  cameraControl: lazyPanel(() => import('./CameraControlUserInterface'), 'CameraControlUserInterfaceRenderer'),
  cameraOrbit: lazyPanel(() => import('./CameraOrbitUserInterface'), 'CameraOrbitUserInterfaceRenderer'),
  oscilloscope: lazyPanel(() => import('./OscilloscopeUserInterface'), 'OscilloscopeUserInterfaceRenderer'),
  colorFilters: lazyPanel(() => import('./ColorFiltersUserInterface'), 'ColorFiltersUserInterfaceRenderer'),
  bassRipple: lazyPanel(() => import('./BassRippleUserInterface'), 'BassRippleUserInterfaceRenderer'),
  impactWarp: lazyPanel(() => import('./ImpactWarpUserInterface'), 'ImpactWarpUserInterfaceRenderer'),
  strobe: lazyPanel(() => import('./StrobeUserInterface'), 'StrobeUserInterfaceRenderer'),
  particleBurst: lazyPanel(() => import('./ParticleBurstUserInterface'), 'ParticleBurstUserInterfaceRenderer'),
  pixelBlast: lazyPanel(() => import('./PixelBlastUserInterface'), 'PixelBlastUserInterfaceRenderer'),
  icosahedronBurst: lazyPanel(() => import('./IcosahedronBurstUserInterface'), 'IcosahedronBurstUserInterfaceRenderer'),
  dotField: lazyPanel(() => import('./DotFieldUserInterface'), 'DotFieldUserInterfaceRenderer'),
  stars: lazyPanel(() => import('./StarsUserInterface'), 'StarsUserInterfaceRenderer'),
  fractalTunnel: lazyPanel(() => import('./FractalTunnelUserInterface'), 'FractalTunnelUserInterfaceRenderer'),
  neonPolar: lazyPanel(() => import('./NeonPolarUserInterface'), 'NeonPolarUserInterfaceRenderer'),
  hopfFibration: lazyPanel(() => import('./HopfFibrationUserInterface'), 'HopfFibrationUserInterfaceRenderer'),
  laserSphere: lazyPanel(() => import('./LaserSphereUserInterface'), 'LaserSphereUserInterfaceRenderer'),
  shapeFlight: lazyPanel(() => import('./ShapeFlightUserInterface'), 'ShapeFlightUserInterfaceRenderer'),
  metronomeBalls: lazyPanel(() => import('./MetronomeBallsUserInterface'), 'MetronomeBallsUserInterfaceRenderer'),
  emojiDisplay: lazyPanel(() => import('./EmojiDisplayUserInterface'), 'EmojiDisplayUserInterfaceRenderer'),
  flashWall: lazyPanel(() => import('./FlashWallUserInterface'), 'FlashWallUserInterfaceRenderer'),
  overlapShape: lazyPanel(() => import('./OverlapShapeUserInterface'), 'OverlapShapeUserInterfaceRenderer'),
  overlapSolid: lazyPanel(() => import('./OverlapSolidUserInterface'), 'OverlapSolidUserInterfaceRenderer'),
  wireframe: lazyPanel(() => import('./WireframeUserInterface'), 'WireframeUserInterfaceRenderer'),
}

export function getUserInterfaceRenderer(id: UserInterfaceRendererId): UserInterfaceRendererDefinition {
  return USER_INTERFACE_RENDERERS[id]
}
