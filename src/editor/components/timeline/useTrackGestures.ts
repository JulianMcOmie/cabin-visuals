import { useCallback, useEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore, cloneBlock, cloneTrack } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { useClipboardStore } from '../../store/ClipboardStore'
import { flattenVisualRows } from './trackTree'
import { deselectTrack, selectNewTrack, suppressTrackSelectBriefly, pruneSelectionAfterTrackDelete } from '../../utils/selection'
import type { Note, Block } from '../../types'

/** Owning track id for each visual row, so a vertical block drag maps every row it
 *  crosses to a real track. */
function rowTrackIdsOf(rows: ReturnType<typeof flattenVisualRows>): string[] {
  return rows.map((r) => r.id)
}

interface BlockOrigin {
  trackId: string
  trackIndex: number
  startBar: number
  durationBars: number
  notes: Note[]
}

const EDGE_PX = 8

// moving/resizing carry block origins; marquee carries the pre-drag selection
// to union against, and works in client coordinates (robust to scroll).
type DragState =
  | {
      type: 'moving' | 'resizing-left' | 'resizing-right'
      startX: number
      startY: number
      barWidthPx: number
      totalBars: number
      origins: Map<string, BlockOrigin>
      /** Owning track id per VISUAL row (track rows + ability-lane sub-rows), so a
       *  vertical block move indexes by the rows the user actually sees. Lane rows map
       *  to their parent track (dragging "through" a lane lands on the next track). */
      rowTrackIds: string[]
    }
  | {
      type: 'marquee'
      startClientX: number
      startClientY: number
      base: Set<string>
    }
  | {
      type: 'drawing'
      trackId: string
      blockId: string
      startBar: number
      pixelsPerBeat: number
      beatsPerBar: number
    }

interface MarqueeRect {
  left: number
  top: number
  width: number
  height: number
}

interface UseTrackGesturesOptions {
  /** The lane region element (excludes the label column) used to measure width. */
  laneRef: RefObject<HTMLDivElement | null>
}

/**
 * Gesture state machine for the tracks timeline. Mirrors useNoteGestures in
 * shape, but writes ProjectStore directly and continuously during a drag (no
 * local copy / debounce). Reads current positions from the store each frame,
 * so it never needs a stale-closure latest ref for data.
 */
