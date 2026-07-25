import { useEffect, useRef } from 'react'
import { getAudioEngine } from '../core/audio/AudioEngine'
import { getPeaks, BASE_PEAK_BUCKETS } from '../core/audio/waveform'
import { useAudioStore } from '../store/AudioStore'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import type { Track } from '../types'

// The audio identity in this app is blue (see trackColors); on the dark
// panel the timeline's surface colour is far too dark, so the detail screen
// uses the same hue family opened up for a black background.
const TRACE = '#5da9e0'
const TRACE_BRIGHT = '#d6ecfc'
const GRID = 'rgba(93, 169, 224, 0.10)'
const GRID_BAR = 'rgba(93, 169, 224, 0.22)'

/** Seconds of audio shown to the right of the playhead in the scrolling lane. */
const WINDOW_SEC = 8
/** Oscilloscope trace resolution - one sample per ~2 device pixels is plenty. */
const SCOPE_SAMPLES = 512

/** Size a canvas to its CSS box at device resolution. Returns CSS-pixel dims. */
function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number } | null {
  const rect = canvas.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return null
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const pw = Math.round(rect.width * dpr)
  const ph = Math.round(rect.height * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { w: rect.width, h: rect.height }
}

function formatTime(sec: number): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`
}

/**
 * The whole inspector when an audio track is selected: a live oscilloscope on
 * top, and below it the stretch of waveform about to play - the playhead is
 * pinned to the LEFT edge, so the audio scrolls in from the right and drains
 * out at the line. Both halves are canvas; both animate off one rAF loop.
 */
export function AudioTrackDetail({ track }: { track: Track }) {
  const scopeRef = useRef<HTMLCanvasElement>(null)
  const laneRef = useRef<HTMLCanvasElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const audioClips = useAudioStore((s) => s.audioClips)
  const blocks = track.audioBlocks ?? []

  // Peak envelopes for every clip this lane places, kept in a ref so the draw
  // loop reads them without re-rendering. getPeaks is cached and decode-once.
  const peaksRef = useRef(new Map<string, { buckets: number; data: Float32Array }>())
  // Paused frames are skipped, so anything that changes the picture without
  // moving time (peaks landing, a clip moving, a panel resize) asks for one.
  const dirtyRef = useRef(true)
  const refs = [...new Set(blocks.map((b) => b.clipRef))].join(',')
  useEffect(() => {
    let cancelled = false
    for (const ref of refs ? refs.split(',') : []) {
      // The lane is wide relative to the slice it shows, so ask for a finer
      // envelope than the timeline block's - transients stay transients.
      getPeaks(ref, BASE_PEAK_BUCKETS * 4)
        .then((entry) => {
          if (cancelled) return
          peaksRef.current.set(ref, entry)
          dirtyRef.current = true
        })
        .catch((err) => console.warn('Audio detail peaks failed', err))
    }
    return () => { cancelled = true }
  }, [refs])

  // Blocks are read from a ref inside the loop so moving/trimming a clip shows
  // up immediately without restarting the animation.
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const clipsRef = useRef(audioClips)
  clipsRef.current = audioClips
  useEffect(() => { dirtyRef.current = true })

  useEffect(() => {
    let frame = 0
    let lastBeat = Number.NaN

    const drawScope = (beat: number) => {
      const canvas = scopeRef.current
      if (!canvas) return
      const size = fitCanvas(canvas)
      const ctx = canvas.getContext('2d')
      if (!size || !ctx) return
      const { w, h } = size
      const mid = h / 2
      ctx.clearRect(0, 0, w, h)

      // Graticule: a centre line plus quiet thirds, so amplitude reads even
      // when the trace is a flat line.
      ctx.lineWidth = 1
      for (const frac of [0.5, 0.25, 0.75, 0.125, 0.875]) {
        ctx.strokeStyle = frac === 0.5 ? GRID_BAR : GRID
        ctx.beginPath()
        ctx.moveTo(0, Math.round(h * frac) + 0.5)
        ctx.lineTo(w, Math.round(h * frac) + 0.5)
        ctx.stroke()
      }

      const { bpm, beatsPerBar } = useProjectStore.getState()
      const samples = getAudioEngine().getWaveformAtBeat(beat, bpm, beatsPerBar, SCOPE_SAMPLES, track.id)
      const amp = mid * 0.82
      const xAt = (i: number) => (i / (samples.length - 1)) * w
      const yAt = (i: number) => mid - Math.max(-1, Math.min(1, samples[i])) * amp

      // Soft body under the trace, then the trace itself with a bloom - the
      // glow is what makes it read as a screen rather than a chart.
      const body = ctx.createLinearGradient(0, 0, 0, h)
      body.addColorStop(0, 'rgba(251, 113, 133, 0.00)')
      body.addColorStop(0.5, 'rgba(251, 113, 133, 0.20)')
      body.addColorStop(1, 'rgba(251, 113, 133, 0.00)')
      ctx.beginPath()
      ctx.moveTo(0, mid)
      for (let i = 0; i < samples.length; i++) ctx.lineTo(xAt(i), yAt(i))
      ctx.lineTo(w, mid)
      ctx.closePath()
      ctx.fillStyle = body
      ctx.fill()

      ctx.beginPath()
      for (let i = 0; i < samples.length; i++) {
        const x = xAt(i)
        const y = yAt(i)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = TRACE
      ctx.shadowBlur = 14
      ctx.strokeStyle = TRACE
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.shadowBlur = 6
      ctx.strokeStyle = TRACE_BRIGHT
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    const drawLane = (beat: number) => {
      const canvas = laneRef.current
      if (!canvas) return
      const size = fitCanvas(canvas)
      const ctx = canvas.getContext('2d')
      if (!size || !ctx) return
      const { w, h } = size
      const mid = h / 2
      ctx.clearRect(0, 0, w, h)

      const { bpm, beatsPerBar } = useProjectStore.getState()
      const secPerBeat = 60 / Math.max(1, bpm)
      const now = beat * secPerBeat
      const pxPerSec = w / WINDOW_SEC

      // Beat grid, drawn in time so it slides with the audio: bars carry the
      // accent, beats stay a whisper.
      ctx.lineWidth = 1
      const firstBeat = Math.ceil(beat)
      for (let b = firstBeat; (b - beat) * secPerBeat < WINDOW_SEC; b++) {
        const x = Math.round((b - beat) * secPerBeat * pxPerSec) + 0.5
        const isBar = b % Math.max(1, beatsPerBar) === 0
        ctx.strokeStyle = isBar ? GRID_BAR : GRID
        ctx.beginPath()
        ctx.moveTo(x, isBar ? 0 : h * 0.22)
        ctx.lineTo(x, isBar ? h : h * 0.78)
        ctx.stroke()
      }

      // Waveform: for each column, find the block sounding at that instant and
      // read its peak envelope. Columns with no clip simply stay empty.
      const spans = blocksRef.current.map((b) => {
        const clip = clipsRef.current[b.clipRef]
        const startSec = b.startBar * beatsPerBar * secPerBeat
        return { block: b, clip, startSec, endSec: startSec + Math.max(0, b.trimEnd - b.trimStart) }
      })
      const fill = ctx.createLinearGradient(0, 0, w, 0)
      fill.addColorStop(0, TRACE_BRIGHT)
      fill.addColorStop(0.08, TRACE)
      fill.addColorStop(1, 'rgba(251, 113, 133, 0.55)')
      ctx.fillStyle = fill
      ctx.shadowColor = 'rgba(251, 113, 133, 0.45)'
      ctx.shadowBlur = 8
      for (let x = 0; x < w; x++) {
        const t = now + (x / w) * WINDOW_SEC
        const span = spans.find((s) => t >= s.startSec && t < s.endSec && s.clip)
        if (!span || !span.clip) continue
        const entry = peaksRef.current.get(span.block.clipRef)
        if (!entry) continue
        const clipT = span.block.trimStart + (t - span.startSec)
        const frac = span.clip.duration > 0 ? clipT / span.clip.duration : 0
        const bi = Math.min(entry.buckets - 1, Math.max(0, Math.floor(frac * entry.buckets)))
        const min = entry.data[bi * 2]
        const max = entry.data[bi * 2 + 1]
        const top = mid - max * mid * 0.9
        const height = Math.max(1, (max - min) * mid * 0.9)
        ctx.fillRect(x, top, 1, height)
      }
      ctx.shadowBlur = 0

      // Fade the incoming edge so the window doesn't end in a hard cut.
      const fade = ctx.createLinearGradient(w * 0.82, 0, w, 0)
      fade.addColorStop(0, 'rgba(13, 13, 13, 0)')
      fade.addColorStop(1, 'rgba(13, 13, 13, 1)')
      ctx.fillStyle = fade
      ctx.fillRect(w * 0.82, 0, w * 0.18, h)

      // The playhead: everything passes through this line, at the left edge.
      ctx.shadowColor = TRACE_BRIGHT
      ctx.shadowBlur = 12
      ctx.strokeStyle = TRACE_BRIGHT
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(1, 0)
      ctx.lineTo(1, h)
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.fillStyle = TRACE_BRIGHT
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(9, 0)
      ctx.lineTo(0, 9)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(0, h)
      ctx.lineTo(9, h)
      ctx.lineTo(0, h - 9)
      ctx.closePath()
      ctx.fill()
    }

    const loop = () => {
      frame = requestAnimationFrame(loop)
      const { currentBeat, isPlaying } = useTimeStore.getState()
      // Idle and parked with nothing new to show: skip the repaint entirely.
      if (!isPlaying && currentBeat === lastBeat && !dirtyRef.current) return
      lastBeat = currentBeat
      dirtyRef.current = false
      drawScope(currentBeat)
      drawLane(currentBeat)
      if (readoutRef.current) {
        const secPerBeat = 60 / Math.max(1, useProjectStore.getState().bpm)
        readoutRef.current.textContent = formatTime(currentBeat * secPerBeat)
      }
    }
    loop()

    // A panel resize changes the canvas box without moving time - force the
    // next frame to repaint.
    const onResize = () => { dirtyRef.current = true }
    window.addEventListener('resize', onResize)
    const observer = new ResizeObserver(onResize)
    if (scopeRef.current) observer.observe(scopeRef.current)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      observer.disconnect()
    }
  }, [track.id])

  // The track is usually named after its only clip - say it once.
  const clipNames = [...new Set(blocks.map((b) => audioClips[b.clipRef]?.fileName).filter(Boolean))]
    .filter((name) => name !== track.name)

  return (
    <div className="relative flex h-full flex-col bg-[var(--bg-app)] overflow-hidden">
      {/* A wash of the track's own colour behind both halves ties the screen to
          the rose audio identity without tinting the waveform itself. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(120% 80% at 50% 0%, rgba(161, 78, 96, 0.18), transparent 70%)' }}
      />

      {/* Top half - oscilloscope */}
      <div className="relative min-h-0 flex-1">
        <canvas ref={scopeRef} className="absolute inset-0 h-full w-full" />
        <div className="pointer-events-none absolute left-3 top-2.5 flex items-baseline gap-2">
          <span className="text-[10px] font-semibold tracking-[0.16em] text-[rgba(251,113,133,0.75)] select-none">
            {track.name.toUpperCase()}
          </span>
          {clipNames.length > 0 && (
            <span className="max-w-[180px] truncate text-[10px] text-[var(--text-muted)] select-none">
              {clipNames.join(' · ')}
            </span>
          )}
        </div>
      </div>

      <div className="relative h-px flex-shrink-0 bg-[linear-gradient(90deg,transparent,rgba(251,113,133,0.45),transparent)]" />

      {/* Bottom half - the waveform scrolling through the playhead */}
      <div className="relative min-h-0 flex-1">
        <canvas ref={laneRef} className="absolute inset-0 h-full w-full" />
        <span
          ref={readoutRef}
          className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] tabular-nums text-[rgba(251,113,133,0.7)] select-none"
        >
          0:00.00
        </span>
        {blocks.length === 0 && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-[var(--text-muted)]">
            Drop an audio file on this track
          </span>
        )}
      </div>
    </div>
  )
}
