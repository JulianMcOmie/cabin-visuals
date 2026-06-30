import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { TRACK_LABEL_WIDTH, PLAYHEAD_TRIANGLE_HALF } from '../constants'
import type { Track } from '../types'

function makeTrack(item: { id: string; name: string }): Track {
  return {
    id: crypto.randomUUID(),
    name: item.name,
    type: 'base',
    instrumentId: item.id,
    color: '#6366f1',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
  }
}

/**
 * Drag a library instrument into the track label column to add a track there.
 * Mirrors the alt-copy-drag: a floating ghost follows the cursor and the track rows
 * reflow to open a gap at the live insertion point; the new track is inserted on
 * drop (no-op if released away from the label column). A pure click does nothing —
 * the drag only begins past a small movement threshold. The live insertion gap is
 * published to UIStore so the timeline (a sibling) can reflow its rows.
 */
export function useLibraryDrag() {
  const ghostRef = useRef<HTMLDivElement>(null)
  const [ghostName, setGhostName] = useState<string | null>(null)

  const startLibraryDrag = useCallback((e: ReactPointerEvent, item: { id: string; name: string }) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let started = false
    let lastIndex: number | null | undefined

    // The ghost is centered on the cursor (translate(-50%,-50%) in the markup), so
    // left/top track the cursor directly rather than trailing it.
    const moveGhost = (x: number, y: number) => {
      if (ghostRef.current) {
        ghostRef.current.style.left = `${x}px`
        ghostRef.current.style.top = `${y}px`
      }
    }

    const controller = new AbortController()

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 3) return
        started = true
        setGhostName(item.name)
        // Ghost mounts on this render; position it once it exists (next frame).
        const px = ev.clientX
        const py = ev.clientY
        requestAnimationFrame(() => moveGhost(px, py))
      }
      moveGhost(ev.clientX, ev.clientY)

      const sc = document.querySelector('[data-tracks-scroll]') as HTMLElement | null
      const rowHeight = useUIStore.getState().tracksRowHeight
      let index: number | null = null
      if (sc) {
        const r = sc.getBoundingClientRect()
        const overLabels =
          ev.clientX >= r.left &&
          ev.clientX <= r.left + TRACK_LABEL_WIDTH + PLAYHEAD_TRIANGLE_HALF &&
          ev.clientY >= r.top &&
          ev.clientY <= r.bottom
        if (overLabels) {
          const n = useProjectStore.getState().rootTrackIds.length
          const listTop = r.top - sc.scrollTop
          index = Math.max(0, Math.min(n, Math.round((ev.clientY - listTop) / rowHeight)))
        }
      }
      if (index !== lastIndex) {
        lastIndex = index
        useUIStore.getState().setLibraryDrag({ insertIndex: index, rowHeight })
      }
    }

    const onUp = () => {
      controller.abort()
      if (!started) return
      const insertIndex = useUIStore.getState().libraryDrag?.insertIndex ?? null
      useUIStore.getState().setLibraryDrag(null)
      setGhostName(null)
      if (insertIndex != null) {
        const track = makeTrack(item)
        useProjectStore.getState().addTrack(track, insertIndex)
        useUIStore.getState().setSelectedTrackId(track.id)
      }
    }

    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [])

  return { startLibraryDrag, ghostRef, ghostName }
}
