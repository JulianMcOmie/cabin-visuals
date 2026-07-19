import { parametersUserInterfaceRenderer } from './ParametersUserInterface'
import { PhotoUserInterfaceRenderer } from './PhotoUserInterface'
import { VideoUserInterfaceRenderer } from './VideoUserInterface'
import { CubeUserInterfaceRenderer } from './CubeUserInterface'
import { TextDisplayUserInterfaceRenderer } from './TextDisplayUserInterface'
import { CameraControlUserInterfaceRenderer } from './CameraControlUserInterface'
import { OscilloscopeUserInterfaceRenderer } from './OscilloscopeUserInterface'
import { ColorFiltersUserInterfaceRenderer } from './ColorFiltersUserInterface'
import { PointLightUserInterfaceRenderer } from './PointLightUserInterface'
import { ParticleBurstUserInterfaceRenderer } from './ParticleBurstUserInterface'
import { ParticleRiserUserInterfaceRenderer } from './ParticleRiserUserInterface'
import { ParticleStreamsUserInterfaceRenderer } from './ParticleStreamsUserInterface'
import { PixelBlastUserInterfaceRenderer } from './PixelBlastUserInterface'
import { IcosahedronBurstUserInterfaceRenderer } from './IcosahedronBurstUserInterface'
import { HexagonDotsUserInterfaceRenderer } from './HexagonDotsUserInterface'
import { DotFieldUserInterfaceRenderer } from './DotFieldUserInterface'
import { StarsUserInterfaceRenderer } from './StarsUserInterface'
import { CircleGridUserInterfaceRenderer } from './CircleGridUserInterface'
import { FractalTunnelUserInterfaceRenderer } from './FractalTunnelUserInterface'
import { NeonPolarUserInterfaceRenderer } from './NeonPolarUserInterface'
import { HopfFibrationUserInterfaceRenderer } from './HopfFibrationUserInterface'
import { ShapeFlightUserInterfaceRenderer } from './ShapeFlightUserInterface'
import { MetronomeBallsUserInterfaceRenderer } from './MetronomeBallsUserInterface'
import { WindowsXPUserInterfaceRenderer } from './WindowsXPUserInterface'
import { CrtScanlinesUserInterfaceRenderer } from './CrtScanlinesUserInterface'
import { PaddleBounceUserInterfaceRenderer } from './PaddleBounceUserInterface'
import { PixelInvadersUserInterfaceRenderer } from './PixelInvadersUserInterface'
import { ScoreTickerUserInterfaceRenderer } from './ScoreTickerUserInterface'
import { EmojiDisplayUserInterfaceRenderer } from './EmojiDisplayUserInterface'
import { FolderFlightUserInterfaceRenderer } from './FolderFlightUserInterface'
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
  textDisplay: TextDisplayUserInterfaceRenderer,
  cameraControl: CameraControlUserInterfaceRenderer,
  oscilloscope: OscilloscopeUserInterfaceRenderer,
  colorFilters: ColorFiltersUserInterfaceRenderer,
  pointLight: PointLightUserInterfaceRenderer,
  particleBurst: ParticleBurstUserInterfaceRenderer,
  particleRiser: ParticleRiserUserInterfaceRenderer,
  particleStreams: ParticleStreamsUserInterfaceRenderer,
  pixelBlast: PixelBlastUserInterfaceRenderer,
  icosahedronBurst: IcosahedronBurstUserInterfaceRenderer,
  hexagonDots: HexagonDotsUserInterfaceRenderer,
  dotField: DotFieldUserInterfaceRenderer,
  stars: StarsUserInterfaceRenderer,
  circleGrid: CircleGridUserInterfaceRenderer,
  fractalTunnel: FractalTunnelUserInterfaceRenderer,
  neonPolar: NeonPolarUserInterfaceRenderer,
  hopfFibration: HopfFibrationUserInterfaceRenderer,
  shapeFlight: ShapeFlightUserInterfaceRenderer,
  metronomeBalls: MetronomeBallsUserInterfaceRenderer,
  windowsXp: WindowsXPUserInterfaceRenderer,
  crtScanlines: CrtScanlinesUserInterfaceRenderer,
  paddleBounce: PaddleBounceUserInterfaceRenderer,
  pixelInvaders: PixelInvadersUserInterfaceRenderer,
  scoreTicker: ScoreTickerUserInterfaceRenderer,
  emojiDisplay: EmojiDisplayUserInterfaceRenderer,
  folderFlight: FolderFlightUserInterfaceRenderer,
}

export function getUserInterfaceRenderer(id: UserInterfaceRendererId): UserInterfaceRendererDefinition {
  return USER_INTERFACE_RENDERERS[id]
}
