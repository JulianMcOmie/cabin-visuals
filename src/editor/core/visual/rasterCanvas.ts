/** Raster-only canvas APIs shared by DOM export and worker instruments. */
export type RasterCanvas = { getContext(contextId: '2d', options?: CanvasRenderingContext2DSettings): RasterContext | null } & (HTMLCanvasElement | OffscreenCanvas)
export type RasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export function createRasterCanvas(): RasterCanvas {
  return (typeof document === 'undefined' ? new OffscreenCanvas(300, 150) : document.createElement('canvas')) as RasterCanvas
}
