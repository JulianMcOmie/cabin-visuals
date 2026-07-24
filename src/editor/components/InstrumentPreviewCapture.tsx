'use client'

import { useEffect, useRef, useState } from 'react'
import { Canvas, advance } from '@react-three/fiber'
import type { WebGLRenderer } from 'three'
import {
  canPreview,
  LaserPreviewBloom,
  MoverPreview,
  ObjectPreview,
  setPreviewTimeOverride,
} from './InstrumentHoverPreview'
import { get2DPreview } from './InstrumentPreview2D'
import { ALL_LIBRARY_ITEMS, type InstrumentItem } from './LeftSidebar'
import { Mp4Writer } from '../core/export/mux'
import { videoCodec } from '../core/export/types'

// DEV-ONLY (see app/dev/instrument-previews). The library's live card previews
// share one WebGL context (InstrumentCardPreviewCanvas + Views) but still
// re-render every visible instrument each frame, competing with the main
// canvas - and the shared-View path can't run per-card postprocessing, so
// lasers lost their bloom there. This page turns each preview into an
// 8-second looping MP4 the cards play instead: it mounts the SAME preview
// component the sidebar uses in a dedicated canvas (bloom pass and all, so
// the glow is baked into the clip), steps its clock deterministically
// (setPreviewTimeOverride + advance, no wall time anywhere), and encodes
// exactly one 16-beat loop - frame 240 lands back on frame 0, so the clip
// loops without a seam.
//
// Driven by `npm run previews:instruments` (scripts/generate-instrument-
// previews.mjs) through the window hooks below, mirroring the template
// pipeline's __capturePreview contract. Only R3F previews are captured: the 2D
// vignettes (get2DPreview) stay live in the sidebar - they are plain canvas
// draws and cost nothing.

// Bump to force every clip to regenerate on the next `npm run
// previews:instruments` (it is the manifest's staleness signal - instrument
// code has no content hash the way template documents do).
export const INSTRUMENT_PREVIEW_CAPTURE_VERSION = 3

// Sized for the sidebar, not the export ladder: cards render at ~100-230 CSS px
// (so ≤~460 device px on HiDPI), and a section expanding mounts a whole column
// of these at once - smaller clips cut both the fetch burst and the decoder
// spin-up that made first loads janky at 640x360.
const CLIP_W = 480
const CLIP_H = 270
const CLIP_FPS = 30
// One full preview loop: LOOP_BEATS (16) at the previews' 120bpm = 8 seconds.
const CLIP_FRAMES = CLIP_FPS * 8
const CLIP_BITRATE = 1_200_000

// What gets a clip: everything the sidebar would render through R3F. Directors
// and the upload/audio/camera instruments are 2D vignettes and stay live.
const CAPTURABLE: InstrumentItem[] = ALL_LIBRARY_ITEMS.filter(
  (item, i, all) =>
    all.findIndex((other) => other.id === item.id) === i &&
    canPreview(item) &&
    !get2DPreview(item.id),
)

