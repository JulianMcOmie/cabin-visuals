import { parametersUserInterfaceRenderer } from './ParametersUserInterface'
import { PhotoUserInterfaceRenderer } from './PhotoUserInterface'
import { VideoUserInterfaceRenderer } from './VideoUserInterface'
import type { UserInterfaceRendererDefinition } from './types'
import type { UserInterfaceRendererId } from './ids'

export type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
export type { UserInterfaceRendererId } from './ids'
export { ParamControl, ParamSlider } from './ParameterControl'

export const USER_INTERFACE_RENDERERS: Record<UserInterfaceRendererId, UserInterfaceRendererDefinition> = {
  parameters: parametersUserInterfaceRenderer,
  video: VideoUserInterfaceRenderer,
  photo: PhotoUserInterfaceRenderer,
}

export function getUserInterfaceRenderer(id: UserInterfaceRendererId): UserInterfaceRendererDefinition {
  return USER_INTERFACE_RENDERERS[id]
}
