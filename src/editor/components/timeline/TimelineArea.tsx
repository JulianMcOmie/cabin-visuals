'use client'

import { useRef, useState, useEffect, useLayoutEffect, type UIEvent as ReactScrollEvent, type PointerEvent as ReactPointerEvent, type DragEvent as ReactDragEvent } from 'react'
import { FileAudio, FileMusic, Film, Image as ImageIcon, Plus } from 'lucide-react'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { Track } from './Track'
import { OBJECT_TRACK_COLOR } from '../../utils/modifierColors'
import { TrackContextMenu } from './TrackContextMenu'
import { TimelineRuler } from './TimelineRuler'
import { usePlayhead } from '../../hooks/usePlayhead'
import { useScrub } from '../../hooks/useScrub'
import { useLoopDrag } from '../../hooks/useLoopDrag'
import { useTrackGestures } from './useTrackGestures'
import { useTrackCopyDrag } from './useTrackCopyDrag'
import { useTrackNestDrag } from './useTrackNestDrag'
import { flattenVisualRows } from './trackTree'
import { deselectTrack, selectNewTrack } from '../../utils/selection'
import { loadAudioTrack } from '../../utils/loadAudioTrack'
import { addVideoClipsToTrack, capError, FREE_TOTAL_BYTES, totalVideoBytes } from '../../core/video/videoUploads'
import { addPhotosToTrack } from '../../core/photo/photoUploads'
import { parseMidiFile, isMidiFileName, isMidiMimeType } from '../../core/midiImport'
import { getInstrument } from '../../instruments'
import { usePlan } from '../../../billing/usePlan'
import { startEdgeResize } from '../../utils/edgeResize'
import { PLAYHEAD_TRIANGLE_HALF, PLAYHEAD_SNAP_BEATS } from '../../constants'

