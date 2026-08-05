import { useEffect, useRef } from 'react'
import { getAudioEngine } from '../core/audio/AudioEngine'
import { getPeaks, BASE_PEAK_BUCKETS } from '../core/audio/waveform'
import { useAudioStore } from '../store/AudioStore'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { AUDIO_WAVEFORM_COLOR } from '../utils/trackColors'
import type { Track } from '../types'

// One hue on this screen: the app's audio identity (see trackColors). Text
// and grid are quiet tints of it; the playhead is the timeline's white line.
const TRACE = AUDIO_WAVEFORM_COLOR
const GRID = 'rgba(127, 192, 238, 0.12)'
const LABEL = 'rgba(127, 192, 238, 0.65)'
const PLAYHEAD = 'rgba(255, 255, 255, 0.6)'

/** Wheel-zoomable width of the scrolling lane, in seconds of audio. */
const WINDOW_DEFAULT_SEC = 8
const WINDOW_MIN_SEC = 2
const WINDOW_MAX_SEC = 32
/** Ceiling on lazily-upgraded peak resolution (~2 MB of Float32 per clip). */
const MAX_PEAK_BUCKETS = 1 << 18
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
 * out at the line. Wheel over the lane zooms the window; click seeks to that
 * moment. Both halves are canvas; both animate off one rAF loop.
 */
