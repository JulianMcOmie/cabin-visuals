import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Move3d, Tag } from 'lucide-react'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { Block } from './Block'
import { AudioBlock } from './AudioBlock'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { INDENT_PX, LABEL_BASE_PX } from './trackDrop'
import type { RowGuide } from './trackTree'
import { AUDIO_TRACK_COLOR } from '../../utils/trackColors'
import { selectTrack, selectTrackRange, shouldSuppressTrackSelect, toggleTrackInSelection } from '../../utils/selection'
import { getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { canPreview, setInstrumentPreview } from '../InstrumentHoverPreview'
import { flattenBlocks } from '../../core/visual/noteFlatten'
import { resolveDeclaredMidiRows } from '../midi/resolveDeclaredRows'
import type { InstrumentItem } from '../LeftSidebar'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Track as TrackType } from '../../types'
import { TrackTransformPanel, beginTransformDrag, resetTransformValues, transformValue } from './TrackTransformPanel'
import { TrackTagsPanel } from './TrackTagsPanel'
import { TF_OPACITY } from '../../core/transform'

// The strip fader is the track's "volume": opacity 0..1, snapping at 0/50/100%.
const OPACITY_FADER_SPEC = { min: 0, max: 1, step: 0.01, snaps: [0, 0.5, 1], snapThreshold: 0.03 }

// Logic-style M/S painting: pointer-down on a button starts a stroke, and every
// button of the SAME kind the pointer crosses while held gets the first
// toggle's resulting state (painted, not flipped - sweeps stay predictable).
// Module-level on purpose: one stroke spans many Track instances.
let msPaint: { kind: 'mute' | 'solo'; value: boolean } | null = null

const BRACKET_CORNER_RADIUS_PX = 6

// Tag badges under the name need a second text line; only rows the user has
// deliberately made tall (default height is 44) get one.
const TAG_BADGES_MIN_ROW_HEIGHT = 64

function startMsPaint(kind: 'mute' | 'solo', value: boolean) {
  msPaint = { kind, value }
  window.addEventListener('pointerup', () => { msPaint = null }, { once: true })
}

interface TrackProps {
  track: TrackType
  barWidthPx: number
  timelineWidthPx: number
  selectedBlockIds: Set<string>
  onBlockPointerDown: (e: ReactPointerEvent, trackId: string, blockId: string) => void
  onLanePointerDown: (e: ReactPointerEvent, trackId?: string) => void
  /** Last track in the list - suppresses the label-section divider, like the grid. */
  isLast?: boolean
  /** Nesting depth (0 = root) - indents the label by INDENT_PX per level. */
  depth?: number
  /** Ancestor bracket lines (index = ancestor depth), drawn along the label's left. */
  guides?: RowGuide[]
  /** Left inset (px) of the label's bottom divider - it starts at the bracket line
   *  of the NEXT row's depth, so it never crosses a parent's bracket region.
   *  null/undefined = no divider (last row, or the next row's curve draws it). */
  dividerInset?: number | null
  /** Number of visible rows in this track's subtree below it - the parent's
   *  background strip beside its children spans exactly this many rows. */
  descendantRows?: number
  /** During an Alt copy-drag / library drag: vertical shift (px) to open the gap. */
  liftOffset?: number
  /** This row is the source of an in-progress nest-drag (dim it). */
  dimmed?: boolean
  /** This row is the live nest-into target (highlight it). */
  dropInto?: boolean
  /** Begin an Alt copy-drag from this track's label. */
  onCopyDragStart?: (e: ReactPointerEvent, trackId: string) => void
  /** Begin a drag-to-nest from this track's label. */
  onNestDragStart?: (e: ReactPointerEvent, trackId: string) => void
  /** Right-click on the label - opens the add-ability / add-automation menu. */
  onLabelContextMenu?: (e: ReactMouseEvent, trackId: string) => void
}