declare global {
  interface Window {
    __instrumentPreviewIds?: string[]
    __instrumentPreviewVersion?: string
    __captureInstrumentPreview?: (id: string) => Promise<string | null>
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function blobToBase64(blob: Blob): Promise<string> {
  return blob.arrayBuffer().then((buf) => {
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  })
}

export function InstrumentPreviewCapture() {
  const [item, setItem] = useState<InstrumentItem | null>(null)
  const glRef = useRef<WebGLRenderer | null>(null)

  useEffect(() => {
    window.__instrumentPreviewIds = CAPTURABLE.map((i) => i.id)
    window.__instrumentPreviewVersion = String(INSTRUMENT_PREVIEW_CAPTURE_VERSION)
    window.__captureInstrumentPreview = async (id: string) => {
      const target = CAPTURABLE.find((i) => i.id === id)
      if (!target) return null
      glRef.current = null
      setItem(target)
      try {
        // Wait for the fresh canvas (keyed by item, so each capture starts
        // from untouched preview state). The cast breaks TS's flow narrowing:
        // onCreated fills the ref from outside this function.
        const deadline = Date.now() + 15_000
        let gl = glRef.current as WebGLRenderer | null
        while (!gl) {
          if (Date.now() > deadline) return null
          await sleep(100)
          gl = glRef.current as WebGLRenderer | null
        }

        // Warm-up: step through one full loop with real waits in between, so
        // suspended assets (textures, fonts) resolve and shaders compile
        // before any frame is kept.
        for (let i = 0; i < 16; i++) {
          setPreviewTimeOverride((i * 0.5) % (CLIP_FRAMES / CLIP_FPS))
          advance(performance.now())
          await sleep(100)
        }

        const writer = new Mp4Writer({ width: CLIP_W, height: CLIP_H })
        let error: Error | null = null
        const encoder = new VideoEncoder({
          output: (chunk, meta) => writer.addVideoChunk(chunk, meta),
          error: (e) => { error = e instanceof Error ? e : new Error(String(e)) },
        })
        encoder.configure({
          codec: videoCodec(CLIP_W, CLIP_FPS),
          width: CLIP_W,
          height: CLIP_H,
          framerate: CLIP_FPS,
          latencyMode: 'quality',
          bitrate: CLIP_BITRATE,
        })
        const dequeue = () =>
          new Promise<void>((resolve) => encoder.addEventListener('dequeue', () => resolve(), { once: true }))

        for (let i = 0; i < CLIP_FRAMES && !error; i++) {
          setPreviewTimeOverride(i / CLIP_FPS)
          advance(performance.now())
          const frame = new VideoFrame(gl.domElement, {
            timestamp: Math.round((i * 1e6) / CLIP_FPS),
            duration: Math.round(1e6 / CLIP_FPS),
          })
          encoder.encode(frame, { keyFrame: i % (CLIP_FPS * 2) === 0 })
          frame.close()
          while (encoder.encodeQueueSize > 2) await dequeue()
        }
        if (!error) await encoder.flush()
        if (encoder.state !== 'closed') encoder.close()
        if (error) {
          console.error(`capture failed for ${id}:`, error)
          return null
        }
        return await blobToBase64(writer.finalize())
      } finally {
        setPreviewTimeOverride(null)
        setItem(null)
      }
    }
    return () => {
      delete window.__instrumentPreviewIds
      delete window.__instrumentPreviewVersion
      delete window.__captureInstrumentPreview
    }
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050507] text-[13px] text-neutral-400">
      <p>
        Instrument preview capture - {CAPTURABLE.length} clippable items.
        {item ? ` Capturing: ${item.name}` : ' Idle (driven by npm run previews:instruments).'}
      </p>
      {/* Exact clip pixels: dpr locked to 1 so the drawing buffer IS 640x360.
          preserveDrawingBuffer because VideoFrame reads the canvas across
          awaits (encoder backpressure), after compositing may have cleared it. */}
      <div style={{ width: CLIP_W, height: CLIP_H }} className="border border-neutral-800">
        {item && (
          <Canvas
            key={item.id}
            dpr={1}
            frameloop="never"
            camera={{ position: [0, 0.9, 4.2], fov: 55 }}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            onCreated={(state) => { glRef.current = state.gl }}
          >
            {/* MP4 has no alpha, so the sidebar's --bg-panel is baked in: a
                clip card then matches the live View cards, which render
                transparent over that same panel. Keep in sync with
                globals.css. */}
            <color attach="background" args={['#111318']} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[3, 4, 5]} intensity={1.1} />
            {item.kind === 'object'
              ? <ObjectPreview instrumentId={item.id} />
              : <MoverPreview moverId={item.id} />}
            <LaserPreviewBloom instrumentId={item.kind === 'object' ? item.id : undefined} />
          </Canvas>
        )}
      </div>
    </div>
  )
}