export function useTrackGestures({ laneRef }: UseTrackGesturesOptions) {
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds)
  const setSelectedBlockIds = useUIStore((s) => s.setSelectedBlockIds)

  const dragRef = useRef<DragState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null)

  // Snap a bar position to the nearest whole beat (move, resize, and the
  // draw gesture's growing edge all come through here).
  const snapBar = (bar: number) => {
    const beatsPerBar = useProjectStore.getState().beatsPerBar
    return Math.round(bar * beatsPerBar) / beatsPerBar
  }

  const beginGestureTracking = useCallback(() => {
    const controller = new AbortController()
    abortRef.current = controller
    const t = dragRef.current?.type
    lockCursor(t === 'resizing-left' || t === 'resizing-right' || t === 'drawing' ? 'ew-resize' : 'default')

    const handleMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      // Any in-flight drag (marquee, move, resize, draw) ends with a click on
      // whatever row is under the pointer — that click must not select a track.
      suppressTrackSelectBriefly()

      if (d.type === 'marquee') {
        const minX = Math.min(d.startClientX, e.clientX)
        const maxX = Math.max(d.startClientX, e.clientX)
        const minY = Math.min(d.startClientY, e.clientY)
        const maxY = Math.max(d.startClientY, e.clientY)
        // Hit-test block elements by their client rects (scroll-independent).
        // Audio blocks participate in the marquee exactly like MIDI blocks.
        const ids = new Set(d.base)
        document.querySelectorAll<HTMLElement>('[data-block-id], [data-audio-block-id]').forEach((el) => {
          const r = el.getBoundingClientRect()
          if (r.right >= minX && r.left <= maxX && r.bottom >= minY && r.top <= maxY) {
            const id = el.dataset.blockId ?? el.dataset.audioBlockId
            if (id) ids.add(id)
          }
        })
        setSelectedBlockIds(ids)
        const laneR = laneRef.current?.getBoundingClientRect()
        if (laneR) {
          setMarqueeRect({ left: minX - laneR.left, top: minY - laneR.top, width: maxX - minX, height: maxY - minY })
        }
        return
      }

      if (d.type === 'drawing') {
        const laneR = laneRef.current?.getBoundingClientRect()
        if (!laneR) return
        const beat = (e.clientX - laneR.left) / d.pixelsPerBeat
        const oneBeat = 1 / d.beatsPerBar
        const endBar = snapBar(beat / d.beatsPerBar)
        const durationBars = Math.max(oneBeat, endBar - d.startBar)
        useProjectStore.getState().updateBlock(d.trackId, d.blockId, { durationBars })
        return
      }

      const deltaX = e.clientX - d.startX
      const deltaBars = d.barWidthPx > 0 ? deltaX / d.barWidthPx : 0
      const rowDelta = Math.round((e.clientY - d.startY) / useUIStore.getState().tracksRowHeight)
      const store = useProjectStore.getState()

      if (d.type === 'moving') {
        for (const [blockId, o] of d.origins) {
          const maxStart = Math.max(0, d.totalBars - o.durationBars)
          const newStartBar = Math.max(0, Math.min(maxStart, snapBar(o.startBar + deltaBars)))

          // Vertical: move to the row at origin index + rowDelta (clamped), mapped to
          // its owning track — so nested/child rows and ability-lane rows are crossed
          // correctly (a lane row resolves to its parent track, never a drop target).
          const targetIndex = Math.max(0, Math.min(d.rowTrackIds.length - 1, o.trackIndex + rowDelta))
          const targetTrackId = d.rowTrackIds[targetIndex]

          // The block may have already moved tracks on a previous frame; find it.
          let currentTrackId = o.trackId
          for (const tId of d.rowTrackIds) {
            if (store.tracks[tId]?.blocks.some((b) => b.id === blockId)) {
              currentTrackId = tId
              break
            }
          }
          if (currentTrackId !== targetTrackId) {
            store.moveBlock(currentTrackId, blockId, targetTrackId)
          }
          store.updateBlock(targetTrackId, blockId, { startBar: newStartBar })
        }
      } else if (d.type === 'resizing-right') {
        const oneBeat = 1 / useProjectStore.getState().beatsPerBar
        for (const [blockId, o] of d.origins) {
          const maxDuration = d.totalBars - o.startBar
          const newDuration = Math.max(oneBeat, Math.min(maxDuration, snapBar(o.durationBars + deltaBars)))
          store.updateBlock(o.trackId, blockId, { durationBars: newDuration })
        }
      } else if (d.type === 'resizing-left') {
        const beatsPerBar = useProjectStore.getState().beatsPerBar
        const oneBeat = 1 / beatsPerBar
        for (const [blockId, o] of d.origins) {
          // Drag the start, keep the end planted; clamp to >= 0 and >= 1 beat long.
          const end = o.startBar + o.durationBars
          const newStartBar = Math.max(0, Math.min(end - oneBeat, snapBar(o.startBar + deltaBars)))
          // Counter-shift notes (block-relative) so they stay put in absolute time,
          // written atomically with the start so they don't move on resize.
          const offsetBeats = (o.startBar - newStartBar) * beatsPerBar
          const notes = o.notes.map((n) => ({ ...n, startBeat: n.startBeat + offsetBeats }))
          store.updateBlock(o.trackId, blockId, { startBar: newStartBar, durationBars: end - newStartBar, notes })
        }
      }
    }

    const handleUp = () => {
      dragRef.current = null
      setMarqueeRect(null)
      unlockCursor()
      controller.abort()
      abortRef.current = null
    }

    window.addEventListener('pointermove', handleMove, { signal: controller.signal })
    window.addEventListener('pointerup', handleUp, { signal: controller.signal })
  }, [setSelectedBlockIds, laneRef])

  // Tear down a drag still in flight if the component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      document.body.style.userSelect = ''
    }
  }, [])

  // Capture the drag-start positions of every block in `dragSet`. `rows` is the visible
  // visual-row list; a block's `trackIndex` is the visual index of ITS track row, so
  // `trackIndex + rowDelta` lands on the row the user drags to (lane rows included).
  const captureOrigins = (dragSet: Set<string>, rows: ReturnType<typeof flattenVisualRows>) => {
    const { tracks } = useProjectStore.getState()
    const origins = new Map<string, BlockOrigin>()
    rows.forEach((row, idx) => {
      if (row.kind !== 'track') return
      const t = tracks[row.id]
      if (!t) return
      for (const b of t.blocks) {
        if (dragSet.has(b.id)) {
          origins.set(b.id, { trackId: row.id, trackIndex: idx, startBar: b.startBar, durationBars: b.durationBars, notes: b.notes })
        }
      }
    })
    return origins
  }

  const handleBlockPointerDown = useCallback((e: ReactPointerEvent, _trackId: string, blockId: string) => {
    // Let right-click fall through to the lane (block drawing) instead of moving.
    if (e.button !== 0) return
    e.stopPropagation()

    // Shift toggles selection without starting a drag.
    if (e.shiftKey) {
      const next = new Set(selectedBlockIds)
      if (next.has(blockId)) next.delete(blockId)
      else next.add(blockId)
      setSelectedBlockIds(next)
      return
    }

    // Near an edge → resize that edge; otherwise move. Edge zones shrink on
    // narrow blocks so the middle stays a move target.
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
    const localX = e.clientX - rect.left
    const w = rect.width
    const edge = Math.min(EDGE_PX, w / 4)
    const type: DragState['type'] =
      localX < edge ? 'resizing-left' : localX > w - edge ? 'resizing-right' : 'moving'

    // Select this block (keep an existing multi-selection it belongs to), then
    // arm the drag for the whole selection.
    let dragSet = selectedBlockIds
    if (!selectedBlockIds.has(blockId)) {
      dragSet = new Set([blockId])
      setSelectedBlockIds(dragSet)
    }

    // Alt-drag = duplicate: clone the drag set in place (originals stay put) and
    // drag the clones. Scans ALL tracks (root + child: nested/automation/ability), so
    // blocks on child tracks duplicate too. Only for moving, not edge-resize.
    if (e.altKey && type === 'moving') {
      const store = useProjectStore.getState()
      const cloneIds = new Set<string>()
      for (const [tId, t] of Object.entries(store.tracks)) {
        for (const b of t.blocks) {
          if (dragSet.has(b.id)) {
            const clone = cloneBlock(b)
            store.addBlock(tId, clone)
            cloneIds.add(clone.id)
          }
        }
      }
      dragSet = cloneIds
      setSelectedBlockIds(cloneIds)
    }

    const { tracks: allTracks, rootTrackIds } = useProjectStore.getState()
    const rows = flattenVisualRows(allTracks, rootTrackIds, useUIStore.getState().collapsedTrackIds)
    dragRef.current = {
      type,
      startX: e.clientX,
      startY: e.clientY,
      barWidthPx: useProjectStore.getState().beatsPerBar * useUIStore.getState().tracksPixelsPerBeat,
      totalBars: useProjectStore.getState().totalBars,
      origins: captureOrigins(dragSet, rows),
      rowTrackIds: rowTrackIdsOf(rows),
    }
    beginGestureTracking()
  }, [selectedBlockIds, setSelectedBlockIds, laneRef, beginGestureTracking])

  // Pointer down on a lane: right-click draws a new block on that track; left-click
  // begins a marquee (shift keeps the current selection as the base).
  const handleLanePointerDown = useCallback((e: ReactPointerEvent, trackId?: string) => {
    // Right-click on a track lane = draw a new block (snapped to beats).
    if (e.button === 2 && trackId) {
      const laneR = laneRef.current?.getBoundingClientRect()
      if (!laneR) return
      const pixelsPerBeat = useUIStore.getState().tracksPixelsPerBeat
      const beatsPerBar = useProjectStore.getState().beatsPerBar
      const oneBeat = 1 / beatsPerBar
      const startBeat = Math.max(0, Math.floor((e.clientX - laneR.left) / pixelsPerBeat))
      const startBar = startBeat / beatsPerBar
      const blockId = crypto.randomUUID()
      useProjectStore.getState().addBlock(trackId, { id: blockId, startBar, durationBars: oneBeat, loop: false, notes: [] })
      setSelectedBlockIds(new Set([blockId]))
      dragRef.current = { type: 'drawing', trackId, blockId, startBar, pixelsPerBeat, beatsPerBar }
      beginGestureTracking()
      return
    }

    if (e.button !== 0) return
    const base = e.shiftKey ? new Set(selectedBlockIds) : new Set<string>()
    if (!e.shiftKey) setSelectedBlockIds(new Set())
    dragRef.current = {
      type: 'marquee',
      startClientX: e.clientX,
      startClientY: e.clientY,
      base,
    }
    beginGestureTracking()
  }, [selectedBlockIds, setSelectedBlockIds, beginGestureTracking, laneRef])

  // Delete: selected blocks win (their track stays); with no blocks selected,
  // a selected track is deleted along with its blocks. Escape clears selection.
  // (This hook is only mounted with the timeline, so it never fires while the
  // MIDI editor is open.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      // Copy: selected blocks win; with none selected, copy the selected track.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        if (selectedBlockIds.size > 0) {
          const { tracks } = useProjectStore.getState()
          const picked: { trackId: string; block: Block }[] = []
          for (const [tId, t] of Object.entries(tracks)) {
            for (const b of t.blocks) if (selectedBlockIds.has(b.id)) picked.push({ trackId: tId, block: b })
          }
          if (picked.length === 0) return
          e.preventDefault()
          const base = Math.min(...picked.map((p) => p.block.startBar))
          const earliest = picked.reduce((a, b) => (b.block.startBar < a.block.startBar ? b : a))
          useClipboardStore.getState().setClip({
            kind: 'blocks',
            sourceTrackId: earliest.trackId,
            blocks: picked.map((p) => ({ ...p.block, startBar: p.block.startBar - base })),
          })
        } else {
          const trackId = useUIStore.getState().selectedTrackId
          const track = trackId ? useProjectStore.getState().tracks[trackId] : null
          if (!track) return
          e.preventDefault()
          useClipboardStore.getState().setClip({ kind: 'track', track })
        }
        return
      }

      // Paste: dispatch on what was copied. Lands exactly at the playhead (no snap).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
        const clip = useClipboardStore.getState().clip
        if (!clip) return
        const store = useProjectStore.getState()
        const { currentBeat } = useTimeStore.getState()
        const { beatsPerBar } = useProjectStore.getState()

        if (clip.kind === 'blocks') {
          const targetTrackId = useUIStore.getState().selectedTrackId ?? clip.sourceTrackId
          if (!store.tracks[targetTrackId]) return
          e.preventDefault()
          const targetBar = currentBeat / beatsPerBar // fractional bar is fine
          const positioned = clip.blocks.map((b) => cloneBlock({ ...b, startBar: targetBar + b.startBar }))
          store.addBlocks(targetTrackId, positioned)
          setSelectedBlockIds(new Set(positioned.map((b) => b.id)))
          // Teleport the playhead to the end of the last pasted block.
          const endBeat = Math.max(...positioned.map((b) => b.startBar + b.durationBars)) * beatsPerBar
          useTimeStore.getState().setCurrentBeat(endBeat)
        } else if (clip.kind === 'track') {
          e.preventDefault()
          const selId = useUIStore.getState().selectedTrackId
          const idx = selId ? store.rootTrackIds.indexOf(selId) : -1
          const copy = cloneTrack(clip.track)
          store.addTrack(copy, idx >= 0 ? idx + 1 : undefined)
          selectNewTrack(copy.id)
        }
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedBlockIds.size > 0) {
          e.preventDefault()
          useProjectStore.getState().deleteBlocks(selectedBlockIds)
          setSelectedBlockIds(new Set())
        } else {
          const trackId = useUIStore.getState().selectedTrackId
          if (trackId) {
            e.preventDefault()
            useProjectStore.getState().deleteTrack(trackId)
            // The whole subtree is gone — drop selected blocks that died with it.
            pruneSelectionAfterTrackDelete()
          }
        }
      } else if (e.key === 'Escape') {
        // Two-stage: first Esc clears the block selection; the next deselects
        // the track (taking its own selected blocks with it).
        if (selectedBlockIds.size > 0) setSelectedBlockIds(new Set())
        else deselectTrack()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedBlockIds, setSelectedBlockIds])

  return { selectedBlockIds, marqueeRect, handleBlockPointerDown, handleLanePointerDown }
}
