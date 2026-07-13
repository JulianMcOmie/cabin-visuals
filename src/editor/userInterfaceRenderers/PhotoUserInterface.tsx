'use client'

import { PhotoBank } from '../components/PhotoBank'
import { useProjectStore } from '../store/ProjectStore'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceRendererDefinition } from './types'

/** Photo's existing bank followed by its existing parameter list. */
export const PhotoUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ targetId, parameters }) => {
  const track = useProjectStore((state) => state.tracks[targetId])
  if (!track) return null
  return (
    <>
      <PhotoBank track={track} />
      <ParameterList parameters={parameters} />
    </>
  )
}
