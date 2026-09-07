import type { Object3D } from 'three'

export const PREVIEW_WIDTH = 96
export const PREVIEW_HEIGHT = 54

export interface TrackPreviewSurface {
  trackId: string
  canvas: HTMLCanvasElement
}
export interface TrackPreviewRootEntry {
  sceneId: string
  trackId: string
  object: Object3D
}

// Only viewport entry/exit changes this registry. Scrolling never moves a
// separate overlay or streams coordinates through React.
export const trackPreviewSurfaces = new Set<TrackPreviewSurface>()
export const trackPreviewRoots = new Set<TrackPreviewRootEntry>()
const listeners = new Set<() => void>()
export function subscribeTrackPreviews(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function registerTrackPreview<T>(registry: Set<T>, entry: T) {
  registry.add(entry)
  listeners.forEach(listener => listener())
  return () => {
    registry.delete(entry)
    listeners.forEach(listener => listener())
  }
}
