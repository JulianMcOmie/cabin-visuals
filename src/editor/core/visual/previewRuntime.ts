// The canvas governor and worker bridge coordinate without React renders per beat.
export const previewRuntime = {
  worker: false, rendering: false, frameReady: false,
  directParticles: false,
  beat: 0, revision: -1, duration: 0, error: '',
  ambient: null as ImageData | null,
  presentMs: 0,
}
const listeners = new Set<() => void>()
export function setPreviewRendering(rendering: boolean) {
  if (previewRuntime.rendering === rendering) return
  previewRuntime.rendering = rendering
  listeners.forEach(listener => listener())
}
export function subscribePreviewRendering(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

const frameListeners = new Set<() => void>()
export function notifyPreviewFrame() { frameListeners.forEach(listener => listener()) }
export function subscribePreviewFrames(listener: () => void) {
  frameListeners.add(listener)
  return () => { frameListeners.delete(listener) }
}


export type PreviewHit = { trackId: string; sceneId: string } | null
let picker: ((nx: number, ny: number, select: boolean) => Promise<PreviewHit>) | undefined
export function setWorkerPicker(value: typeof picker) { picker = value }
/** Null means compatibility picking is needed; a Promise is worker-owned. */
export function pickInWorker(nx: number, ny: number, select = false): Promise<PreviewHit> | null {
  return previewRuntime.rendering && picker ? picker(nx, ny, select) : null
}
