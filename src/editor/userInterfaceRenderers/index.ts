import { parametersUserInterfaceRenderer } from './ParametersUserInterface'
import { PhotoUserInterfaceRenderer } from './PhotoUserInterface'
import { VideoUserInterfaceRenderer } from './VideoUserInterface'
import { CubeUserInterfaceRenderer } from './CubeUserInterface'
import { KaleidoSolidUserInterfaceRenderer } from './KaleidoSolidUserInterface'
import { TextDisplayUserInterfaceRenderer } from './TextDisplayUserInterface'
import { CameraControlUserInterfaceRenderer } from './CameraControlUserInterface'
import { CameraOrbitUserInterfaceRenderer } from './CameraOrbitUserInterface'
import { OscilloscopeUserInterfaceRenderer } from './OscilloscopeUserInterface'
import { ColorFiltersUserInterfaceRenderer } from './ColorFiltersUserInterface'
import { BassRippleUserInterfaceRenderer } from './BassRippleUserInterface'
import { ImpactWarpUserInterfaceRenderer } from './ImpactWarpUserInterface'
import { StrobeUserInterfaceRenderer } from './StrobeUserInterface'
import { ParticleBurstUserInterfaceRenderer } from './ParticleBurstUserInterface'
import { PixelBlastUserInterfaceRenderer } from './PixelBlastUserInterface'
import { IcosahedronBurstUserInterfaceRenderer } from './IcosahedronBurstUserInterface'
import { DotFieldUserInterfaceRenderer } from './DotFieldUserInterface'
import { StarsUserInterfaceRenderer } from './StarsUserInterface'
import { FractalTunnelUserInterfaceRenderer } from './FractalTunnelUserInterface'
import { NeonPolarUserInterfaceRenderer } from './NeonPolarUserInterface'
import { HopfFibrationUserInterfaceRenderer } from './HopfFibrationUserInterface'
import { LaserSphereUserInterfaceRenderer } from './LaserSphereUserInterface'
import { ShapeFlightUserInterfaceRenderer } from './ShapeFlightUserInterface'
import { MetronomeBallsUserInterfaceRenderer } from './MetronomeBallsUserInterface'
import { EmojiDisplayUserInterfaceRenderer } from './EmojiDisplayUserInterface'
import { FlashWallUserInterfaceRenderer } from './FlashWallUserInterface'
import { OverlapShapeUserInterfaceRenderer } from './OverlapShapeUserInterface'
import { OverlapSolidUserInterfaceRenderer } from './OverlapSolidUserInterface'
import { WireframeUserInterfaceRenderer } from './WireframeUserInterface'
import type { UserInterfaceRendererDefinition } from './types'
import type { UserInterfaceRendererId } from './ids'

export type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
export type { UserInterfaceRendererId } from './ids'
export { ParamControl, ParamSlider, ParamToggle } from './ParameterControl'

export const USER_INTERFACE_RENDERERS: Record<UserInterfaceRendererId, UserInterfaceRendererDefinition> = {
  parameters: parametersUserInterfaceRenderer,
  video: VideoUserInterfaceRenderer,
  photo: PhotoUserInterfaceRenderer,
  cube: CubeUserInterfaceRenderer,
  kaleidoSolid: KaleidoSolidUserInterfaceRenderer,
  textDisplay: TextDisplayUserInterfaceRenderer,
  cameraControl: CameraControlUserInterfaceRenderer,
  cameraOrbit: CameraOrbitUserInterfaceRenderer,
  oscilloscope: OscilloscopeUserInterfaceRenderer,
  colorFilters: ColorFiltersUserInterfaceRenderer,
  bassRipple: BassRippleUserInterfaceRenderer,
  impactWarp: ImpactWarpUserInterfaceRenderer,
  strobe: StrobeUserInterfaceRenderer,
  particleBurst: ParticleBurstUserInterfaceRenderer,
  pixelBlast: PixelBlastUserInterfaceRenderer,
  icosahedronBurst: IcosahedronBurstUserInterfaceRenderer,
  dotField: DotFieldUserInterfaceRenderer,
  stars: StarsUserInterfaceRenderer,
  fractalTunnel: FractalTunnelUserInterfaceRenderer,
  neonPolar: NeonPolarUserInterfaceRenderer,
  hopfFibration: HopfFibrationUserInterfaceRenderer,
  laserSphere: LaserSphereUserInterfaceRenderer,
  shapeFlight: ShapeFlightUserInterfaceRenderer,
  metronomeBalls: MetronomeBallsUserInterfaceRenderer,
  emojiDisplay: EmojiDisplayUserInterfaceRenderer,
  flashWall: FlashWallUserInterfaceRenderer,
  overlapShape: OverlapShapeUserInterfaceRenderer,
  overlapSolid: OverlapSolidUserInterfaceRenderer,
  wireframe: WireframeUserInterfaceRenderer,
}

export function getUserInterfaceRenderer(id: UserInterfaceRendererId): UserInterfaceRendererDefinition {
  return USER_INTERFACE_RENDERERS[id]
}
