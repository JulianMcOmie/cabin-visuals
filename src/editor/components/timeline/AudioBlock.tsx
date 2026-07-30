import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useAudioStore } from '../../store/AudioStore'
import { useUIStore } from '../../store/UIStore'
import { selectNewBlock } from '../../utils/selection'
import { retryAudioTrackUpload } from '../../utils/loadAudioTrack'
import { getPlaybackEngine } from '../../core/playback'
import { getPeaks, BASE_PEAK_BUCKETS } from '../../core/audio/waveform'
import { AUDIO_WAVEFORM_COLOR } from '../../utils/trackColors'
import { AudioTrackOscilloscope } from './AudioTrackOscilloscope'
import { beginAudioSyncDrag, moveAudioSyncDrag, endAudioSyncDrag } from './audioSyncDrag'
import type { AudioBlock as AudioBlockType } from '../../types'

interface AudioBlockProps {
  block: AudioBlockType
  trackId: string
  barWidthPx: number
  beatsPerBar: number
  color: string
  /** Replace the static waveform with the live track oscilloscope. */
  showOscilloscope?: boolean
}

/**
 * The audio analogue of the MIDI Block: positioned at startBar · barWidthPx,
 * but its WIDTH is derived - (trimEnd − trimStart) seconds at the current
 * tempo - so a bpm change resizes it on the spot (audio is never resampled;
 * it just takes more or fewer beats). Dragging writes startBar freely (no
 * grid snap); the audio engine reschedules via the store subscription.
 *
 * A MOVE drag is the sync gesture: playback keeps sounding, looping a short
 * section (see audioSyncDrag.ts), the oscilloscope stands down, and the
 * waveform redraws at transient resolution. startBar may go NEGATIVE - audio
 * dragged left of bar 0 lives in the pickup (the timeline shifts to keep it
 * flush with the left edge; the lane wrapper in Track.tsx applies the offset).
 */
