import { useCallback, useEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore, cloneBlock, cloneTrackTree, snapshotTrackTree } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { lockCursor, unlockCursor } from '../../utils/dragCursor'
import { useClipboardStore } from '../../store/ClipboardStore'
import { flattenVisualRows } from './trackTree'
import { loopLengthBeats } from '../../core/visual/noteFlatten'
import { deselectTrack, selectNewTrack, suppressTrackSelectBriefly, pruneSelectionAfterTrackDelete } from '../../utils/selection'
import type { Note, Block, Track } from '../../types'
import type { TrackTreeSnapshot } from '../../store/ProjectStore'

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
  loop: boolean
  /** The authored pattern length at drag start: the loop length for a looping
   *  block, the whole duration otherwise. Right-resize past it engages looping. */
  patternBars: number
}

const EDGE_PX = 8

function rootAncestorId(tracks: Record<string, Track>, id: string): string {
  let cur = id
  for (let parentId = tracks[cur]?.parentId; parentId; parentId = tracks[cur]?.parentId) {
    cur = parentId
  }
  return cur
}

function canPasteChildUnder(track: Track, copiedRoot: Track): boolean {
  if (track.type === 'audio') return false
  if (copiedRoot.type === 'mover' || copiedRoot.type === 'splitter') return track.type === 'base' && !track.parentId
  if (copiedRoot.type === 'ability') return track.type === 'base'
  if (copiedRoot.type === 'automation') return track.type === 'base' || track.type === 'mover'
  if (copiedRoot.type === 'envelope') return track.type === 'base'
  return true
}

function pasteTargetForTrackTree(
  tree: TrackTreeSnapshot,
  tracks: Record<string, Track>,
  rootTrackIds: string[],
  selectedTrackId: string | null,
): { parentId: string | null; index: number | undefined } {
  const copiedRoot = tree.tracks[tree.rootId]
  const selected = selectedTrackId ? tracks[selectedTrackId] : undefined
  if (!copiedRoot) return { parentId: null, index: undefined }

  if (copiedRoot.parentId) {
    if (selected && canPasteChildUnder(selected, copiedRoot)) {
      return { parentId: selected.id, index: undefined }
    }
    const parentId = selected?.parentId ?? copiedRoot.parentId
    const parent = parentId ? tracks[parentId] : undefined
    const selectedSiblingIndex = selected && selected.parentId === parentId
      ? parent?.childIds.indexOf(selected.id) ?? -1
      : -1
    return {
      parentId: parent ? parentId : null,
      index: selectedSiblingIndex >= 0 ? selectedSiblingIndex + 1 : undefined,
    }
  }

  const selectedRootId = selectedTrackId && tracks[selectedTrackId]
    ? rootAncestorId(tracks, selectedTrackId)
    : null
  const selectedRootIndex = selectedRootId ? rootTrackIds.indexOf(selectedRootId) : -1
  return {
    parentId: null,
    index: selectedRootIndex >= 0 ? selectedRootIndex + 1 : undefined,
  }
}

