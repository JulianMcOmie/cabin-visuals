// A 2D-canvas bloom chain for the canvas-texture instruments: an emissive
// layer is downsampled to half and quarter resolution, blurred at widening
// octaves with falling gain (approximating a real bloom PSF's exponential
// falloff), and screen-composited back over the frame. Blurring a THIN bright
// core is what reads as light; hand-drawn radial gradients read as flat
// discs. 'screen' rather than 'lighter' because additive stacking hard-clips
// each channel at a different radius and tears a halo into terraces.
// (Midi Roll carries the same chain inline; this is the reusable copy.)

export interface BloomOctave {
  /** Downsample factor the octave blurs at (2 = half res, 4 = quarter). */
  res: 2 | 4
  blur: number
  gain: number
}

export const DEFAULT_BLOOM_OCTAVES: readonly BloomOctave[] = [
  { res: 2, blur: 1, gain: 0.5 },
  { res: 2, blur: 3, gain: 0.4 },
  { res: 4, blur: 8, gain: 0.55 },
  { res: 4, blur: 20, gain: 0.65 },
  { res: 4, blur: 40, gain: 0.7 },
]

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export class CanvasBloom {
  readonly emissive: HTMLCanvasElement
  readonly ectx: CanvasRenderingContext2D
  private readonly half: HTMLCanvasElement
  private readonly quarter: HTMLCanvasElement
  private readonly hctx: CanvasRenderingContext2D
  private readonly qctx: CanvasRenderingContext2D
  private readonly octaves: HTMLCanvasElement[]
  private readonly octx: CanvasRenderingContext2D[]
  /** True while the emissive layer holds pixels - clearing a blank layer is
   *  a full-surface touch for nothing. */
  private dirty = false

  constructor(readonly width: number, readonly height: number, readonly spec: readonly BloomOctave[] = DEFAULT_BLOOM_OCTAVES) {
    this.emissive = makeCanvas(width, height)
    this.half = makeCanvas(width / 2, height / 2)
    this.quarter = makeCanvas(width / 4, height / 4)
    this.octaves = spec.map((o) => (o.res === 2 ? makeCanvas(width / 2, height / 2) : makeCanvas(width / 4, height / 4)))
    const get = (c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('2d context unavailable')
      return ctx
    }
    this.ectx = get(this.emissive)
    this.hctx = get(this.half)
    this.qctx = get(this.quarter)
    this.octx = this.octaves.map(get)
  }

  /** Start a frame: clear last frame's emission if there was any. */
  begin(): void {
    if (this.dirty) {
      this.ectx.clearRect(0, 0, this.width, this.height)
      this.dirty = false
    }
  }

  /** Blur and screen the emissive layer onto `ctx`. `reach` scales every
   *  octave's radius; `gain` scales the summed light. */
  composite(ctx: CanvasRenderingContext2D, reach: number, gain: number): void {
    this.dirty = true
    const { half, quarter, hctx, qctx } = this
    hctx.clearRect(0, 0, half.width, half.height)
    hctx.drawImage(this.emissive, 0, 0, half.width, half.height)
    qctx.clearRect(0, 0, quarter.width, quarter.height)
    qctx.drawImage(half, 0, 0, quarter.width, quarter.height)
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    for (let i = 0; i < this.spec.length; i++) {
      const oct = this.spec[i]
      const target = this.octaves[i]
      const tctx = this.octx[i]
      const src = oct.res === 2 ? half : quarter
      tctx.clearRect(0, 0, target.width, target.height)
      tctx.filter = `blur(${Math.max(0.5, oct.blur * reach)}px)`
      tctx.drawImage(src, 0, 0)
      tctx.filter = 'none'
      ctx.globalAlpha = Math.min(1, oct.gain * gain)
      ctx.drawImage(target, 0, 0, this.width, this.height)
    }
    ctx.restore()
  }
}