export function Track({ track, barWidthPx, timelineWidthPx, selectedBlockIds, onBlockPointerDown, onLanePointerDown, isLast, depth = 0, guides, dividerInset, descendantRows = 0, liftOffset, dimmed, dropInto, onCopyDragStart, onNestDragStart, onLabelContextMenu }: TrackProps) {
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const isPlaying = useTimeStore((s) => s.isPlaying)

  const selectedTrackId = useUIStore((s) => s.selectedTrackId)
  const inMultiSelection = useUIStore((s) => s.selectedTrackIds.has(track.id))
  const loopDragHere = useUIStore((s) => (s.loopDrag?.target?.trackId === track.id ? s.loopDrag : null))
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const setTrackCollapsed = useUIStore((s) => s.setTrackCollapsed)
  const isCollapsed = useUIStore((s) => s.collapsedTrackIds.has(track.id))
  const toggleMute = useProjectStore((s) => s.toggleMute)
  const toggleSolo = useProjectStore((s) => s.toggleSolo)
  const renameTrack = useProjectStore((s) => s.renameTrack)

  // The transform strip (opacity fader + panel opener) exists on object tracks only.
  const isObjectTrack = track.type === 'base' && !!track.instrumentId
  const opacityValue = useProjectStore((s) =>
    isObjectTrack ? transformValue(s.tracks[track.id]?.params, TF_OPACITY) : 1,
  )
  const [panelAnchor, setPanelAnchor] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null)
  const [tagsAnchor, setTagsAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  // The fader needs real room: hide it (keeping the opener) when the label
  // column is too narrow for name + fader + buttons, so it never crowds the
  // M/S cluster out of alignment.
  const showFader = isObjectTrack && labelWidth - (LABEL_BASE_PX + depth * INDENT_PX) >= 210

  // Double-click the name → inline rename. Enter/blur commits, Esc cancels.
  const [renaming, setRenaming] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) renameRef.current?.select()
  }, [renaming])

  const isSelected = selectedTrackId === track.id || inMultiSelection

  // Tag badges are a second label line, shown only on deliberately-tall rows.
  const tagList = isObjectTrack ? track.tags ?? [] : []
  const showTagBadges = tagList.length > 0 && rowHeight >= TAG_BADGES_MIN_ROW_HEIGHT

  // Hovering the label plays the row's element in the shared preview popup
  // (the same warm canvas the library uses) - objects run their instrument,
  // mover/splitter/colorizer rows run their chain on the stand-in cube.
  const moverDefinition = track.type === 'mover'
    ? getMoverOrSplitterDefinition(track.moverId)
    : undefined
  const previewItem: InstrumentItem | null =
    track.type === 'base' && track.instrumentId
      ? { id: track.instrumentId, name: track.name, description: '', icon: null, kind: 'object' }
      : track.type === 'mover' && track.moverId
        ? {
            id: track.moverId,
            name: track.name,
            description: '',
            icon: null,
            kind: moverDefinition?.kind === 'colorizer' ? 'colorizer' : 'mover',
          }
        : track.type === 'splitter' && track.splitterId
          ? { id: track.splitterId, name: track.name, description: '', icon: null, kind: 'splitter' }
          : null
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enterLabel = (e: ReactMouseEvent) => {
    if (!previewItem || !canPreview(previewItem)) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      // The row previews the REAL project element (its settings, notes, and
      // mover chain - see buildProjectPreview); while the transport plays the
      // popup follows the song. The notes/inputValues ride along only as the
      // fallback when the row can't resolve to an object (e.g. an unrouted
      // mover), which drops to the generic library preview.
      const { beatsPerBar, totalBars } = useProjectStore.getState()
      const notes = flattenBlocks(track.blocks, beatsPerBar, totalBars)
      setInstrumentPreview({
        item: previewItem,
        anchor: { left: rect.right, top: rect.top },
        notes,
        sync: true,
        inputValues: track.inputValues,
        projectTrackId: track.id,
      })
    }, 150)
  }
  const leaveLabel = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    setInstrumentPreview(null)
  }
  useEffect(() => () => { if (previewTimer.current) clearTimeout(previewTimer.current) }, [])
  const hasChildren = track.childIds.length > 0
  const blockColor = track.type === 'audio' ? AUDIO_TRACK_COLOR : track.color
  const declaredMidiRows = track.type === 'audio'
    ? undefined
    : resolveDeclaredMidiRows(track, useProjectStore.getState())
  const previewRowPitches = declaredMidiRows?.rows.map((row) => row.pitch)
  // Automation, envelope and ability sub-rows render darker than their object; mover
  // (mover) lanes are first-class creative tracks and keep the normal surface.
  const isDarkenedRow = track.type === 'automation' || track.type === 'ability' || track.type === 'envelope'

  // While a copy/library drag is in progress, rows shift via liftOffset (with a
  // smooth transition) to open the insertion gap.
  const inCopyDrag = liftOffset !== undefined
  // The deepest curved guide marks the first child directly beneath its parent.
  // Its row-state surface follows that same corner instead of covering the curve.
  const isFirstChild = guides?.[guides.length - 1]?.curve === true

  return (
    <div
      style={{
        transform: inCopyDrag ? `translateY(${liftOffset}px)` : undefined,
        transition: inCopyDrag ? 'transform 0.15s ease' : undefined,
        opacity: dimmed ? 0.4 : 1,
        // During a copy-drag the shifted rows must sit above the empty label box
        // below them (z-10), or the bottom row hides under it as it reflows down.
        zIndex: inCopyDrag ? 15 : undefined,
        position: 'relative',
        height: rowHeight,
      }}
      className="flex items-stretch cursor-default transition-colors duration-100"
    >
      <div
        onClick={(e) => {
          // Track selection is the LABEL's job - the lane (timeline grid) never
          // selects or deselects a track. A drag that started here (nest/copy)
          // must not hijack the selection when its trailing click lands.
          if (shouldSuppressTrackSelect()) return
          // Shift-click selects the visible range from the primary selection.
          if (e.shiftKey) { selectTrackRange(track.id); return }
          // Ctrl/cmd-click builds a multi-selection (bulk delete).
          if (e.ctrlKey || e.metaKey) { toggleTrackInSelection(track.id); return }
          // No toggle: clicking the selected track keeps it selected. Foreign
          // selected blocks are pruned; this track's stay (utils/selection).
          selectTrack(track.id)
        }}
        onMouseEnter={enterLabel}
        onMouseLeave={leaveLabel}
        onPointerDownCapture={(e) => {
          leaveLabel()
          if (e.button !== 0) return
          // The M/S buttons are not drag handles; neither is the rename input
          // nor the transform strip's fader.
          if ((e.target as HTMLElement).closest('button, input, [data-strip-control]')) return
          // The audio track is pinned at the top - not draggable, not duplicable.
          if (track.type === 'audio') return
          // Alt+drag duplicates; a plain drag re-nests. Neither preventDefault on the
          // plain path, so a click without movement still selects the row.
          if (e.altKey) {
            e.stopPropagation()
            e.preventDefault()
            onCopyDragStart?.(e, track.id)
          } else {
            onNestDragStart?.(e, track.id)
          }
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onLabelContextMenu?.(e, track.id) }}
        style={{ width: labelWidth, paddingLeft: LABEL_BASE_PX + depth * INDENT_PX }}
        className="sticky left-0 z-20 flex-shrink-0 flex items-center gap-2 pr-3 border-r border-r-[var(--border)]"
      >
        {/* Row-state background, scoped to this row's own region: a child row's
            colour starts at its bracket line, never bleeding into a parent's
            strip. The strip below a parent (the indent gap left of its children)
            inherits this background, so selecting a parent lights its whole
            bracket region while a child's highlight stops at the divider. */}
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 transition-colors duration-100 ${isFirstChild ? 'rounded-tl-md' : ''} ${
            dropInto ? 'bg-[rgba(53,167,230,0.25)] ring-1 ring-inset ring-[var(--accent)]' : isSelected ? 'bg-[var(--bg-elevated)]' : 'bg-[var(--bg-track-row)]'
          }`}
          style={{ left: depth === 0 ? 0 : LABEL_BASE_PX + (depth - 1) * INDENT_PX }}
        >
          {descendantRows > 0 && (
            <span
              className="absolute left-0 top-full bg-inherit"
              style={{
                // The first child surface has a rounded top-left cutout. The
                // parent's strip always underpaints that radius - selected or
                // not - so the fill meets the curved divider without leaving
                // a bare notch.
                width: (depth === 0 ? LABEL_BASE_PX : INDENT_PX) + BRACKET_CORNER_RADIUS_PX,
                height: descendantRows * rowHeight,
              }}
            />
          )}
        </div>
        {/* Logic-style hierarchy brackets: each ancestor's border drops down the
            label past its children; on the first child it curves in from the
            divider above. Extends 1px above the row to paint over the previous
            row's divider so the vertical line reads as continuous. */}
        {guides?.map((g, level) => (
          <span
            key={level}
            className={`pointer-events-none absolute right-0 border-[var(--border)] border-l ${g.curve ? 'border-t rounded-tl-md' : ''}`}
            style={{ left: LABEL_BASE_PX + level * INDENT_PX, top: -1, bottom: 0 }}
          />
        ))}
        {/* Bottom divider, inset so it starts at the bracket it meets (never
            crossing a parent's bracket region); the divider above a first child
            is drawn by that child's curve instead. */}
        {dividerInset != null && (
          <span
            className="pointer-events-none absolute right-0 bottom-0 border-b border-b-[var(--border)]"
            style={{ left: dividerInset }}
          />
        )}
        {/* Name + its collapse toggle, grouped so the chevron hugs the name text
            (the empty space sits to their right, not between them). */}
        {/* Rows showing the opacity fader give it the free space (DAW-style
            channel strip); other rows keep it on the name as before. */}
        <div className={`relative ${showFader ? '' : 'flex-1'} min-w-0 flex ${showTagBadges ? 'flex-col justify-center' : 'items-center gap-1.5'}`}>
          {/* display:contents when single-line, so the name/chevron keep sitting
              directly in the row flex; a real flex row when badges add line 2. */}
          <div className={showTagBadges ? 'flex min-w-0 items-center gap-1.5' : 'contents'}>
          {renaming ? (
            <input
              ref={renameRef}
              defaultValue={track.name}
              onBlur={(e) => { renameTrack(track.id, e.currentTarget.value); setRenaming(false) }}
              onKeyDown={(e) => {
                e.stopPropagation() // keep Delete/Esc/space from the timeline + transport keys
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'Escape') { e.currentTarget.value = track.name; e.currentTarget.blur() }
              }}
              className="w-full min-w-0 select-text text-[11px] font-medium text-[var(--text)] bg-[var(--bg-app)] border border-[var(--border-strong)] rounded px-1 py-0 outline-none"
            />
          ) : (
            <span
              onDoubleClick={() => setRenaming(true)}
              title="Double-click to rename"
              className="text-[11px] font-medium truncate text-[var(--text)]"
            >
              {track.name}
            </span>
          )}
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); setTrackCollapsed(track.id, !isCollapsed) }}
              className="flex-shrink-0 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-2)] cursor-pointer"
              aria-label={isCollapsed ? 'Expand track' : 'Collapse track'}
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
          </div>
          {showTagBadges && (
            <div
              className="pointer-events-none mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden"
              title={tagList.join(', ')}
            >
              {tagList.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="flex-shrink-0 max-w-[64px] truncate rounded-[3px] border border-[var(--border)] bg-white/10 px-1 text-[9px] leading-[13px] text-[var(--text-3)]"
                >
                  {t}
                </span>
              ))}
              {tagList.length > 3 && (
                <span className="flex-shrink-0 px-1 text-[9px] leading-[13px] text-[var(--text-muted)]">
                  +{tagList.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        <div className={`relative flex items-center gap-1 ${showFader ? 'flex-1 min-w-0' : 'flex-shrink-0'}`} onClick={(e) => e.stopPropagation()}>
          {showFader && (
            <div
              data-strip-control
              role="slider"
              aria-label="Track opacity"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(opacityValue * 100)}
              title={`Opacity ${Math.round(opacityValue * 100)}% · drag · double-click = 100%`}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                const rect = e.currentTarget.getBoundingClientRect()
                beginTransformDrag(e, track.id, TF_OPACITY, OPACITY_FADER_SPEC, (ev) =>
                  (ev.clientX - rect.left) / rect.width,
                )
              }}
              onDoubleClick={() => resetTransformValues(track.id, [TF_OPACITY])}
              className="group mr-2 flex h-4 min-w-[48px] flex-1 cursor-ew-resize touch-none items-center px-[3px]"
            >
              {/* Logic-style horizontal fader: a THIN groove with a cap that
                  stands well taller than the track it rides. */}
              <div className="relative h-[3px] w-full rounded-full bg-black/55 shadow-[inset_0_1px_1px_rgba(0,0,0,0.65)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-l-full opacity-60 group-hover:opacity-80"
                  style={{ width: `${opacityValue * 100}%`, background: track.color }}
                />
                <div className="absolute left-1/2 top-[-3px] h-[2px] w-px bg-white/25" />
                <div
                  className="absolute top-1/2 h-[15px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-[2.5px] border border-black/65 bg-gradient-to-b from-[#e3e5ea] to-[#b9bcc4] shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                  style={{ left: `${opacityValue * 100}%` }}
                >
                  <div className="absolute inset-y-[2px] left-1/2 w-px -translate-x-1/2 bg-black/50" />
                </div>
              </div>
            </div>
          )}
          <button
            onPointerDown={(e) => {
              if (e.button !== 0) return
              startMsPaint('mute', !track.muted)
              toggleMute(track.id)
            }}
            onPointerEnter={() => {
              if (msPaint?.kind === 'mute' && track.muted !== msPaint.value) toggleMute(track.id)
            }}
            className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center transition-all active:scale-75 cursor-pointer ${
              track.muted
                ? 'bg-[var(--warn)] text-[var(--on-accent)]'
                : 'bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-2)]'
            }`}
          >
            M
          </button>
          <button
            onPointerDown={(e) => {
              if (e.button !== 0) return
              startMsPaint('solo', !track.solo)
              toggleSolo(track.id)
            }}
            onPointerEnter={() => {
              if (msPaint?.kind === 'solo' && track.solo !== msPaint.value) toggleSolo(track.id)
            }}
            className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center transition-all active:scale-75 cursor-pointer ${
              track.solo
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-2)]'
            }`}
          >
            S
          </button>
          {isObjectTrack && (
            <button
              aria-label="Edit tags"
              title={tagList.length > 0 ? `Tags: ${tagList.join(', ')}` : 'Tags'}
              data-tags-opener={track.id}
              onClick={(e) => {
                if (tagsAnchor) { setTagsAnchor(null); return }
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setTagsAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom })
              }}
              className={`w-4 h-4 rounded-[3px] flex items-center justify-center transition-all active:scale-75 cursor-pointer ${
                tagsAnchor
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : tagList.length > 0
                    ? 'bg-white/10 text-[var(--accent)] hover:text-[var(--accent-hover)]'
                    : 'bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-2)]'
              }`}
            >
              <Tag size={10} />
            </button>
          )}
          {isObjectTrack && (
            <button
              aria-label="Open transform panel"
              title="Transform"
              data-transform-opener={track.id}
              onClick={(e) => {
                if (panelAnchor) { setPanelAnchor(null); return }
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setPanelAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
              }}
              className={`w-4 h-4 rounded-[3px] flex items-center justify-center transition-all active:scale-75 cursor-pointer ${
                panelAnchor
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-2)]'
              }`}
            >
              <Move3d size={10} />
            </button>
          )}
        </div>
        {panelAnchor && isObjectTrack && (
          <TrackTransformPanel trackId={track.id} anchor={panelAnchor} onClose={() => setPanelAnchor(null)} />
        )}
        {tagsAnchor && isObjectTrack && (
          <TrackTagsPanel trackId={track.id} anchor={tagsAnchor} onClose={() => setTagsAnchor(null)} />
        )}
      </div>

      {/* Gutter (half a triangle wide) between the label and the lane so the ruler
          playhead triangle has room to show its left half at beat 0. The row
          divider lives on the gutter + lane (not the row itself), so the label
          column can inset its own divider around the hierarchy brackets. */}
      <div className={`flex-shrink-0 ${isLast ? '' : 'border-b border-[var(--border)]'}`} style={{ width: PLAYHEAD_TRIANGLE_HALF }} />

      <div
        data-track-lane={track.id}
        className={`relative flex-shrink-0 ${isDarkenedRow ? 'bg-black/10' : ''} ${isLast ? '' : 'border-b border-[var(--border)]'}`}
        // A muted track's blocks go gray (hue stripped, alpha kept) so the mute
        // state reads from the MIDI side without the blocks fading into the lane.
        style={{ width: timelineWidthPx, filter: track.muted ? 'grayscale(1)' : undefined }}
        // Audio lanes have no MIDI gestures (no right-click block drawing / marquee),
        // but clicking their empty space still deselects blocks, like any lane.
        onPointerDown={track.type === 'audio'
          ? (e) => { if (e.button === 0 && !e.shiftKey) useUIStore.getState().setSelectedBlockIds(new Set()) }
          : (e) => onLanePointerDown(e, track.id)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {track.type === 'audio'
          ? (track.audioBlocks ?? []).map((block) => (
              <AudioBlock
                key={block.id}
                block={block}
                trackId={track.id}
                barWidthPx={barWidthPx}
                beatsPerBar={beatsPerBar}
                color={blockColor}
                showOscilloscope={isPlaying}
              />
            ))
          : track.blocks.map((block) => (
              <Block
                key={block.id}
                block={block}
                trackId={track.id}
                barWidthPx={barWidthPx}
                beatsPerBar={beatsPerBar}
                color={blockColor}
                isSelected={selectedBlockIds.has(block.id)}
                muted={track.muted}
                previewRowPitches={previewRowPitches}
                strictPreviewRows={declaredMidiRows?.strict}
                onBlockPointerDown={onBlockPointerDown}
              />
            ))}
        {/* A loop drag hovering this lane "becomes" its MIDI block: the
            would-be block, drawn where release will land it. */}
        {loopDragHere && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 flex items-center justify-center rounded border border-dashed border-[var(--accent)] bg-[rgba(53,167,230,0.2)]"
            style={{ left: loopDragHere.target!.bar * barWidthPx, width: loopDragHere.durationBars * barWidthPx }}
          >
            <span className="truncate px-1.5 font-mono text-[10px] text-[var(--accent)]">{loopDragHere.name}</span>
          </div>
        )}
      </div>
    </div>
  )
}