// moving/resizing carry block origins; marquee carries the pre-drag selection
// to union against, and works in client coordinates (robust to scroll).
type DragState =
  | {
      type: 'moving' | 'resizing-left' | 'resizing-right'
      startX: number
      startY: number
      barWidthPx: number
      totalBars: number
      /** Right-edge grabs on the TOP half of the block arm looping (dragging past
       *  the pattern repeats it); bottom-half grabs are a plain resize. */
      loopArm: boolean
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
    const gesture = dragRef.current
    const t = gesture?.type
    lockCursor(gesture && 'loopArm' in gesture && gesture.loopArm
      ? 'default'
      : t === 'resizing-left' || t === 'resizing-right' || t === 'drawing' ? 'ew-resize' : 'default')

    const handleMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      // Any in-flight drag (marquee, move, resize, draw) ends with a click on
      // whatever row is under the pointer - that click must not select a track.
      suppressTrackSelectBriefly()

      if (d.type === 'marquee') {
        // The marquee never extends into the (sticky) track-label column: clamp
        // the pointer to the labels' on-screen right edge before hit-testing
        // and drawing the rectangle. The playhead gutter IS fair game - only
        // the labels themselves are out of bounds.
        const sc = laneRef.current?.closest('[data-tracks-scroll]')
        const labelEdge = sc
          ? sc.getBoundingClientRect().left + useUIStore.getState().tracksLabelWidth
          : -Infinity
        const px = Math.max(labelEdge, e.clientX)
        const minX = Math.min(d.startClientX, px)
        const maxX = Math.max(d.startClientX, px)
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
          // its owning track - so nested/child rows and ability-lane rows are crossed
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
          if (d.loopArm) {
            // Top-half grab: past the authored pattern the block loops (pattern
            // length locked at drag start); back inside it is a plain block
            // again. Empty blocks never loop - there is nothing to repeat.
            const loops = o.notes.length > 0 && newDuration > o.patternBars + 1e-9
            store.updateBlock(o.trackId, blockId, loops
              ? { durationBars: newDuration, loop: true, loopLengthBars: o.patternBars }
              : { durationBars: newDuration, loop: false, loopLengthBars: undefined })
          } else if (o.loop) {
            // Bottom-half grab on an already-looping block: a plain resize that
            // keeps the loop as-is, except shrinking to <= the pattern length
            // still un-loops it (shrink-to-unloop works from either half).
            const stillLoops = newDuration > o.patternBars + 1e-9
            store.updateBlock(o.trackId, blockId, stillLoops
              ? { durationBars: newDuration, loop: true, loopLengthBars: o.patternBars }
              : { durationBars: newDuration, loop: false, loopLengthBars: undefined })
          } else {
            // Bottom-half grab on a plain block: never engages looping.
            store.updateBlock(o.trackId, blockId, { durationBars: newDuration })
          }
        }
      } else if (d.type === 'resizing-left') {
        const beatsPerBar = useProjectStore.getState().beatsPerBar
        const oneBeat = 1 / beatsPerBar
        for (const [blockId, o] of d.origins) {
          // Drag the start, keep the end planted; clamp to >= 0 and >= 1 beat long.
          const end = o.startBar + o.durationBars
          const newStartBar = Math.max(0, Math.min(end - oneBeat, snapBar(o.startBar + deltaBars)))
          // Counter-shift notes (block-relative) so they stay put in absolute time,
          // written atomically with the start so they don't move on resize. A
          // looping block also gets its loop length pinned: the shifted notes
          // would otherwise change an inferred length and break the phase.
          const offsetBeats = (o.startBar - newStartBar) * beatsPerBar
          const notes = o.notes.map((n) => ({ ...n, startBeat: n.startBeat + offsetBeats }))
          const updates = { startBar: newStartBar, durationBars: end - newStartBar, notes }
          store.updateBlock(o.trackId, blockId, o.loop ? { ...updates, loopLengthBars: o.patternBars } : updates)
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
    const { tracks, beatsPerBar } = useProjectStore.getState()
    const origins = new Map<string, BlockOrigin>()
    rows.forEach((row, idx) => {
      if (row.kind !== 'track') return
      const t = tracks[row.id]
      if (!t) return
      for (const b of t.blocks) {
        if (dragSet.has(b.id)) {
          origins.set(b.id, {
            trackId: row.id,
            trackIndex: idx,
            startBar: b.startBar,
            durationBars: b.durationBars,
            notes: b.notes,
            loop: b.loop,
            patternBars: b.loop ? loopLengthBeats(b, beatsPerBar) / beatsPerBar : b.durationBars,
          })
        }
      }
    })
    return origins
  }

  const handleBlockPointerDown = useCallback((e: ReactPointerEvent, _trackId: string, blockId: string) => {
    // Let right-click fall through to the lane (block drawing) instead of moving.
    if (e.button !== 0) return
    e.stopPropagation()

    // Shift toggles selection without starting a drag. preventDefault keeps the
    // shift-click from extending the browser's DOM text selection across the app.
    if (e.shiftKey) {
      e.preventDefault()
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
    // Only the TOP half of the right edge arms looping; the bottom half is a
    // plain resize (see the resizing-right move handler).
    const loopArm = type === 'resizing-right' && e.clientY < rect.top + rect.height / 2

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
      loopArm,
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
    // Shift-marquee adds to the selection; keep the shift-click itself from
    // extending the browser's DOM text selection.
    if (e.shiftKey) e.preventDefault()
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
          useClipboardStore.getState().setClip({
            kind: 'blocks',
            blocks: picked.map((p) => ({
              sourceTrackId: p.trackId,
              block: { ...p.block, startBar: p.block.startBar - base },
            })),
          })
        } else {
          const trackId = useUIStore.getState().selectedTrackId
          const { tracks } = useProjectStore.getState()
          const tree = trackId ? snapshotTrackTree(trackId, tracks) : null
          if (!tree) return
          e.preventDefault()
          useClipboardStore.getState().setClip({ kind: 'track', tree })
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
          e.preventDefault()
          const targetBar = currentBeat / beatsPerBar // fractional bar is fine
          const distinctSources = new Set(clip.blocks.map((b) => b.sourceTrackId))
          // Multi-track copy: each block returns to its own source track, so the
          // arrangement is preserved (blocks whose source track is gone are
          // dropped). Single-track copy: everything lands on the selected track
          // (or the source track when nothing is selected).
          const multiTrack = distinctSources.size > 1
          const pasted: Block[] = []
          if (multiTrack) {
            for (const { sourceTrackId, block } of clip.blocks) {
              if (!store.tracks[sourceTrackId]) continue
              const clone = cloneBlock({ ...block, startBar: targetBar + block.startBar })
              store.addBlock(sourceTrackId, clone)
              pasted.push(clone)
            }
          } else {
            const soleSource = clip.blocks[0]?.sourceTrackId
            const targetTrackId = useUIStore.getState().selectedTrackId ?? soleSource
            if (!targetTrackId || !store.tracks[targetTrackId]) return
            const positioned = clip.blocks.map((b) => cloneBlock({ ...b.block, startBar: targetBar + b.block.startBar }))
            store.addBlocks(targetTrackId, positioned)
            pasted.push(...positioned)
          }
          if (pasted.length === 0) return
          setSelectedBlockIds(new Set(pasted.map((b) => b.id)))
          // Teleport the playhead to the end of the last pasted block.
          const endBeat = Math.max(...pasted.map((b) => b.startBar + b.durationBars)) * beatsPerBar
          useTimeStore.getState().setCurrentBeat(endBeat)
        } else if (clip.kind === 'track') {
          e.preventDefault()
          const selId = useUIStore.getState().selectedTrackId
          const target = pasteTargetForTrackTree(clip.tree, store.tracks, store.rootTrackIds, selId)
          const tree = cloneTrackTree(clip.tree, target.parentId)
          if (tree.length === 0) return
          store.addTrackTree(tree, target.index)
          selectNewTrack(tree[0].id)
          if (target.parentId) useUIStore.getState().setTrackCollapsed(target.parentId, false)
        }
        return
      }

      // Split selected MIDI blocks at the playhead. Audio blocks are ignored by the
      // store action; no selection means leave the browser's normal bold shortcut alone.
      // (Tyler's branch had the same feature on Cmd/Ctrl+E with the pre-split API -
      // superseded by this one.)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'b' || e.key === 'B')) {
        if (selectedBlockIds.size === 0) return
        e.preventDefault()
        const nextSelection = useProjectStore.getState().splitBlocksAtBeat(
          selectedBlockIds,
          useTimeStore.getState().currentBeat,
        )
        if (nextSelection) setSelectedBlockIds(nextSelection)
        return
      }

      // Join selected MIDI blocks per track into one spanning block.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        if (selectedBlockIds.size === 0) return
        e.preventDefault()
        const nextSelection = useProjectStore.getState().joinBlocks(selectedBlockIds)
        if (nextSelection) setSelectedBlockIds(nextSelection)
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
            // The whole subtree is gone - drop selected blocks that died with it.
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
