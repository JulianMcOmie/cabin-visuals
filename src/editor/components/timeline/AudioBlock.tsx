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

  // ── Drag to move: self-contained pointer gesture writing startBar ──
  const dragRef = useRef<{ startX: number; origStartBar: number } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation() // the lane underneath must not treat this as a lane gesture
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
    dragRef.current = { startX: e.clientX, origStartBar: block.startBar }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const deltaBars = (e.clientX - drag.startX) / barWidthPx
    // Snap to the beat grid, clamped to the timeline start.
    const raw = drag.origStartBar + deltaBars
    const snapped = Math.max(0, Math.round(raw * beatsPerBar) / beatsPerBar)
    if (snapped !== block.startBar) {
      useProjectStore.getState().updateAudioBlock(trackId, block.id, { startBar: snapped })
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
      className="absolute top-1 bottom-1 rounded overflow-hidden cursor-grab active:cursor-grabbing"
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