export function TimelineArea() {
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  const activeIsMain = useProjectStore((s) => !!s.scenes[s.activeSceneId]?.isMain)
  const pixelsPerBeat = useUIStore((s) => s.tracksPixelsPerBeat)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const maxBeat = totalBars * beatsPerBar
  const barWidthPx = beatsPerBar * pixelsPerBeat
  const timelineWidthPx = totalBars * barWidthPx

  // One RAF-driven playhead overlay spanning the ruler + track lanes, plus a
  // draggable scrub from the ruler. laneRef measures the lane region (excludes
  // the track-label column) so a clientX maps to a fraction of the timeline.
  const laneRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const playheadHeadRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rulerContentRef = useRef<HTMLDivElement>(null)
  const clipRef = useRef<HTMLDivElement>(null)

  // Mirror the lane horizontal scroll onto the ruler via transform (no clamp, no
  // dependence on matching client widths → stays aligned to the far-right edge).
  const onTimelineScroll = (e: ReactScrollEvent<HTMLDivElement>) => {
    if (rulerContentRef.current) {
      rulerContentRef.current.style.transform = `translateX(${-e.currentTarget.scrollLeft}px)`
    }
    // Persist continuously so the position survives unmount (the ref may already be
    // detached by the time an unmount cleanup would run).
    useUIStore.getState().setTracksScroll(e.currentTarget.scrollLeft, e.currentTarget.scrollTop)
  }

  const { selectedBlockIds, marqueeRect, handleBlockPointerDown, handleLanePointerDown } = useTrackGestures({ laneRef })

  // Tracks render as a flattened tree (DFS order, indented by depth); collapsed
  // parents hide their descendant rows. Each object track's ability lanes are
  // interleaved as track-like sub-rows right after it (same row height).
  const collapsedTrackIds = useUIStore((s) => s.collapsedTrackIds)
  const visualRows = flattenVisualRows(tracks, rootTrackIds, collapsedTrackIds)

  // Right-click-a-track menu (add ability / automation), positioned at the cursor.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; trackId: string } | null>(null)

  // Two hand-rolled label gestures, distinguished in Track's pointer-down: a plain
  // drag re-nests/reorders (setTrackParent), Alt+drag duplicates.
  const { startNestDrag } = useTrackNestDrag(scrollRef)
  const { copyDrag, ghostRef, startTrackCopyDrag } = useTrackCopyDrag(scrollRef)

  // The shared drop indicator (nest-drag and library drag both write it): a row to
  // dim (the dragged source), a row to highlight (nest-into), or an insertion line.
  const trackDrop = useUIStore((s) => s.trackDrop)

  // While a library instrument is being dragged, the label column lights up as
  // the drop zone; once the cursor is over it the insertion line / nest
  // highlight takes over, so the hint text stands down (the border stays).
  const libraryDragging = useUIStore((s) => s.libraryDragging)
  const libraryDropReady = useUIStore((s) => s.libraryDragging && !!s.trackDrop)

  // Alt copy-drag still reflows rows to open a gap at its live insertion point. The
  // gap is a VISUAL row index (root tracks aren't at index*rowHeight once lanes exist);
  // it only opens when there's a real target (insertIndex != null).
  const dragActive = !!copyDrag
  const dragHasTarget = copyDrag?.insertIndex != null
  const dragGapRow = copyDrag?.gapRow ?? null
  const dragRowHeight = copyDrag?.rowHeight ?? 0

  const { startScrub } = useScrub({
    computeBeat: (clientX) => {
      if (!laneRef.current) return null
      const rect = laneRef.current.getBoundingClientRect()
      const raw = (clientX - rect.left) / pixelsPerBeat
      const beat = Math.round(raw / PLAYHEAD_SNAP_BEATS) * PLAYHEAD_SNAP_BEATS // snap to 1/4 beat
      return Math.max(0, Math.min(maxBeat, beat))
    },
  })

  // Loop-region drag on the ruler's top half - same clientX -> beat math as the
  // scrub, but snapped to whole beats (loop boundaries are bar-ish, not fine).
  const { startLoopDrag, startLoopMove, startLoopResize } = useLoopDrag({
    computeBeat: (clientX) => {
      if (!laneRef.current) return null
      const rect = laneRef.current.getBoundingClientRect()
      const beat = Math.round((clientX - rect.left) / pixelsPerBeat)
      return Math.max(0, Math.min(maxBeat, beat))
    },
    maxBeat,
  })

  // Restore the saved scroll on mount (before paint), and save it on unmount, so
  // returning from the MIDI editor lands you where you left off.
  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const { tracksScrollLeft, tracksScrollTop } = useUIStore.getState()
    sc.scrollLeft = tracksScrollLeft
    sc.scrollTop = tracksScrollTop
    if (rulerContentRef.current) rulerContentRef.current.style.transform = `translateX(${-tracksScrollLeft}px)`
  }, [])

  // Alt+scroll over the lanes zooms: deltaY → row height (vertical zoom), deltaX →
  // pixels-per-beat (horizontal zoom). Mirrors the MIDI editor's alt-scroll.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      if (Math.abs(e.deltaY) > 2) {
        const cur = useUIStore.getState().tracksRowHeight
        useUIStore.getState().setTracksRowHeight(cur - e.deltaY * 0.15)
      }
      if (Math.abs(e.deltaX) > 2) {
        const cur = useUIStore.getState().tracksPixelsPerBeat
        useUIStore.getState().setTracksPixelsPerBeat(cur - e.deltaX * 0.5)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  usePlayhead((beat) => {
    // Snap to a pixel *center* (whole px + 0.5) so the 1px-wide lane line renders
    // crisp on a single column while the triangle apex sits exactly on that
    // column's center - otherwise the crisp line lands ~0.5px off the apex.
    const beatX = Math.round(beat * pixelsPerBeat) + 0.5
    const sc = scrollRef.current
    // Clip the playhead overlay to the scroll container's client area (excludes the
    // scrollbars) so the line never draws over them.
    if (sc && clipRef.current) {
      const lw = useUIStore.getState().tracksLabelWidth
      clipRef.current.style.width = `${Math.max(0, sc.clientWidth - lw - PLAYHEAD_TRIANGLE_HALF)}px`
      clipRef.current.style.height = `${sc.clientHeight}px`
    }
    // Ruler triangle is positioned in content space (its container mirrors the lane
    // scroll). The lane line lives in a viewport-space overlay, so offset by scroll.
    if (playheadHeadRef.current) playheadHeadRef.current.style.transform = `translateX(${beatX}px)`
    if (playheadRef.current) {
      const sl = sc?.scrollLeft ?? 0
      playheadRef.current.style.transform = `translateX(${beatX - sl}px)`
    }
  })

  function insertTrack() {
    const state = useProjectStore.getState()
    const isMain = !!state.scenes[state.activeSceneId]?.isMain
    const id = crypto.randomUUID()
    state.addTrack({
      id,
      name: isMain ? 'Scene Switcher' : 'Cube',
      type: isMain ? 'director' as const : 'base' as const,
      instrumentId: isMain ? '' : 'cube',
      directorId: isMain ? 'sceneSwitcher' : undefined,
      sceneBindings: isMain
        ? state.sceneOrder.filter((sceneId) => !state.scenes[sceneId]?.isMain).map((sceneId, i) => ({ sceneId, pitch: 60 + i }))
        : undefined,
      color: OBJECT_TRACK_COLOR,
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
    })
    // A new instrument becomes the selection; blocks deselect.
    selectNewTrack(id)
  }

  // OS-file drag: dropping media anywhere on the tracks section adds tracks -
  // each audio file becomes its own audio track; video files land together as
  // ONE Video instrument track with a clip (pad at 0s) per file, uploading
  // through the same pipeline as drops on the clip bank. Detection keys off
  // the drag's item TYPES (file contents aren't readable until drop); the
  // depth counter absorbs enter/leave noise from crossing child boundaries.
  const { isPro } = usePlan()
  const [mediaDropHover, setMediaDropHover] = useState<{ audio: boolean; video: boolean; midi: boolean; photo: boolean } | null>(null)
  const dropDepthRef = useRef(0)
  // Drop problems (over-cap files, unreadable files) surface as a transient
  // notice over the tracks - never as a bare console error. Import summaries
  // reuse the same slot with an 'info' tone.
  const [dropNotice, setDropNotice] = useState<{ message: string; tone: 'warn' | 'info' } | null>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showDropNotice = (message: string, tone: 'warn' | 'info' = 'warn') => {
    setDropNotice({ message, tone })
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => setDropNotice(null), 8000)
  }
  useEffect(() => () => { if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current) }, [])
  // MIDI is sniffed before the audio/ prefix - 'audio/midi' must not read as
  // audio. Empty-type .mid drags stay invisible until drop (no filename here).
  const mediaKindsOf = (e: ReactDragEvent) => {
    let audio = false
    let video = false
    let midi = false
    let photo = false
    for (const it of Array.from(e.dataTransfer.items)) {
      if (it.kind !== 'file') continue
      if (isMidiMimeType(it.type)) midi = true
      else if (it.type.startsWith('audio/')) audio = true
      else if (it.type.startsWith('video/')) video = true
      else if (it.type.startsWith('image/')) photo = true
    }
    return audio || video || midi || photo ? { audio, video, midi, photo } : null
  }

  // Image drops append to a photo track rather than making a new one each time -
  // the selected track if it's a photo instrument, else the first photo track in
  // the project, else a fresh one. Lets the Slideshow template (its one track is
  // a photo instrument) grow by dragging photos straight onto the timeline.
  const addPhotoFiles = (files: File[]) => {
    const { tracks, rootTrackIds } = useProjectStore.getState()
    const selectedId = useUIStore.getState().selectedTrackId
    const isPhotoTrack = (id: string | null | undefined) => !!id && tracks[id]?.instrumentId === 'photo'
    let targetId = isPhotoTrack(selectedId) ? selectedId! : rootTrackIds.find(isPhotoTrack)
    if (!targetId) {
      targetId = crypto.randomUUID()
      useProjectStore.getState().addTrack({
        id: targetId,
        name: 'Photo',
        type: 'base',
        instrumentId: 'photo',
        color: OBJECT_TRACK_COLOR,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
      })
    }
    selectNewTrack(targetId)
    void addPhotosToTrack(targetId, files, isPro, showDropNotice)
  }
  // .mid files → new tracks through the pure parser + one store write, shared
  // by the header button and OS drops. Routed by extension, not MIME type -
  // browsers report 'audio/midi', 'audio/mid', or nothing for the same file.
  const importMidiFiles = (files: File[]) => {
    void (async () => {
      const createdIds: string[] = []
      let trackCount = 0
      let noteCount = 0
      let outsideCount = 0
      // The default instrument's declared vocabulary. Out-of-range notes still
      // import (the document keeps full pitch); the summary just counts them.
      const mapped = new Set(getInstrument('cube')?.midiRows?.map((r) => r.pitch) ?? [])
      for (const file of files) {
        let imported
        try {
          imported = parseMidiFile(await file.arrayBuffer())
        } catch {
          showDropNotice(`Couldn't read ${file.name}`)
          continue
        }
        if (imported.length === 0) {
          showDropNotice(`No notes in ${file.name}`)
          continue
        }
        createdIds.push(...useProjectStore.getState().importMidiTracks(imported))
        for (const t of imported) {
          trackCount++
          noteCount += t.notes.length
          if (mapped.size > 0) outsideCount += t.notes.filter((n) => !mapped.has(n.pitch)).length
        }
      }
      if (createdIds.length === 0) return
      selectNewTrack(createdIds[0])
      const summary = `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'} · ${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`
      showDropNotice(outsideCount > 0 ? `${summary} · ${outsideCount} outside Cube's range` : summary, 'info')
    })()
  }
  const midiInputRef = useRef<HTMLInputElement>(null)
  const onMediaDrop = (e: ReactDragEvent) => {
    e.preventDefault()
    dropDepthRef.current = 0
    setMediaDropHover(null)
    const files = Array.from(e.dataTransfer.files)

    const isMidiFile = (f: File) => isMidiFileName(f.name) || isMidiMimeType(f.type)
    const midiFiles = files.filter(isMidiFile)
    if (midiFiles.length > 0) importMidiFiles(midiFiles)

    const audioFiles = files.filter((f) => !isMidiFile(f) && f.type.startsWith('audio/'))
    void (async () => {
      for (const file of audioFiles) {
        try {
          await loadAudioTrack(file)
        } catch (err) {
          console.error('Failed to load dropped audio file', file.name, err)
          showDropNotice(`Couldn't load ${file.name}`)
        }
      }
    })()

    const videoFiles = files.filter((f) => f.type.startsWith('video/'))
    if (videoFiles.length > 0) {
      // An over-cap file cancels the whole video add (notify, add nothing) -
      // half-importing a drop is more confusing than rejecting it.
      const cap = videoFiles.map((f) => capError(f, isPro)).find((m) => m !== null)
      if (cap) {
        showDropNotice(cap)
        return
      }
      // Free plans also cap TOTAL video per project (1 GB); Pro is unlimited.
      // Sum every dropped file against the remaining headroom - if the batch
      // overflows, cancel the whole drop (same all-or-nothing rule as above).
      // Per-PROJECT client-side accounting only (the catalog knows just the
      // open project); a true per-account quota needs a server check.
      if (!isPro) {
        const dropBytes = videoFiles.reduce((sum, f) => sum + f.size, 0)
        if (totalVideoBytes() + dropBytes > FREE_TOTAL_BYTES) {
          const gb = (totalVideoBytes() / 1024 ** 3).toFixed(1)
          showDropNotice(
            `This project already has ${gb} GB of video - the free plan holds 1 GB total. Upgrade to Pro for unlimited video storage.`,
          )
          return
        }
      }
      const id = crypto.randomUUID()
      useProjectStore.getState().addTrack({
        id,
        name: 'Video',
        type: 'base',
        instrumentId: 'video',
        color: OBJECT_TRACK_COLOR,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
      })
      // A new instrument becomes the selection - the clip bank opens with the
      // uploads' progress on its rows.
      selectNewTrack(id)
      void addVideoClipsToTrack(id, videoFiles, isPro, showDropNotice)
    }

    const photoFiles = files.filter((f) => f.type.startsWith('image/'))
    if (photoFiles.length > 0) addPhotoFiles(photoFiles)
  }

  // Drag the label column's right edge to resize it (spans the ruler corner, every
  // track label, and the empty space below - one handle along the whole edge).
  function startLabelResize(e: ReactPointerEvent) {
    const { tracksLabelWidth, setTracksLabelWidth } = useUIStore.getState()
    startEdgeResize(e, tracksLabelWidth, setTracksLabelWidth)
  }

  return (
    <div className="relative flex flex-col h-full border-t border-[var(--border)] bg-[var(--bg-timeline)]">
      {/* Ruler in its own row (not inside the lane scroll container) so the lanes
          own the only scrollbars: the vertical one then ends below the ruler. Its
          content is translated to mirror the lane scroll (onTimelineScroll); the
          gutter reserves the lanes' scrollbar width so the strip ends where the
          lanes' content does. The Tracks header lives in the ruler's frozen corner. */}
      <div className="flex-shrink-0">
        <TimelineRuler
          onScrubStart={startScrub}
          onLoopDragStart={startLoopDrag}
          onLoopMoveStart={startLoopMove}
          onLoopResizeStart={startLoopResize}
          barWidthPx={barWidthPx}
          timelineWidthPx={timelineWidthPx}
          gutterPx={0}
          contentRef={rulerContentRef}
          playheadHeadRef={playheadHeadRef}
          corner={
            <div className="flex items-center gap-2 px-3 w-full">
              <span className="text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)] select-none">TRACKS</span>
              <button
                className="flex items-center justify-center w-4 h-4 rounded-[3px] bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--border)] transition-colors cursor-pointer"
                onClick={insertTrack}
                title={`Add track`}
              >
                <Plus size={11} />
              </button>
              <button
                className="flex items-center justify-center w-4 h-4 rounded-[3px] bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--border)] disabled:opacity-35 disabled:cursor-default transition-colors cursor-pointer"
                onClick={() => midiInputRef.current?.click()}
                disabled={activeIsMain}
                title={activeIsMain ? 'MIDI import is available inside visual scenes' : 'Import MIDI file'}
              >
                <FileMusic size={11} />
              </button>
              <input
                ref={midiInputRef}
                type="file"
                accept=".mid,.midi"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  // Reset so re-picking the same file fires change again.
                  e.target.value = ''
                  if (files.length > 0) importMidiFiles(files)
                }}
              />
            </div>
          }
        />
      </div>

      {/* Lanes: a relative wrapper holds the scroll container plus a viewport-space
          playhead overlay clipped to the lane region (so the playhead is never drawn
          over the frozen label column, its dividers, or the empty space - it slides
          under the label edge when scrolled). overflow-hidden clips the playhead
          overlay to the lane region, so a resize frame where its imperatively-set
          width lags can't spill out and spawn a stray (unstyled) scrollbar. */}
      <div
        className="relative flex-1 min-h-0 overflow-hidden"
        onDragEnter={(e) => {
          const kinds = mediaKindsOf(e)
          if (!kinds) return
          e.preventDefault()
          dropDepthRef.current++
          setMediaDropHover(kinds)
        }}
        onDragOver={(e) => {
          if (!mediaKindsOf(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          if (!mediaKindsOf(e)) return
          dropDepthRef.current = Math.max(0, dropDepthRef.current - 1)
          if (dropDepthRef.current === 0) setMediaDropHover(null)
        }}
        onDrop={onMediaDrop}
      >
        {libraryDragging && (
          <div
            className={`pointer-events-none absolute top-0 bottom-0 left-0 z-30 flex items-center justify-center border border-dashed transition-colors ${
              libraryDropReady
                ? 'border-[var(--accent)] bg-[var(--accent)]/15'
                : 'border-[var(--border-strong)] bg-[var(--accent)]/5'
            }`}
            style={{ width: labelWidth }}
          >
            {!libraryDropReady && (
              <span className="flex items-center gap-1.5 rounded bg-[var(--bg-panel)]/85 px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-3)]">
                <Plus size={12} /> drop here
              </span>
            )}
          </div>
        )}
        {mediaDropHover && (
          <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded border border-dashed border-[var(--accent)] bg-[var(--accent)]/10">
            <span className="flex items-center gap-1.5 rounded bg-[var(--bg-panel)]/85 px-3 py-1.5 font-mono text-[11px] text-[var(--accent)]">
              {mediaDropHover.video ? <Film size={13} /> : mediaDropHover.photo ? <ImageIcon size={13} /> : mediaDropHover.midi ? <FileMusic size={13} /> : <FileAudio size={13} />}
              {[mediaDropHover.audio, mediaDropHover.video, mediaDropHover.midi, mediaDropHover.photo].filter(Boolean).length > 1
                ? 'drop files to add tracks'
                : mediaDropHover.video
                  ? 'drop videos to add a video track'
                  : mediaDropHover.photo
                    ? 'drop photos to add to the slideshow'
                    : mediaDropHover.midi
                      ? 'drop MIDI to add tracks'
                      : 'drop audio to add tracks'}
            </span>
          </div>
        )}
        {dropNotice && (
          <div className="absolute bottom-3 left-1/2 z-40 -translate-x-1/2">
            <button
              onClick={() => setDropNotice(null)}
              title="Dismiss"
              className={`max-w-[560px] cursor-pointer rounded border bg-[var(--bg-panel)] px-3 py-1.5 text-left text-[11px] leading-snug shadow-lg shadow-black/40 ${
                dropNotice.tone === 'info'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-[var(--warn)] text-[var(--warn)]'
              }`}
            >
              {dropNotice.message}
            </button>
          </div>
        )}
        {rootTrackIds.length === 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <p className="text-xs text-[var(--text-muted)] text-center px-4">
              No tracks yet. Click <span className="text-[var(--text-3)] text-lg">+</span> to add a track, then right-click a lane to draw blocks.
            </p>
          </div>
        )}
        <div
          ref={scrollRef}
          data-tracks-scroll
          className="absolute inset-0 overflow-auto timeline-scrollbar select-none"
          onScroll={onTimelineScroll}
        >
          <div
            className="relative flex flex-col"
            style={{ width: labelWidth + PLAYHEAD_TRIANGLE_HALF + timelineWidthPx, minHeight: '100%' }}
          >
            {visualRows.map((row, i) => {
              const isLast = i === visualRows.length - 1
              const track = tracks[row.id]
              return track ? (
                <Track
                  key={row.id}
                  track={track}
                  depth={row.depth}
                  isLast={isLast}
                  liftOffset={dragActive ? (dragHasTarget && dragGapRow != null && i >= dragGapRow ? dragRowHeight : 0) : undefined}
                  dimmed={trackDrop?.activeId === row.id}
                  dropInto={trackDrop?.intoId === row.id}
                  onCopyDragStart={startTrackCopyDrag}
                  onNestDragStart={startNestDrag}
                  onLabelContextMenu={(e, id) => setCtxMenu({ x: e.clientX, y: e.clientY, trackId: id })}
                  barWidthPx={barWidthPx}
                  timelineWidthPx={timelineWidthPx}
                  selectedBlockIds={selectedBlockIds}
                  onBlockPointerDown={handleBlockPointerDown}
                  onLanePointerDown={handleLanePointerDown}
                />
              ) : null
            })}

            {/* Shared drop insertion line (nest-drag + library drag). Content-space,
                full width so it stays visible through horizontal scroll; indented to
                the target depth. Nesting *into* a row shows that row's highlight. */}
            {trackDrop?.line && (
              <div
                className="absolute z-30 pointer-events-none"
                style={{ top: trackDrop.line.top - 1, left: 0, right: 0, height: 2 }}
              >
                <div className="h-full bg-[var(--accent)]" style={{ marginLeft: trackDrop.line.left }} />
              </div>
            )}
            {/* Empty space below the tracks. The label-column portion belongs to the
                label section - it deselects but is otherwise inert (no marquee); only
                the lane portion behaves like the grid. */}
            <div className="flex-1 min-h-0 flex">
              <div
                className={`flex-shrink-0 sticky left-0 z-10 border-r border-r-[var(--border)] bg-[var(--bg-panel-raised)] ${
                  rootTrackIds.length > 0 ? 'border-t border-t-[var(--border-subtle)]' : ''
                }`}
                style={{ width: labelWidth }}
                onPointerDown={() => deselectTrack()}
              />
              <div
                className="flex-1"
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => handleLanePointerDown(e)}
              />
            </div>

            {/* Marquee overlay (content space, so its coords match block rects). */}
            <div
              ref={laneRef}
              className="absolute bottom-0 top-0 z-10 pointer-events-none"
              style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF, width: timelineWidthPx }}
            >
              {marqueeRect && (
                <div
                  className="absolute z-20 border border-[var(--accent)]"
                  style={{
                    left: marqueeRect.left,
                    top: marqueeRect.top,
                    width: marqueeRect.width,
                    height: marqueeRect.height,
                    backgroundColor: 'rgba(53, 167, 230, 0.15)',
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Playhead line over the lane region only (clipped). The thin visible line
            plus a wider transparent grab handle to scrub anywhere along its height.
            RAF offsets it by the scroll and sizes this clip box to the scroll
            container's client area, so the line tracks horizontal scroll, hides
            under the label edge, and never draws over the scrollbars. */}
        <div ref={clipRef} className="absolute top-0 overflow-hidden pointer-events-none" style={{ left: labelWidth + PLAYHEAD_TRIANGLE_HALF }}>
          <div ref={playheadRef} className="absolute top-0 bottom-0" style={{ left: 0, width: 0 }}>
            <div className="absolute top-0 bottom-0" style={{ left: -0.5, width: 1, backgroundColor: '#ecedef' }} />
            <div
              className="absolute top-0 bottom-0 pointer-events-auto cursor-ew-resize"
              style={{ left: -5, width: 10 }}
              onPointerDown={startScrub}
            />
          </div>
        </div>
      </div>

      {/* Floating ghost of the row being Alt-copy-dragged - mirrors the label box so
          it reads like the lifted row of a normal drag (top set imperatively). */}
      {copyDrag && (
        <div
          ref={ghostRef}
          className="fixed z-50 pointer-events-none flex items-center gap-2 px-3 border border-[var(--border)] shadow-lg shadow-black/40"
          style={{ left: copyDrag.labelLeft, width: labelWidth, height: copyDrag.rowHeight, backgroundColor: 'var(--bg-elevated)', opacity: 0.8 }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium truncate text-[var(--text)]">{copyDrag.name}</div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <div className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center ${copyDrag.muted ? 'bg-[var(--warn)] text-[#0a0a0c]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>M</div>
            <div className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center ${copyDrag.solo ? 'bg-[var(--accent)] text-[#0a0a0c]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'}`}>S</div>
          </div>
        </div>
      )}

      {/* Resize handle along the label column's right edge - spans the full height
          (ruler corner, every track label, the empty space below). Invisible; the
          cursor is the only affordance. */}
      <div
        onPointerDown={startLabelResize}
        className="absolute top-0 bottom-0 z-40 cursor-ew-resize"
        style={{ left: labelWidth - 3, width: 6 }}
      />

      {ctxMenu && (
        <TrackContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          trackId={ctxMenu.trackId}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
