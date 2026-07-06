// Free-tier watermark: each GL frame is drawn onto a reused 2D canvas with a
// "Made with Cabin Visuals" mark bottom-right, and THAT canvas feeds the
// encoder. One extra draw per frame, same-task with the render, so the
// no-readback property of the pipeline is preserved.

const MARK = 'Made with Cabin Visuals'

export interface WatermarkCompositor {
  /** Draw `src` + the mark; returns the canvas to encode instead of `src`. */
  compose(src: HTMLCanvasElement): HTMLCanvasElement
}

export function createWatermarkCompositor(width: number, height: number): WatermarkCompositor {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create watermark canvas')

  // Sized off output height so 720p and 1080p read identically.
  const fontPx = Math.max(14, Math.round(height * 0.030))
  const pad = Math.round(height * 0.032)

  return {
    compose(src) {
      ctx.drawImage(src, 0, 0, width, height)
      ctx.font = `600 ${fontPx}px system-ui, -apple-system, sans-serif`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      // Dark offset pass under a light pass — legible on any visual.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.fillText(MARK, width - pad + Math.max(1, fontPx * 0.06), height - pad + Math.max(1, fontPx * 0.06))
      ctx.fillStyle = 'rgba(255, 255, 255, 0.82)'
      ctx.fillText(MARK, width - pad, height - pad)
      return canvas
    },
  }
}
