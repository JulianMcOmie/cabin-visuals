import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useAudioStore } from '../../store/AudioStore'
import { getPeaks, BASE_PEAK_BUCKETS } from '../../core/audio/waveform'
import type { AudioBlock as AudioBlockType } from '../../types'

interface AudioBlockProps {
  block: AudioBlockType
  trackId: string
  barWidthPx: number
  beatsPerBar: number
  color: string
}

/**
 * The audio analogue of the MIDI Block: positioned at startBar · barWidthPx,
 * but its WIDTH is derived — (trimEnd − trimStart) seconds at the current
 * tempo — so a bpm change resizes it on the spot (audio is never resampled;
 * it just takes more or fewer beats). Dragging writes startBar (snapped to
 * the beat grid); the audio engine reschedules via the store subscription.
 */
export function AudioBlock({ block, trackId, barWidthPx, beatsPerBar, color }: AudioBlockProps) {
  // Width follows tempo reactively — this subscription is the feature.
  const bpm = useProjectStore((s) => s.bpm)
  const clip = useAudioStore((s) => s.audioClips[block.clipRef])

  const clipSec = Math.max(0, block.trimEnd - block.trimStart)
  const widthBars = (clipSec * bpm) / 60 / beatsPerBar
  const left = block.startBar * barWidthPx
  const width = Math.max(widthBars * barWidthPx, 4)

  // ── Waveform: draw the [trimStart, trimEnd] slice of the clip's peak envelope ──
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas || !clip) return
    // Adaptive resolution: ask for more buckets when drawn wider than the base
    // serves (deep zoom) — a re-extraction from the cached buffer, not a decode.
    const visibleFrac = clip.duration > 0 ? clipSec / clip.duration : 1
    const needed = Math.max(BASE_PEAK_BUCKETS, Math.ceil(width / 2 / Math.max(visibleFrac, 1e-6)))
    getPeaks(block.clipRef, Math.min(needed, 20000)).then(({ buckets, data }) => {
      if (cancelled || !canvasRef.current) return
      const c = canvasRef.current
      const rect = c.getBoundingClientRect()
      c.width = Math.max(1, Math.round(rect.width))
      c.height = Math.max(1, Math.round(rect.height))
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.fillStyle = color + 'aa'
      const mid = c.height / 2
      const startFrac = clip.duration > 0 ? block.trimStart / clip.duration : 0
      const endFrac = clip.duration > 0 ? block.trimEnd / clip.duration : 1
      for (let x = 0; x < c.width; x++) {
        const frac = startFrac + (endFrac - startFrac) * (x / c.width)
        const bi = Math.min(buckets - 1, Math.max(0, Math.floor(frac * buckets)))
        const min = data[bi * 2]
        const max = data[bi * 2 + 1]
        const y = mid - max * mid
        const h = Math.max(1, (max - min) * mid)
        ctx.fillRect(x, y, 1, h)
      }
    }).catch((err) => console.warn('Waveform draw failed', err))
    return () => { cancelled = true }
  }, [block.clipRef, block.trimStart, block.trimEnd, clip, clipSec, width, color])

  // ── Drag gestures: move (body), trim (edges) — all snapped to the beat grid ──
  // Right edge → trimEnd only. Left edge → trimStart AND startBar together, so
  // the audio you keep stays aligned to its original beats (classic DAW left-trim).
  type DragMode = 'move' | 'trim-l' | 'trim-r'
  const dragRef = useRef<{
    mode: DragMode
    startX: number
    orig: { startBar: number; trimStart: number; trimEnd: number }
  } | null>(null)

  const MIN_CLIP_SEC = 0.05
  const secPerBar = (60 / bpm) * beatsPerBar
  const snapBars = (bars: number) => Math.round(bars * beatsPerBar) / beatsPerBar

  const edgeZone = (e: ReactPointerEvent<HTMLDivElement>): DragMode => {
    const rect = e.currentTarget.getBoundingClientRect()
    const edge = Math.min(8, rect.width / 4)
    const localX = e.clientX - rect.left
    if (localX < edge) return 'trim-l'
    if (localX > rect.width - edge) return 'trim-r'
    return 'move'
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation() // the lane underneath must not treat this as a lane gesture
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
    dragRef.current = {
      mode: edgeZone(e),
      startX: e.clientX,
      orig: { startBar: block.startBar, trimStart: block.trimStart, trimEnd: block.trimEnd },
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) {
      // Hover cursor feedback: resize at the edges, grab in the body.
      const mode = edgeZone(e)
      e.currentTarget.style.cursor = mode === 'move' ? 'grab' : 'ew-resize'
      return
    }
    const { mode, startX, orig } = drag
    const deltaBars = snapBars((e.clientX - startX) / barWidthPx)

    if (mode === 'move') {
      const startBar = Math.max(0, snapBars(orig.startBar + deltaBars))
      if (startBar !== block.startBar) {
        useProjectStore.getState().updateAudioBlock(trackId, block.id, { startBar })
      }
      return
    }

    if (mode === 'trim-r') {
      // The right edge moves in bars; trimEnd follows in seconds at current tempo.
      const deltaSec = deltaBars * secPerBar
      const trimEnd = Math.min(
        clip?.duration ?? orig.trimEnd,
        Math.max(orig.trimStart + MIN_CLIP_SEC, orig.trimEnd + deltaSec),
      )
      if (trimEnd !== block.trimEnd) {
        useProjectStore.getState().updateAudioBlock(trackId, block.id, { trimEnd })
      }
      return
    }

    // trim-l: clamp the applied delta in seconds, then move start + trim together.
    const wantedSec = deltaBars * secPerBar
    const appliedSec = Math.min(
      orig.trimEnd - MIN_CLIP_SEC - orig.trimStart, // can't trim past the end
      Math.max(-orig.trimStart, wantedSec), // can't reveal audio before the clip starts
    )
    const startBar = Math.max(0, orig.startBar + appliedSec / secPerBar)
    const trimStart = orig.trimStart + appliedSec
    if (startBar !== block.startBar || trimStart !== block.trimStart) {
      useProjectStore.getState().updateAudioBlock(trackId, block.id, { startBar, trimStart })
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
    }
    dragRef.current = null
  }

  return (
    <div
      data-audio-block-id={block.id}
      title={clip ? `${clip.fileName} — drag to move` : 'Audio block'}
      className="absolute top-1 bottom-1 rounded overflow-hidden"
      style={{
        left: `${left}px`,
        width: `${width}px`,
        backgroundColor: color + '22',
        border: `1px solid ${color}66`,
        borderLeft: `2px solid ${color}`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      <span className="absolute top-0.5 left-1.5 text-[10px] text-white/70 pointer-events-none truncate max-w-full pr-2">
        {clip?.fileName}
      </span>
    </div>
  )
}
