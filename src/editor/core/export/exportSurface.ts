import type { RootState } from '@react-three/fiber'

/** Check before compositing as well as encoding: a watermark canvas would hide
 * a resized source by stretching it back to the requested dimensions. */
export function assertExportSize(source: { width: number; height: number }, width: number, height: number): void {
  if (source.width !== width || source.height !== height) {
    throw new Error(`Export stopped: the render surface changed to ${source.width}×${source.height}; expected ${width}×${height}. No video was saved. Please retry the export.`)
  }
}

/** Own R3F's size/DPR for the entire capture, including async frame inputs and
 * encoder backpressure. Canvas.configure (ResizeObserver and display changes)
 * calls these store setters even with frameloop='never'. Deferring them keeps
 * the camera, viewport and effect targets fixed too, not just the canvas pixels.
 * Restore the latest requested layout on release, rather than the stale size
 * from before the user moved/resized the window. */
export function pinExportSurface(get: () => RootState, width: number, height: number) {
  const state = get()
  const { setSize, setDpr, setFrameloop } = state
  let size = state.size
  let dpr: Parameters<RootState['setDpr']>[0] = state.viewport.dpr
  let frameloop = state.frameloop
  let released = false
  let contextLost = false
  const canvas = state.gl.domElement
  const onContextLost = () => { contextLost = true }
  canvas.addEventListener('webglcontextlost', onContextLost)

  const release = () => {
    if (released) return
    released = true
    canvas.removeEventListener('webglcontextlost', onContextLost)
    get().set({ setSize, setDpr, setFrameloop })
    setSize(size.width, size.height, size.top, size.left)
    setDpr(dpr)
    setFrameloop(frameloop)
  }

  const assertValid = () => {
    if (released) throw new Error('Export stopped: the render surface was released. Please retry the export.')
    const current = get()
    const context = current.gl.getContext()
    if (contextLost || context.isContextLost()) {
      throw new Error('Export stopped: the graphics context was lost. No video was saved. Please retry the export.')
    }
    assertExportSize(current.size, width, height)
    assertExportSize(canvas, width, height)
    assertExportSize({ width: context.drawingBufferWidth, height: context.drawingBufferHeight }, width, height)
    if (current.viewport.dpr !== 1 || current.frameloop !== 'never') {
      throw new Error('Export stopped: the renderer settings changed during capture. No video was saved. Please retry the export.')
    }
  }

  try {
    state.set({
      setSize: (w, h, top = 0, left = 0) => { size = { width: w, height: h, top, left } },
      setDpr: (value) => { dpr = value },
      setFrameloop: (value = 'always') => { frameloop = value },
    })
    setFrameloop('never')
    setDpr(1)
    setSize(width, height)
    // R3F's renderer subscription writes export-sized inline styles. Keep the
    // display responsive without letting CSS measurements resize the buffer.
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    assertValid()
  } catch (error) {
    release()
    throw error
  }
  return { assertValid, release }
}
