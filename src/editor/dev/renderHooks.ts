import { getFrameDriver } from '../core/export/frameDriver'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { whenInstrumentsSettled } from '../instruments/lazyInstrument'
import { listCodeErrors } from '../instruments/code/errors'
import { getCompositionLayers, setMainCompositionOverride } from '../core/visual/VisualEngine'
import { getInstrument } from '../instruments'
import { compositionDef } from '../core/directors'

// DEV-ONLY render hooks for the `cabin` CLI's headless page (tools/cabin/daemon.ts).
// Everything renders through the FrameDriver - the export path - so a still or a
// streamed frame is exactly what an export would encode at that beat.
//
//   __cabinRender.view('main' | '<scene name or id>')
//   __cabinRender.captureBeats([beats], { width, height }) → PNG data URLs
//   __cabinRender.stream({ startBeat, frames, fps, width, height, subframes, shutter, url })
//       raw RGBA frames (bottom-up rows) over a WebSocket to `url`; subframes > 1
//       averages that many renders across the shutter - real motion blur.

export interface AuditOpts { startBeat: number; endBeat: number; step: number; width?: number; height?: number }

/** One measured frame (all 0..1). */
export interface AuditFrame {
  beat: number
  /** Mean luminance. */
  mean: number
  /** Fraction of near-black / near-white pixels. */
  black: number
  white: number
  /** Fraction of pixels with visible content (luminance > 0.06). */
  coverage: number
  /** High-frequency energy where there's content: mean |Laplacian| / mean luminance. */
  grain: number
  /** Mean |Δluminance| from the previous sampled frame. */
  motion: number
  /** Mean chroma (max - min channel). */
  chroma: number
  /** Scenes on screen, strongest first: [name, opacity]. */
  scenes: Array<[string, number]>
}

export interface DocSkeleton {
  bpm: number
  scenes: Array<{ id: string; name: string; trackIds: string[] }>
  /** Code instrument / composition ids the document uses ('<pack>.<name>'). */
  codeIds?: string[]
}

interface StreamOpts {
  startBeat: number
  frames: number
  fps: number
  width: number
  height: number
  /** Renders averaged per output frame (1 = no motion blur). */
  subframes?: number
  /** Fraction of the frame interval the shutter is open (0.5 = 180°). */
  shutter?: number
  url: string
}

declare global {
  interface Window {
    __cabinRender?: {
      view: (target: string) => { view: 'main' | 'scene'; sceneId?: string }
      captureBeats: (beats: number[], opts?: { width?: number; height?: number }) => Promise<string[]>
      stream: (opts: StreamOpts) => Promise<{ frames: number; ms: number }>
      errors: () => ReturnType<typeof listCodeErrors>
      /** What differs between the editor's stores and a document's skeleton
       *  (empty = the page is showing that document). */
      mismatch: (doc: DocSkeleton) => string[]
      /** Render [startBeat, endBeat) every `step` beats at a small size and measure each frame. */
      audit: (opts: AuditOpts) => Promise<AuditFrame[]>
    }
  }
}

async function readyDriver() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const driver = getFrameDriver()
    if (driver) return driver
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('frame driver never registered (is the canvas mounted?)')
}

function glContext(): WebGL2RenderingContext | WebGLRenderingContext {
  const three = (window as unknown as { __three?: { gl: { getContext: () => WebGL2RenderingContext } } }).__three
  if (!three) throw new Error('window.__three missing (dev build only)')
  return three.gl.getContext()
}

// The FrameDriver's pin() forces the Composite (exports always render the final
// composition); a capture of ONE scene lifts that override again after pinning,
// so the canvas follows the editor's scene view (App's PreviewSceneSync).
let viewMode: 'main' | 'scene' = 'main'
function pinFor(driver: NonNullable<ReturnType<typeof getFrameDriver>>, width: number, height: number) {
  driver.pin(width, height)
  if (viewMode === 'scene') setMainCompositionOverride(false)
}

