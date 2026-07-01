import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import type { Note } from '../../types'

const EDGE_PX = 8

type LaneDrag =
  | {
      type: 'moving' | 'resizing-left' | 'resizing-right'
      blockId: string
      startX: number
      barWidthPx: number
      totalBars: number
      startBar: number
      durationBars: number
      notes: Note[]
    }
  | { type: 'drawing'; blockId: string; startBar: number; pixelsPerBeat: number; beatsPerBar: number }

/**
 * Block gestures for one ability lane — the single-lane, horizontal-only analogue of
 * useTrackGestures. Right-click draws a block; left-click a block moves it or resizes
 * an edge. All writes go to `track.lanes[laneKey]` via the store's `laneKey` param, so
 * this never touches the track's own blocks. Kept separate from useTrackGestures so the
 * (fragile) multi-track marquee/vertical-move machinery stays untouched. `laneRef` is
 * the lane's own scrolling region (its left edge = beat 0).
 */
export function useLaneGestures(trackId: string, laneKey: string, laneRef: RefObject<HTMLDivElement | null>) {
  const dragRef = useRef<LaneDrag | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const setSelectedBlockIds = useUIStore((s) => s.setSelectedBlockIds)

  const snapBar = (bar: number) => {
    const bpb = useProjectStore.getState().beatsPerBar
    return Math.round(bar * bpb) / bpb
  }

  const begin = useCallback(() => {
    const controller = new AbortController()
    abortRef.current = controller
    const t = dragRef.current?.type
    lockCursor(t === 'resizing-left' || t === 'resizing-right' || t === 'drawing' ? 'ew-resize' : 'default')

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const store = useProjectStore.getState()

      if (d.type === 'drawing') {
        const laneR = laneRef.current?.getBoundingClientRect()
        if (!laneR) return
        const oneBeat = 1 / d.beatsPerBar
        const endBar = snapBar((e.clientX - laneR.left) / d.pixelsPerBeat / d.beatsPerBar)
        const durationBars = Math.max(oneBeat, endBar - d.startBar)
        store.updateBlock(trackId, d.blockId, { durationBars }, laneKey)
        return
      }

      const deltaBars = d.barWidthPx > 0 ? (e.clientX - d.startX) / d.barWidthPx : 0
      if (d.type === 'moving') {
        const maxStart = Math.max(0, d.totalBars - d.durationBars)
        const newStartBar = Math.max(0, Math.min(maxStart, snapBar(d.startBar + deltaBars)))
        store.updateBlock(trackId, d.blockId, { startBar: newStartBar }, laneKey)
      } else if (d.type === 'resizing-right') {
        const oneBeat = 1 / store.beatsPerBar
        const maxDuration = d.totalBars - d.startBar
        const newDuration = Math.max(oneBeat, Math.min(maxDuration, snapBar(d.durationBars + deltaBars)))
        store.updateBlock(trackId, d.blockId, { durationBars: newDuration }, laneKey)
      } else {
        // resizing-left: drag the start, keep the end planted; counter-shift notes so
        // they stay put in absolute time (written atomically with the start).
        const beatsPerBar = store.beatsPerBar
        const oneBeat = 1 / beatsPerBar
        const end = d.startBar + d.durationBars
        const newStartBar = Math.max(0, Math.min(end - oneBeat, snapBar(d.startBar + deltaBars)))
        const offsetBeats = (d.startBar - newStartBar) * beatsPerBar
        const notes = d.notes.map((n) => ({ ...n, startBeat: n.startBeat + offsetBeats }))
        store.updateBlock(trackId, d.blockId, { startBar: newStartBar, durationBars: end - newStartBar, notes }, laneKey)
      }
    }

    const onUp = () => {
      dragRef.current = null
      unlockCursor()
      controller.abort()
      abortRef.current = null
    }

    window.addEventListener('pointermove', onMove, { signal: controller.signal })
    window.addEventListener('pointerup', onUp, { signal: controller.signal })
  }, [trackId, laneKey, laneRef])

  // Right-click on the lane draws a new block, then drag sizes it.
  const onLanePointerDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 2) return
    const laneR = laneRef.current?.getBoundingClientRect()
    if (!laneR) return
    const pixelsPerBeat = useUIStore.getState().tracksPixelsPerBeat
    const beatsPerBar = useProjectStore.getState().beatsPerBar
    const oneBeat = 1 / beatsPerBar
    const startBeat = Math.max(0, Math.floor((e.clientX - laneR.left) / pixelsPerBeat))
    const startBar = startBeat / beatsPerBar
    const blockId = crypto.randomUUID()
    useProjectStore.getState().addBlock(trackId, { id: blockId, startBar, durationBars: oneBeat, loop: false, notes: [] }, laneKey)
    setSelectedBlockIds(new Set([blockId]))
    dragRef.current = { type: 'drawing', blockId, startBar, pixelsPerBeat, beatsPerBar }
    begin()
  }, [trackId, laneKey, laneRef, begin, setSelectedBlockIds])

  // Left-click on a lane block moves it, or resizes an edge.
  const onBlockPointerDown = useCallback((e: ReactPointerEvent, _trackId: string, blockId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const block = useProjectStore.getState().tracks[trackId]?.lanes?.[laneKey]?.find((b) => b.id === blockId)
    if (!block) return
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const localX = e.clientX - rect.left
    const w = rect.width
    const edge = Math.min(EDGE_PX, w / 4)
    const type: LaneDrag['type'] = localX < edge ? 'resizing-left' : localX > w - edge ? 'resizing-right' : 'moving'
    setSelectedBlockIds(new Set([blockId]))
    dragRef.current = {
      type,
      blockId,
      startX: e.clientX,
      barWidthPx: useProjectStore.getState().beatsPerBar * useUIStore.getState().tracksPixelsPerBeat,
      totalBars: useProjectStore.getState().totalBars,
      startBar: block.startBar,
      durationBars: block.durationBars,
      notes: block.notes,
    }
    begin()
  }, [trackId, laneKey, begin, setSelectedBlockIds])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { onLanePointerDown, onBlockPointerDown }
}
