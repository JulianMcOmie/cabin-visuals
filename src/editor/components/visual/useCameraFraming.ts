import { useLayoutEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { PerspectiveCamera } from 'three'
import { frameSceneCamera } from '../../core/visual/cameraFraming'

/** Shared by worker preview, compatibility rendering and pinned exports. */
export function useCameraFraming() {
  const { camera, size, get, set, invalidate } = useThree()
  useLayoutEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || size.width <= 0 || size.height <= 0) return
    frameSceneCamera(camera, size.width / size.height)
    // Full-frame planes read R3F's world-space viewport. Refresh it together
    // with the projection so they still cover the newly extended frame.
    const { viewport } = get()
    set({ viewport: { ...viewport, ...viewport.getCurrentViewport(camera) } })
    invalidate()
  }, [camera, size.width, size.height, get, set, invalidate])
}