export function installDevRenderHooks() {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
  window.__cabinRender = {
    view: (target) => {
      const ui = useUIStore.getState()
      if (target === 'main' || target === 'composite') {
        ui.setCanvasView('main')
        viewMode = 'main'
        return { view: 'main' }
      }
      const { scenes, sceneOrder } = useProjectStore.getState()
      const id = sceneOrder.find((sid) => sid === target || scenes[sid]?.name.toLowerCase() === target.toLowerCase())
      if (!id || scenes[id].isMain) throw new Error(`no scene "${target}" (have: ${sceneOrder.map((s) => scenes[s].name).join(', ')})`)
      useProjectStore.getState().setActiveScene(id)
      ui.setCanvasView('scene')
      viewMode = 'scene'
      return { view: 'scene', sceneId: id }
    },

    captureBeats: async (beats, opts = {}) => {
      const width = opts.width ?? 960
      const height = opts.height ?? 540
      await whenInstrumentsSettled()
      const driver = await readyDriver()
      const { bpm } = useProjectStore.getState()
      pinFor(driver, width, height)
      try {
        const out: string[] = []
        for (const beat of beats) {
          const ms = (beat * 60_000) / bpm
          // Twice: a full-frame canvas instrument may return false on the first
          // pass while an asset loads; the second pass lands the retry.
          driver.renderFrame(beat, ms)
          driver.renderFrame(beat, ms)
          out.push(driver.getCanvas().toDataURL('image/png'))
        }
        return out
      } finally {
        driver.unpin()
      }
    },

    stream: async (o) => {
      const t0 = Date.now()
      await whenInstrumentsSettled()
      const driver = await readyDriver()
      const { bpm } = useProjectStore.getState()
      const n = Math.max(1, Math.round(o.subframes ?? 1))
      const shutter = o.shutter ?? 0.5
      const beatsPerFrame = bpm / (60 * o.fps)
      const ws = new WebSocket(o.url)
      ws.binaryType = 'arraybuffer'
      await new Promise<void>((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error(`cannot reach ${o.url}`)) })
      const done = new Promise<void>((ok) => { ws.onmessage = (m) => { if (m.data === 'done') ok() } })
      pinFor(driver, o.width, o.height)
      try {
        const gl = glContext()
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
        ws.send(JSON.stringify({ width: w, height: h }))
        const px = w * h * 4
        const frame = new Uint8Array(px)
        const acc = n > 1 ? new Uint16Array(px) : null
        const bufs = [new Uint8Array(px), new Uint8Array(px)]
        for (let i = 0; i < o.frames; i++) {
          const beat = o.startBeat + i * beatsPerFrame
          const out = bufs[i % 2]
          if (!acc) {
            driver.renderFrame(beat, (beat * 60_000) / bpm)
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out)
          } else {
            acc.fill(0)
            for (let s = 0; s < n; s++) {
              const b = beat + ((s + 0.5) / n - 0.5) * shutter * beatsPerFrame
              driver.renderFrame(b, (b * 60_000) / bpm)
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, frame)
              for (let k = 0; k < px; k++) acc[k] += frame[k]
            }
            for (let k = 0; k < px; k++) out[k] = (acc[k] + (n >> 1)) / n
          }
          // Backpressure: keep at most ~3 frames queued in the socket.
          while (ws.bufferedAmount > px * 3) await new Promise((r) => setTimeout(r, 1))
          ws.send(out)
        }
        ws.send('end')
        await done
        ws.close()
        return { frames: o.frames, ms: Date.now() - t0 }
      } finally {
        driver.unpin()
      }
    },

    errors: () => listCodeErrors(),

    audit: async (o) => {
      const width = o.width ?? 192
      const height = o.height ?? 108
      await whenInstrumentsSettled()
      const driver = await readyDriver()
      const { bpm, scenes } = useProjectStore.getState()
      pinFor(driver, width, height)
      try {
        const gl = glContext()
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
        const px = new Uint8Array(w * h * 4)
        let prev: Float32Array | null = null
        const out: AuditFrame[] = []
        for (let beat = o.startBeat; beat < o.endBeat - 1e-9; beat += o.step) {
          driver.renderFrame(beat, (beat * 60_000) / bpm)
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
          const lum = new Float32Array(w * h)
          let sum = 0, black = 0, white = 0, cover = 0, chroma = 0
          for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
            const r = px[j] / 255, g = px[j + 1] / 255, b = px[j + 2] / 255
            const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
            lum[i] = l
            sum += l
            if (l < 0.03) black++
            if (l > 0.92) white++
            if (l > 0.06) cover++
            chroma += Math.max(r, g, b) - Math.min(r, g, b)
          }
          let lap = 0, lapN = 0, motion = 0
          for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
              const i = y * w + x
              if (lum[i] <= 0.06) continue
              lap += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w])
              lapN++
            }
          }
          if (prev) for (let i = 0; i < lum.length; i++) motion += Math.abs(lum[i] - prev[i])
          const n = lum.length
          const contentMean = lapN ? lum.reduce((s2, l) => s2 + (l > 0.06 ? l : 0), 0) / lapN : 0
          const layers = getCompositionLayers()
            .map((l) => [scenes[l.sceneId]?.name ?? l.sceneId, l.opacity] as [string, number])
            .sort((a, b) => b[1] - a[1])
          out.push({
            beat, mean: sum / n, black: black / n, white: white / n, coverage: cover / n,
            grain: lapN ? lap / lapN / Math.max(0.02, contentMean) : 0,
            motion: prev ? motion / n : 0, chroma: chroma / n, scenes: layers,
          })
          prev = lum
        }
        return out
      } finally {
        driver.unpin()
      }
    },

    // A hot reload can leave the page rendering a fresh default store while the
    // file-sync closure still holds the old one (so its version looks current).
    // The daemon checks the skeleton, not just the version, before capturing.
    mismatch: (doc) => {
      const { bpm, scenes } = useProjectStore.getState()
      const out: string[] = []
      if (Math.abs(bpm - doc.bpm) > 1e-6) out.push(`bpm ${bpm} ≠ ${doc.bpm}`)
      for (const s of doc.scenes) {
        const have = scenes[s.id]
        if (!have) { out.push(`scene "${s.name}" missing`); continue }
        if (have.name !== s.name) out.push(`scene "${s.name}" is named "${have.name}"`)
        const missing = s.trackIds.filter((t) => !have.tracks[t])
        if (missing.length) out.push(`scene "${s.name}": ${missing.length} track(s) missing`)
      }
      // A registry can go stale under HMR too (a module re-executed around it).
      for (const id of doc.codeIds ?? []) {
        if (!getInstrument(id) && !compositionDef(id)) out.push(`unknown instrument "${id}"`)
      }
      return out
    },
  }
}
