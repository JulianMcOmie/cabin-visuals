'use client'

import { VideoClipBank } from '../components/VideoClipBank'
import { useProjectStore } from '../store/ProjectStore'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceRendererDefinition } from './types'

/** Video's existing clip bank followed by its existing parameter list. */
export const VideoUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ targetId, parameters }) => {
  const track = useProjectStore((state) => state.tracks[targetId])
  if (!track) return null
  return (
    <>
      <VideoClipBank track={track} />
      <ParameterList parameters={parameters} />
    </>
  )
}