export function AudioTrackDetail({ track }: { track: Track }) {
  const scopeRef = useRef<HTMLCanvasElement>(null)
  const laneRef = useRef<HTMLCanvasElement>(null)
  const readoutRef = useRef<HTMLSpanElement>(null)
  const zoomHintRef = useRef<HTMLSpanElement>(null)
  const audioClips = useAudioStore((s) => s.audioClips)
  const blocks = track.audioBlocks ?? []

  // Peak envelopes for every clip this lane places, kept in a ref so the draw
  // loop reads them without re-rendering. getPeaks is cached and decode-once.
  const peaksRef = useRef(new Map<string, { buckets: number; data: Float32Array }>())
  // Paused frames are skipped, so anything that changes the picture without
  // moving time (peaks landing, a clip moving, a zoom, a resize) asks for one.
  const dirtyRef = useRef(true)
  const windowSecRef = useRef(WINDOW_DEFAULT_SEC)
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
    let stopped = false

    // Finer envelopes requested by the draw loop as zoom and width demand
    // them - one bucket per pixel column at the current window. Targets are
    // quantized to powers of two so a zoom gesture escalates a few times, not
    // once per notch; getPeaks reuses any finer cached array, and re-extraction
    // is an array pass over the decoded buffer, never a re-decode.
    const requestedPeaks = new Map<string, number>()
    const ensurePeaks = (ref: string, want: number) => {
      const target = Math.min(MAX_PEAK_BUCKETS, 2 ** Math.ceil(Math.log2(Math.max(1, want))))
      const have = peaksRef.current.get(ref)?.buckets ?? 0
      if (have >= target || (requestedPeaks.get(ref) ?? 0) >= target) return
      requestedPeaks.set(ref, target)
      getPeaks(ref, target)
        .then((entry) => {
          if (stopped) return
          peaksRef.current.set(ref, entry)
          dirtyRef.current = true
        })
        .catch((err) => console.warn('Audio detail peaks failed', err))
    }

    const drawScope = (beat: number) => {
      const canvas = scopeRef.current
      if (!canvas) return
      const size = fitCanvas(canvas)
      const ctx = canvas.getContext('2d')
      if (!size || !ctx) return
      const { w, h } = size
      const mid = h / 2
      ctx.clearRect(0, 0, w, h)

      // A single centre line - the zero the trace rests on.
      ctx.lineWidth = 1
      ctx.strokeStyle = GRID
      ctx.beginPath()
      ctx.moveTo(0, Math.round(mid) + 0.5)
      ctx.lineTo(w, Math.round(mid) + 0.5)
      ctx.stroke()

      const { bpm, beatsPerBar } = useProjectStore.getState()
      const samples = getAudioEngine().getWaveformAtBeat(beat, bpm, beatsPerBar, SCOPE_SAMPLES, track.id)
      const amp = mid * 0.82

      // The one glow on this screen: a single bloomed pass of the trace, which
      // is what makes it read as a screen rather than a chart.
      ctx.beginPath()
      for (let i = 0; i < samples.length; i++) {
        const x = (i / (samples.length - 1)) * w
        const y = mid - Math.max(-1, Math.min(1, samples[i])) * amp
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = TRACE
      ctx.shadowBlur = 12
      ctx.strokeStyle = TRACE
      ctx.lineWidth = 1.5
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
      const windowSec = windowSecRef.current
      const pxPerSec = w / windowSec

      // Bar lines only, drawn in time so they slide with the audio. The
      // timeline below already carries the finer rhythm.
      ctx.lineWidth = 1
      ctx.strokeStyle = GRID
      const barBeats = Math.max(1, beatsPerBar)
      for (let b = Math.ceil(beat / barBeats) * barBeats; (b - beat) * secPerBeat < windowSec; b += barBeats) {
        const x = Math.round((b - beat) * secPerBeat * pxPerSec) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      // Waveform: for each column, find the block sounding at that instant and
      // read its peak envelope. Columns with no clip simply stay empty.
      const spans = blocksRef.current.map((b) => {
        const clip = clipsRef.current[b.clipRef]
        const startSec = b.startBar * beatsPerBar * secPerBeat
        return { block: b, clip, startSec, endSec: startSec + Math.max(0, b.trimEnd - b.trimStart) }
      })
      for (const s of spans) {
        if (s.clip && s.clip.duration > 0) ensurePeaks(s.block.clipRef, (s.clip.duration / windowSec) * w)
      }
      ctx.fillStyle = TRACE
      for (let x = 0; x < w; x++) {
        const t = now + (x / w) * windowSec
        const span = spans.find((s) => t >= s.startSec && t < s.endSec && s.clip)
        if (!span || !span.clip) continue
        const entry = peaksRef.current.get(span.block.clipRef)
        if (!entry) continue
        if (span.clip.duration <= 0) continue
        // A column can span many buckets once the envelope is finer than the
        // view - aggregate the whole range so no transient falls between reads.
        const clipT = span.block.trimStart + (t - span.startSec)
        const fracA = clipT / span.clip.duration
        const fracB = (clipT + windowSec / w) / span.clip.duration
        const b0 = Math.min(entry.buckets - 1, Math.max(0, Math.floor(fracA * entry.buckets)))
        const b1 = Math.min(entry.buckets, Math.max(b0 + 1, Math.ceil(fracB * entry.buckets)))
        let min = 1
        let max = -1
        for (let bi = b0; bi < b1; bi++) {
          if (entry.data[bi * 2] < min) min = entry.data[bi * 2]
          if (entry.data[bi * 2 + 1] > max) max = entry.data[bi * 2 + 1]
        }
        const top = mid - max * mid * 0.9
        const height = Math.max(1, (max - min) * mid * 0.9)
        ctx.fillRect(x, top, 1, height)
      }

      // The playhead everything passes through: the timeline's own white line.
      ctx.fillStyle = PLAYHEAD
      ctx.fillRect(0, 0, 1, h)
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

    // Wheel over the lane zooms the window; the playhead edge is the anchor.
    // The hint names the new width, then gets out of the way.
    let hintTimer: ReturnType<typeof setTimeout> | null = null
    const lane = laneRef.current
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const next = windowSecRef.current * Math.exp(e.deltaY * 0.002)
      windowSecRef.current = Math.min(WINDOW_MAX_SEC, Math.max(WINDOW_MIN_SEC, next))
      dirtyRef.current = true
      const hint = zoomHintRef.current
      if (hint) {
        hint.textContent = `${windowSecRef.current.toFixed(windowSecRef.current < 10 ? 1 : 0)} s`
        hint.style.opacity = '1'
        if (hintTimer) clearTimeout(hintTimer)
        hintTimer = setTimeout(() => { hint.style.opacity = '0' }, 700)
      }
    }
    lane?.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
      observer.disconnect()
      lane?.removeEventListener('wheel', onWheel)
      if (hintTimer) clearTimeout(hintTimer)
    }
  }, [track.id])

  // Click in the lane seeks: the clicked moment comes to the playhead line.
  const seekToLaneX = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width < 1) return
    const { bpm } = useProjectStore.getState()
    const beatsAhead = ((e.clientX - rect.left) / rect.width) * windowSecRef.current / (60 / Math.max(1, bpm))
    useTimeStore.getState().setCurrentBeat(useTimeStore.getState().currentBeat + beatsAhead)
  }

  // The track is usually named after its only clip - say it once.
  const clipNames = [...new Set(blocks.map((b) => audioClips[b.clipRef]?.fileName).filter(Boolean))]
    .filter((name) => name !== track.name)

  return (
    <div className="flex h-full flex-col bg-[var(--bg-app)] overflow-hidden">
      {/* Top half - oscilloscope */}
      <div className="relative min-h-0 flex-1">
        <canvas ref={scopeRef} className="absolute inset-0 h-full w-full" />
        <div className="pointer-events-none absolute left-3 top-2.5 flex items-baseline gap-2">
          <span className="text-[10px] font-semibold tracking-[0.16em] select-none" style={{ color: LABEL }}>
            {track.name.toUpperCase()}
          </span>
          {clipNames.length > 0 && (
            <span className="max-w-[180px] truncate text-[10px] text-[var(--text-muted)] select-none">
              {clipNames.join(' · ')}
            </span>
          )}
        </div>
      </div>

      <div className="h-px flex-shrink-0 bg-[var(--border)]" />

      {/* Bottom half - the waveform scrolling through the playhead */}
      <div className="relative min-h-0 flex-1">
        <canvas ref={laneRef} className="absolute inset-0 h-full w-full cursor-crosshair" onClick={seekToLaneX} />
        <span
          ref={zoomHintRef}
          className="pointer-events-none absolute right-3 top-2.5 font-mono text-[10px] tabular-nums opacity-0 transition-opacity duration-300 select-none"
          style={{ color: LABEL }}
        />
        <span
          ref={readoutRef}
          className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] tabular-nums select-none"
          style={{ color: LABEL }}
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