export function AudioBlock({ block, trackId, barWidthPx, beatsPerBar, color, showOscilloscope = false }: AudioBlockProps) {
  // Width follows tempo reactively - this subscription is the feature.
  const bpm = useProjectStore((s) => s.bpm)
  const clip = useAudioStore((s) => s.audioClips[block.clipRef])
  const upload = useAudioStore((s) => s.uploads[block.clipRef])
  const isSelected = useUIStore((s) => s.selectedBlockIds.has(block.id))
  const isSyncSource = useUIStore((s) => s.audioSyncDrag?.blockId === block.id)

  const clipSec = Math.max(0, block.trimEnd - block.trimStart)
  // A zero-length block is a clip whose local decode hasn't landed yet (the
  // load pipeline fills in trimEnd when it knows the duration): render a
  // fixed-width loading placeholder instead of a sliver.
  const pending = clipSec <= 0
  const widthBars = (clipSec * bpm) / 60 / beatsPerBar
  const left = block.startBar * barWidthPx
  const width = pending ? barWidthPx * 2 : Math.max(widthBars * barWidthPx, 4)

  // ── Waveform: draw the [trimStart, trimEnd] slice of the clip's peak envelope ──
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    // While pending, getPeaks would race the load pipeline's own decode of the
    // same bytes for nothing - the effect re-runs when the duration lands.
    if (!canvas || !clip || pending) return
    // Adaptive resolution: ask for more buckets when drawn wider than the base
    // serves (deep zoom) - a re-extraction from the cached buffer, not a decode.
    // During a sync drag the block is the surface being aligned by eye, so it
    // renders at device-pixel density with ~2 buckets per pixel - enough to
    // resolve individual transients.
    const dpr = isSyncSource ? Math.max(1, window.devicePixelRatio || 1) : 1
    const bucketsPerPx = isSyncSource ? 2 : 0.5
    const visibleFrac = clip.duration > 0 ? clipSec / clip.duration : 1
    const needed = Math.max(BASE_PEAK_BUCKETS, Math.ceil((width * dpr * bucketsPerPx) / Math.max(visibleFrac, 1e-6)))
    getPeaks(block.clipRef, Math.min(needed, 20000)).then(({ buckets, data }) => {
      if (cancelled || !canvasRef.current) return
      const c = canvasRef.current
      const rect = c.getBoundingClientRect()
      c.width = Math.max(1, Math.round(rect.width * dpr))
      c.height = Math.max(1, Math.round(rect.height * dpr))
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, c.width, c.height)
      // The clip colour is the solid surface; the waveform is a separate,
      // fully opaque ink. Keeping the hues related makes the contrast feel
      // intentional without falling back to a translucent wash.
      ctx.fillStyle = AUDIO_WAVEFORM_COLOR
      const mid = c.height / 2
      const startFrac = clip.duration > 0 ? block.trimStart / clip.duration : 0
      const endFrac = clip.duration > 0 ? block.trimEnd / clip.duration : 1
      for (let x = 0; x < c.width; x++) {
        // Aggregate every bucket the pixel spans (not just the first), so a
        // transient never falls between sample points at low zoom.
        const fracA = startFrac + (endFrac - startFrac) * (x / c.width)
        const fracB = startFrac + (endFrac - startFrac) * ((x + 1) / c.width)
        const b0 = Math.min(buckets - 1, Math.max(0, Math.floor(fracA * buckets)))
        const b1 = Math.min(buckets - 1, Math.max(b0, Math.ceil(fracB * buckets) - 1))
        let min = 1
        let max = -1
        for (let bi = b0; bi <= b1; bi++) {
          if (data[bi * 2] < min) min = data[bi * 2]
          if (data[bi * 2 + 1] > max) max = data[bi * 2 + 1]
        }
        const y = mid - max * mid
        const h = Math.max(1, (max - min) * mid)
        ctx.fillRect(x, y, 1, h)
      }
    }).catch((err) => console.warn('Waveform draw failed', err))
    return () => { cancelled = true }
  }, [block.clipRef, block.trimStart, block.trimEnd, clip, clipSec, width, color, pending, isSyncSource])

  // ── Drag gestures: move (body), trim (edges) - free positioning, no snap ──
  // Right edge → trimEnd only. Left edge → trimStart AND startBar together, so
  // the audio you keep stays aligned to its original beats (classic DAW left-trim).
  type DragMode = 'move' | 'trim-l' | 'trim-r'
  const dragRef = useRef<{
    mode: DragMode
    startX: number
    orig: { startBar: number; trimStart: number; trimEnd: number }
    /** Whether this gesture has begun its transport bracket (sync or silence). */
    engaged: boolean
  } | null>(null)

  // Close whichever transport bracket the gesture opened. A move drag runs the
  // AUDIBLE sync mode; trims keep the classic silent bracket (their per-move
  // writes reshape the sounding clip itself, where looping mid-trim just stutters).
  const releaseDragBracket = (mode: DragMode) => {
    if (mode === 'move') endAudioSyncDrag()
    else getPlaybackEngine().endBlockDrag()
  }

  // A block unmounted mid-drag (deleted, track removed) never sees pointerup, so
  // the bracket would never be lifted - audio would stop tracking edits until the
  // next play. Release it here.
  useEffect(() => () => {
    const drag = dragRef.current
    if (drag?.engaged) releaseDragBracket(drag.mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const MIN_CLIP_SEC = 0.05
  const secPerBar = (60 / bpm) * beatsPerBar

  const edgeZone = (e: ReactPointerEvent<HTMLDivElement>): DragMode => {
    if (pending) return 'move' // nothing meaningful to trim until the duration lands
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

    // Same selection semantics as MIDI blocks: shift toggles; a plain click on an
    // unselected block makes it the only selected block (track selection stays);
    // clicking an already-selected block keeps the selection.
    // preventDefault keeps the shift-click from extending the browser's DOM
    // text selection across the app.
    const ui = useUIStore.getState()
    if (e.shiftKey) {
      e.preventDefault()
      const next = new Set(ui.selectedBlockIds)
      if (next.has(block.id)) next.delete(block.id)
      else next.add(block.id)
      ui.setSelectedBlockIds(next)
      return
    }
    if (!ui.selectedBlockIds.has(block.id)) selectNewBlock(block.id)

    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
    dragRef.current = {
      mode: edgeZone(e),
      startX: e.clientX,
      orig: { startBar: block.startBar, trimStart: block.trimStart, trimEnd: block.trimEnd },
      engaged: false,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) {
      // Edge-only cursor feedback (matches the MIDI Block): resize at the trim
      // edges, default everywhere else. During a trim drag the ew-resize set
      // here persists; during a move the cursor stays default.
      const mode = edgeZone(e)
      e.currentTarget.style.cursor = mode === 'move' ? 'default' : 'ew-resize'
      return
    }
    // Audio deliberately moves/trims FREELY (no grid snap) - real audio rarely
    // lands on a beat. MIDI blocks keep their snapping (useTrackGestures).
    const { mode, startX, orig } = drag
    const deltaBars = (e.clientX - startX) / barWidthPx

    // Every mode here rewrites the block on each move, and the store
    // subscription answers each write with a full re-arm: those clip starts
    // would stack into a runaway gain sum at pointermove rates. A MOVE enters
    // the audible sync mode (looped playback, bounded re-arms); trims mute for
    // the gesture as before. Done on the first MOVE, not on pointerdown, so a
    // plain click on a block doesn't punch a hole in the audio.
    if (!drag.engaged) {
      drag.engaged = true
      if (mode === 'move') beginAudioSyncDrag(trackId, block.id)
      else getPlaybackEngine().beginBlockDrag()
    }

    if (mode === 'move') {
      // No lower clamp: audio may start BEFORE bar 0 (the pickup). The timeline
      // grows a lead-in region so the clip stays flush with the left edge.
      const startBar = orig.startBar + deltaBars
      if (startBar !== block.startBar) {
        useProjectStore.getState().updateAudioBlock(trackId, block.id, { startBar })
      }
      moveAudioSyncDrag()
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
    const startBar = orig.startBar + appliedSec / secPerBar
    const trimStart = orig.trimStart + appliedSec
    if (startBar !== block.startBar || trimStart !== block.trimStart) {
      useProjectStore.getState().updateAudioBlock(trackId, block.id, { startBar, trimStart })
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag) {
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
      if (drag.engaged) releaseDragBracket(drag.mode)
    }
    dragRef.current = null
  }

  // The sync drag is the one moment the STATIC waveform matters most: the live
  // oscilloscope (playback view) stands down so transients hold still under the
  // pointer while the loop keeps sounding.
  const showStaticWaveform = !showOscilloscope || isSyncSource

  return (
    <div
      data-audio-block-id={block.id}
      title={clip ? `${clip.fileName} - drag to move (loops playback while you drag)` : 'Audio block'}
      className="absolute top-0 bottom-0 rounded-[3px] overflow-hidden"
      style={{
        left: `${left}px`,
        width: `${width}px`,
        backgroundColor: color,
        borderTop: isSelected ? '1px solid #a9d6f5' : '1px solid #3f77b3',
        borderRight: isSelected ? '1px solid #a9d6f5' : '1px solid #3f77b3',
        borderBottom: isSelected ? '1px solid #a9d6f5' : '1px solid #3f77b3',
        borderLeft: isSelected ? '1px solid #a9d6f5' : '1px solid #3f77b3',
        boxShadow: isSyncSource
          ? '0 0 0 1px #e8f4fc, 0 0 12px rgba(53, 167, 230, 0.55)'
          : isSelected
            ? '0 0 0 1px #e8f4fc, 0 2px 10px rgba(12, 60, 98, 0.32)'
            : '0 1px 4px rgba(8, 38, 62, 0.2)',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: showStaticWaveform ? 1 : 0 }}
      />
      {showOscilloscope && !isSyncSource && <AudioTrackOscilloscope trackId={trackId} />}
      <span
        className="absolute top-0.5 left-1.5 text-[10px] font-medium text-white pointer-events-none truncate max-w-full pr-2"
        style={{ textShadow: '0 1px 2px rgba(8, 34, 56, 0.8)' }}
      >
        {clip?.fileName}
      </span>
      {pending && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white animate-pulse pointer-events-none">
          loading…
        </span>
      )}
      {upload?.status === 'saving' && (
        <>
          <span className="absolute bottom-0.5 right-1.5 font-mono text-[9px] font-medium text-white pointer-events-none">
            ↑{Math.round(upload.progress * 100)}%
          </span>
          <div
            className="absolute bottom-0 left-0 h-[2px] pointer-events-none transition-[width] duration-150"
            style={{ width: `${upload.progress * 100}%`, backgroundColor: AUDIO_WAVEFORM_COLOR }}
          />
        </>
      )}
      {upload?.status === 'failed' && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            retryAudioTrackUpload(block.clipRef)
          }}
          title={`${upload.error ?? 'Upload failed'} - plays this session but won't survive a reload. Click to retry.`}
          className="absolute bottom-0.5 right-1.5 font-mono text-[10px] font-bold text-[var(--warn)] cursor-pointer"
        >
          !
        </button>
      )}
    </div>
  )
}
