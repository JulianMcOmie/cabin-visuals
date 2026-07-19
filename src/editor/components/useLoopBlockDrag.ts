import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { flattenVisualRows } from './timeline/trackTree'
import { selectNewBlock } from '../utils/selection'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { getInstrument } from '../instruments'
import { PLAYHEAD_TRIANGLE_HALF } from '../constants'
import type { Block, Track } from '../types'
import type { LoopPattern } from './loops'

/** The pitch a dropped loop speaks on this track: the instrument's emphasized
 *  midi row, else its first row, else C4 (movers' signed-basis 60 included). */
function pitchFor(track: Track): number {
  const rows = track.type === 'base' ? getInstrument(track.instrumentId)?.midiRows : undefined
  return rows?.find((r) => r.emphasized)?.pitch ?? rows?.[0]?.pitch ?? 60
}

/**
 * Drag a loop pattern from the library onto a track LANE: the row under the
 * cursor takes a looping block at the bar under the cursor. Same gesture
 * skeleton as useLibraryDrag (ghost + movement threshold), different target -
 * lanes and bars instead of the label column.
 */
export function useLoopBlockDrag() {
  const ghostRef = useRef<HTMLDivElement>(null)
  const [ghostName, setGhostName] = useState<string | null>(null)

  const startLoopBlockDrag = useCallback((e: ReactPointerEvent, pattern: LoopPattern) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let started = false
    let lastX = startX
    let lastY = startY

    const moveGhost = (x: number, y: number) => {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${x}px`
        ghostRef.current.style.top = `${y}px`
      }
    }

    /** The track row + bar under a client point, or null off-lane. */
    const laneTarget = (x: number, y: number): { track: Track; bar: number } | null => {
      const sc = document.querySelector('[data-tracks-scroll]') as HTMLElement | null
      if (!sc) return null
      const r = sc.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null
      const ui = useUIStore.getState()
      const laneLeft = r.left + ui.tracksLabelWidth + PLAYHEAD_TRIANGLE_HALF
      if (x < laneLeft) return null // the label column is the instruments' drop zone
      const { tracks, rootTrackIds, beatsPerBar, totalBars } = useProjectStore.getState()
      const rows = flattenVisualRows(tracks, rootTrackIds, ui.collapsedTrackIds)
      const index = Math.floor((y - (r.top - sc.scrollTop)) / ui.tracksRowHeight)
      const row = rows[index]
      const track = row ? tracks[row.id] : undefined
      if (!track || track.type === 'audio') return null
      const beat = (x - laneLeft + sc.scrollLeft) / ui.tracksPixelsPerBeat
      const bar = Math.max(0, Math.min(totalBars - 1, Math.floor(beat / beatsPerBar)))
      return { track, bar }
    }

    const controller = new AbortController()

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return
        started = true
        lockCursor('default')
        setGhostName(pattern.name)
        const px = ev.clientX
        const py = ev.clientY
        requestAnimationFrame(() => moveGhost(px, py))
      }
      lastX = ev.clientX
      lastY = ev.clientY
      moveGhost(ev.clientX, ev.clientY)
    }

    const onUp = () => {
      controller.abort()
      if (!started) return
      unlockCursor()
      setGhostName(null)
      const target = laneTarget(lastX, lastY)
      if (!target) return
      const { beatsPerBar } = useProjectStore.getState()
      const pitch = pitchFor(target.track)
      const block: Block = {
        id: crypto.randomUUID(),
        startBar: target.bar,
        // Land as a few visible repeats; the edges drag out to taste.
        durationBars: pattern.bars * 4,
        loop: true,
        loopLengthBars: pattern.bars,
        notes: pattern.notes
          .filter(([b]) => b < pattern.bars * beatsPerBar)
          .map(([b, dur]) => ({
            id: crypto.randomUUID(),
            startBeat: b,
            durationBeats: dur,
            pitch,
            velocity: 100,
          })),
      }
      useProjectStore.getState().addBlock(target.track.id, block)
      selectNewBlock(block.id)
    }

    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [])

  return { startLoopBlockDrag, ghostRef, ghostName }
}
