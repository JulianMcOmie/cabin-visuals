export const PREVIEW_WIDTH = 96
export const PREVIEW_HEIGHT = 54

export interface TrackPreviewSurface {
  trackId: string
  canvas: HTMLCanvasElement
}
// Only viewport entry/exit changes this registry. Scrolling never moves a
// separate overlay or streams coordinates through React.
export const trackPreviewSurfaces = new Set<TrackPreviewSurface>()
const listeners = new Set<() => void>()
let surfaceSnapshot: TrackPreviewSurface[] = []
export const getTrackPreviewSurfaces = () => surfaceSnapshot
export function subscribeTrackPreviews(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function registerTrackPreview<T>(registry: Set<T>, entry: T) {
  registry.add(entry)
  if (registry === trackPreviewSurfaces) surfaceSnapshot = [...trackPreviewSurfaces]
  listeners.forEach(listener => listener())
  return () => {
    registry.delete(entry)
    if (registry === trackPreviewSurfaces) surfaceSnapshot = [...trackPreviewSurfaces]
    listeners.forEach(listener => listener())
  }
}
