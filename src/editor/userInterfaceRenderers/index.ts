import { parametersUserInterfaceRenderer } from './ParametersUserInterface'
import { PhotoUserInterfaceRenderer } from './PhotoUserInterface'
import { VideoUserInterfaceRenderer } from './VideoUserInterface'
import { CubeUserInterfaceRenderer } from './CubeUserInterface'
import { TextDisplayUserInterfaceRenderer } from './TextDisplayUserInterface'
import { CameraControlUserInterfaceRenderer } from './CameraControlUserInterface'
import { OscilloscopeUserInterfaceRenderer } from './OscilloscopeUserInterface'
import { ColorFiltersUserInterfaceRenderer } from './ColorFiltersUserInterface'
import { ParticleBurstUserInterfaceRenderer } from './ParticleBurstUserInterface'
import { ParticleStreamsUserInterfaceRenderer } from './ParticleStreamsUserInterface'
import { PixelBlastUserInterfaceRenderer } from './PixelBlastUserInterface'
import { IcosahedronBurstUserInterfaceRenderer } from './IcosahedronBurstUserInterface'
import { DotFieldUserInterfaceRenderer } from './DotFieldUserInterface'
import { StarsUserInterfaceRenderer } from './StarsUserInterface'
import { FractalTunnelUserInterfaceRenderer } from './FractalTunnelUserInterface'
import { NeonPolarUserInterfaceRenderer } from './NeonPolarUserInterface'
import { HopfFibrationUserInterfaceRenderer } from './HopfFibrationUserInterface'
import { ShapeFlightUserInterfaceRenderer } from './ShapeFlightUserInterface'
import { MetronomeBallsUserInterfaceRenderer } from './MetronomeBallsUserInterface'
import { EmojiDisplayUserInterfaceRenderer } from './EmojiDisplayUserInterface'
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
  particleBurst: ParticleBurstUserInterfaceRenderer,
  particleStreams: ParticleStreamsUserInterfaceRenderer,
  pixelBlast: PixelBlastUserInterfaceRenderer,
  icosahedronBurst: IcosahedronBurstUserInterfaceRenderer,
  dotField: DotFieldUserInterfaceRenderer,
  stars: StarsUserInterfaceRenderer,
  fractalTunnel: FractalTunnelUserInterfaceRenderer,
  neonPolar: NeonPolarUserInterfaceRenderer,
  hopfFibration: HopfFibrationUserInterfaceRenderer,
  shapeFlight: ShapeFlightUserInterfaceRenderer,
  metronomeBalls: MetronomeBallsUserInterfaceRenderer,
  emojiDisplay: EmojiDisplayUserInterfaceRenderer,
}

export function getUserInterfaceRenderer(id: UserInterfaceRendererId): UserInterfaceRendererDefinition {
  return USER_INTERFACE_RENDERERS[id]
}
