import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Move3d, Tag } from 'lucide-react'
import { useUIStore } from '../../store/UIStore'
import { withAlpha } from '../../userInterfaceRenderers/colorWheel'
import { useProjectStore } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { Block } from './Block'
import { AudioBlock } from './AudioBlock'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { BRACKET_CORNER_RADIUS_PX, INDENT_PX, LABEL_BASE_PX, rowIndentPx } from './trackDrop'
import type { RowGuide } from './trackTree'
import { resolveTrackDisplayColor, resolveTrackIdentityColor } from '../../utils/trackDisplayColor'
import { midiSelectionSpill } from '../../utils/colors'
import { trackChromeColor } from '../../utils/trackChromeColor'
import { selectTrack, selectTrackRange, shouldSuppressTrackSelect, toggleTrackInSelection } from '../../utils/selection'
import { getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { canPreview, clearInstrumentPreviewFor, setInstrumentPreview } from '../instrumentPreviewStore'
import { flattenBlocks } from '../../core/visual/noteFlatten'
import { carriesLyricClips } from '../../core/visual/lyricClips'
import { resolveDeclaredMidiRows } from '../midi/resolveDeclaredRows'
import type { InstrumentItem } from '../LeftSidebar'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { Track as TrackType } from '../../types'
import { TrackLivePreview } from './TrackLivePreview'
import { TrackIcon, TRACK_ICON_WIDTH } from './TrackIcon'
import { trackGlyph } from './trackGlyphs'
import { TrackTransformPanel, beginTransformDrag, resetTransformValues, transformValue } from './TrackTransformPanel'
import { TrackTagsPanel } from './TrackTagsPanel'
import { TF_OPACITY } from '../../core/transform'
import { isSceneTrackId } from '../../core/sceneTrack'

// The strip fader is the track's "volume": opacity 0..1, snapping at 0/50/100%.
const OPACITY_FADER_SPEC = { min: 0, max: 1, step: 0.01, snaps: [0, 0.5, 1], snapThreshold: 0.03 }

// Logic-style M/S painting: pointer-down on a button starts a stroke, and every
// button of the SAME kind the pointer crosses while held gets the first
// toggle's resulting state (painted, not flipped - sweeps stay predictable).
// Module-level on purpose: one stroke spans many Track instances.
let msPaint: { kind: 'mute' | 'solo'; value: boolean } | null = null

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
  /** Pickup width (px): musical bar 0 sits this far into the lane. All block
   *  space is shifted right by this much; audio in the pickup has startBar < 0. */
  pickupPx: number
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
  /** This row is the source of an in-progress nest-drag: it stays as the hole the
   *  track came out of, so only its CONTENT fades (see `ghostOpacity`). */
  dimmed?: boolean
  /** This row is the live nest-into target (highlight it). */
  dropInto?: boolean
  /** This row is a library drag's swap-in-place target: preview the FUTURE row -
   *  the incoming instrument's name and its post-swap display color on the name,
   *  blocks, and a whole-row wash - so the drop shows exactly what it commits.
   *  Only the one targeted row receives this; undefined stays referentially
   *  stable for every other row (the memo contract). */
  replacePreview?: { name: string; color: string }
  /** Begin an Alt copy-drag from this track's label. */
  onCopyDragStart?: (e: ReactPointerEvent, trackId: string) => void
  /** Begin a drag-to-nest from this track's label. */
  onNestDragStart?: (e: ReactPointerEvent, trackId: string) => void
  /** Right-click on the label - opens the add-ability / add-automation menu. */
  onLabelContextMenu?: (e: ReactMouseEvent, trackId: string) => void
}

/** Memoized: the timeline re-renders on every ProjectStore write (every
 *  pointermove of a drag), and rows whose track didn't change must skip. All
 *  props stay referentially stable across foreign edits - `track` by the
 *  store's per-track immutability, `guides` via TimelineArea's rowsKey memo,
 *  handlers via useCallback - and the row's own store subscriptions all
 *  select primitives. `trackPropsEqual` (below) is memo's shallow compare
 *  plus one refinement for the selection Set. */
export const Track = memo(function Track({ track, barWidthPx, pickupPx, selectedBlockIds, onBlockPointerDown, onLanePointerDown, isLast, depth = 0, guides, dividerInset, descendantRows = 0, liftOffset, dimmed, dropInto, replacePreview, onCopyDragStart, onNestDragStart, onLabelContextMenu }: TrackProps) {
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  // Audio lanes only need this for the selection spill's geometry (an audio
  // block's width is derived from its trimmed seconds at the current tempo).
  const bpm = useProjectStore((s) => s.bpm)
  const isPlaying = useTimeStore((s) => s.isPlaying)

  // A boolean, not the id: selecting some OTHER row must not re-render this one.
  const isPrimarySelected = useUIStore((s) => s.selectedTrackId === track.id)
  const inMultiSelection = useUIStore((s) => s.selectedTrackIds.has(track.id))
  const loopDragHere = useUIStore((s) => (s.loopDrag?.target?.trackId === track.id ? s.loopDrag : null))
  const labelWidth = useUIStore((s) => s.tracksLabelWidth)
  const setTrackCollapsed = useUIStore((s) => s.setTrackCollapsed)
  const isCollapsed = useUIStore((s) => s.collapsedTrackIds.has(track.id))
  const toggleMute = useProjectStore((s) => s.toggleMute)
  const toggleSolo = useProjectStore((s) => s.toggleSolo)
  const renameTrack = useProjectStore((s) => s.renameTrack)

  // The transform strip (opacity fader + panel opener) exists on object tracks
  // only. Main's rows are composition tracks - base-typed with an instrumentId,
  // but with no object behind them - so the active scene gates the whole strip
  // (all Main tracks are composition tracks by the moveTrackToScene invariant,
  // and crop-in-a-scene keeps its fader this way).
  const activeIsMain = useProjectStore((s) => !!s.scenes[s.activeSceneId]?.isMain)
  const isObjectTrack = track.type === 'base' && !!track.instrumentId && !activeIsMain
  // The scene instrument (core/sceneTrack.ts) materializes as a group track, so
  // it takes the group chrome - the transform strip especially, since its tf*
  // moves the whole scene - but not the parts that would write a field it has
  // nowhere to store: its name is the scene's, and it has no mute/solo.
  const isSceneTrack = isSceneTrackId(track.id)
  // Groups wear the same canonical transform strip (their tf* inherits to the
  // whole subtree); tags and hover previews stay object-only.
  // A switcher is a placement node too (resolve.ts gives it a ResolvedGroup),
  // so a rack can be positioned as one exactly like a group.
  const hasTransform = isObjectTrack
    || ((track.type === 'group' || track.type === 'switcher') && !activeIsMain)
  const opacityValue = useProjectStore((s) =>
    hasTransform ? transformValue(s.tracks[track.id]?.params, TF_OPACITY) : 1,
  )
  const [panelAnchor, setPanelAnchor] = useState<{ left: number; right: number; top: number; bottom: number } | null>(null)
  const [tagsAnchor, setTagsAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  // The fader needs real room: hide it (keeping the opener) when the label
  // column is too narrow for name + fader + buttons, so it never crowds the
  // M/S cluster out of alignment. The icon slot eats into that room, so it is
  // part of the sum - otherwise adding icons silently shrinks the name instead.
  const showLivePreview = track.type !== 'audio' && labelWidth - depth * INDENT_PX >= 216
  const showFader = hasTransform
    && labelWidth - (LABEL_BASE_PX + depth * INDENT_PX) >= 210 + TRACK_ICON_WIDTH + (showLivePreview ? 64 : 0)

  // Double-click the name → inline rename. Enter/blur commits, Esc cancels.
  const [renaming, setRenaming] = useState(false)
  const renameRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) renameRef.current?.select()
  }, [renaming])

  const isSelected = isPrimarySelected || inMultiSelection

  // Shift-hover in the visualizer lights this row (CanvasHoverPicker).

  const canvasHovered = useUIStore((s) => s.canvasHover?.trackId === track.id)

  // The grid owns row height. Only crossing the tag threshold needs React
  // work here; ordinary zoom steps must not rebuild every track control.
  const tagList = isObjectTrack ? track.tags ?? [] : []
  const showTagBadges = useUIStore((s) => tagList.length > 0 && s.tracksRowHeight >= TAG_BADGES_MIN_ROW_HEIGHT)

  // Hovering the label plays the row's element in the shared preview popup
  // (the same warm canvas the library uses) - objects run their instrument,
  // mover/splitter/colorizer rows run their chain on the stand-in cube.
  const moverDefinition = track.type === 'mover'
    ? getMoverOrSplitterDefinition(track.moverId)
    : undefined
  const previewItem: InstrumentItem | null =
    isObjectTrack
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
      const notes = flattenBlocks(track.blocks, beatsPerBar, totalBars, carriesLyricClips(track))
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
  // Deleting the row skips mouseleave entirely, so unmount also dismisses a
  // preview this row put up (and only its own - see clearInstrumentPreviewFor).
  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    clearInstrumentPreviewFor(track.id)
  }, [track.id])
  const hasChildren = track.childIds.length > 0
  // The row's own identity: its definition's declared color for a mover /
  // splitter / colorizer, the instrument's for an object, else its hue cycle.
  // Derived purely from the `track` prop, so no store subscription is needed.
  // A live replace-drop previews the post-swap identity instead, so the row
  // (name, blocks, wash) shows the future the drop commits.
  const blockColor = replacePreview?.color ?? resolveTrackDisplayColor(track)
  // Icons and faders share the real identity, with neutrals kept readable.
  const identityColor = replacePreview?.color ?? resolveTrackIdentityColor(track)
  // Recomputed only when THIS track changes, and the pitch array keeps its
  // identity (it is a prop of every memoized Block and a dep of their activity
  // effects). Mover-lane rows technically also depend on sibling chains for
  // their prior copy count; a sibling edit leaves this preview stale until the
  // track itself changes - cosmetic row placement, accepted so foreign edits
  // don't touch this row (the full MIDI editor resolves its own rows fresh).
  const declaredRows = useMemo(() => {
    const declared = track.type === 'audio'
      ? undefined
      : resolveDeclaredMidiRows(track, useProjectStore.getState())
    return {
      previewRowPitches: declared?.rows.map((row) => row.pitch),
      strictPreviewRows: declared?.strict,
    }
  }, [track])
  // Keyed on `track`, so a block drag on this row recomputes every move - but
  // the pitches themselves almost never change. Hand every Block the SAME
  // array while its contents are equal, or the row's memoized blocks (and
  // their activity registrations) churn on every pointermove.
  const stablePitchesRef = useRef<number[] | undefined>(undefined)
  const previewRowPitches = useMemo(() => {
    const next = declaredRows.previewRowPitches
    const prev = stablePitchesRef.current
    if (prev && next && prev.length === next.length && prev.every((p, i) => p === next[i])) return prev
    stablePitchesRef.current = next
    return next
  }, [declaredRows])
  const strictPreviewRows = declaredRows.strictPreviewRows
  // Automation and ability sub-rows render darker than their object; mover
  // and word-formation lanes are first-class creative tracks - you sequence them and
  // they carry their own geometry - so they keep the normal surface.
  const isDarkenedRow = track.type === 'automation' || track.type === 'ability'

  // While a copy/library drag is in progress, rows shift via liftOffset (with a
  // smooth transition) to open the insertion gap.
  const inCopyDrag = liftOffset !== undefined
  // The deepest curved guide marks the first child directly beneath its parent.
  // Its row-state surface follows that same corner instead of covering the curve.
  const isFirstChild = guides?.[guides.length - 1]?.curve === true

  // This row's bracket region: it starts at its parent's bracket line and, once it
  // has visible children, continues down the indent gap beside them.
  const regionLeft = rowIndentPx(depth)
  // Where this row's OWN children bracket - the x its bottom line bends down at.
  const childBracketLeft = rowIndentPx(depth + 1)
  // A nest-into highlight must wear that same bent outline: top/left/right on the
  // row, and a bottom line only where the chrome would draw one. A row with visible
  // children has none - its outline turns the corner at the child bracket and runs
  // down beside the children (the two spans below), so a straight full-width bottom
  // border would cut through the region the drop is actually offering.
  const wrapsChildren = descendantRows > 0
  // The nest-drag's source row is the PLACEHOLDER for where the track sits now, so
  // it must keep looking like a row of the stack: fading the whole row (opacity on
  // the wrapper) took the label chrome with it - the ancestor bracket lines broke
  // for exactly this row's height, and the row's own translucent background let the
  // near-black lane surface through while the parent's strip in the indent gap
  // beside it stayed opaque, which reads as a left margin appearing mid-drag. Only
  // the CONTENT (name, controls, blocks) ghosts; background, brackets and dividers
  // stay at full strength.
  const ghostOpacity = dimmed ? 0.4 : undefined
  const dropOutline = [
    'inset 0 1px 0 0 var(--accent)',
    'inset 1px 0 0 0 var(--accent)',
    'inset -1px 0 0 0 var(--accent)',
    ...(wrapsChildren ? [] : ['inset 0 -1px 0 0 var(--accent)']),
  ].join(', ')

  return (
    <div
      style={{
        transform: inCopyDrag ? `translateY(${liftOffset}px)` : undefined,
        transition: inCopyDrag ? 'transform 0.15s ease' : undefined,
        // During a copy-drag the shifted rows must sit above the empty label box
        // below them (z-10), or the bottom row hides under it as it reflows down.
        zIndex: inCopyDrag ? 15 : undefined,
        position: 'relative',
      }}
      className="flex items-stretch cursor-default"
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
          // The transform/tags popovers portal to document.body but still route
          // their events through this React subtree - and this capture handler
          // runs BEFORE their own stopPropagation can. A target that isn't a
          // DOM descendant of the label came through a portal: not a drag handle.
          if (!e.currentTarget.contains(e.target as Node)) return
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
        className={`sticky left-0 flex-shrink-0 flex items-center gap-2 pr-3 border-r border-r-[var(--timeline-row-line,var(--border))] ${
          // Rows all sit at z-20, so later ones (this row's children) paint over it.
          // The nest-into outline has to reach past them to draw the bend.
          dropInto ? 'z-[25]' : 'z-20'
        }`}
      >
        {/* Row-state background, scoped to this row's own region: a child row's
            colour starts at its bracket line, never bleeding into a parent's
            strip. The strip below a parent (the indent gap left of its children)
            inherits this background, so selecting a parent lights its whole
            bracket region while a child's highlight stops at the divider. */}
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 ${isFirstChild ? 'rounded-tl-md' : ''} ${
            dropInto ? 'bg-[rgba(53,167,230,0.25)]' : isSelected ? 'bg-[var(--bg-elevated)]' : 'bg-[var(--bg-track-row)]'
          }`}
          style={{
            left: regionLeft,
            boxShadow: dropInto ? dropOutline : canvasHovered ? `inset 0 0 0 1px ${withAlpha(blockColor, 0.75)}` : undefined,
            // The visualizer's Shift-hover wash, in the row's own color so the
            // glow on the canvas and the row it names read as one thing.
            backgroundColor: canvasHovered && !dropInto ? withAlpha(blockColor, 0.22) : undefined,
          }}
        >
          {wrapsChildren && (
            <span
              className="absolute left-0 top-full bg-inherit"
              style={{
                // The first child surface has a rounded top-left cutout. The
                // parent's strip always underpaints that radius - selected or
                // not - so the fill meets the curved divider without leaving
                // a bare notch.
                width: childBracketLeft - regionLeft + BRACKET_CORNER_RADIUS_PX,
                // Relative to this row, so the bracket follows grid sizing.
                height: `${descendantRows * 100}%`,
              }}
            />
          )}
        </div>
        {/* The nest-into outline's bent half, drawn over the children's own chrome
            (hence the raised z on the label): the row's bottom line turns the corner
            at the child bracket and runs down beside the children - the very corner
            the first child's guide draws - and the region's left edge closes it off
            under the last one. Without this the blue border cut straight across the
            row while its fill continued past it, beside the children. */}
        {dropInto && wrapsChildren && (
          <>
            <span
              className="pointer-events-none absolute right-0 rounded-tl-md border-l border-t border-[var(--accent)]"
              style={{ left: childBracketLeft, top: '100%', height: `${descendantRows * 100}%` }}
            />
            <span
              className="pointer-events-none absolute border-b border-l border-[var(--accent)]"
              style={{
                left: regionLeft,
                top: '100%',
                width: childBracketLeft - regionLeft,
                height: `${descendantRows * 100}%`,
              }}
            />
          </>
        )}
        {/* Logic-style hierarchy brackets: each ancestor's border drops down the
            label past its children; on the first child it curves in from the
            divider above. Extends 1px above the row to paint over the previous
            row's divider so the vertical line reads as continuous.
            The DEEPEST guide is this row's own parent bracket, drawn at exactly
            `regionLeft` - the same pixel as the nest-into outline's left border,
            and painted after it. On a nested target that hid the blue line down
            the whole row (only a root row, which has no guides, looked right), so
            the guide wears the accent while the drop is offered: same geometry,
            including the first-child corner, in the outline's colour. */}
        {guides?.map((g, level) => {
          const isOwnBracket = level === guides.length - 1
          const asOutline = dropInto && isOwnBracket
          return (
            <span
              key={level}
              className={`pointer-events-none absolute right-0 border-l ${
                asOutline ? 'border-[var(--accent)]' : 'border-[var(--timeline-row-line,var(--border))]'
              } ${g.curve ? 'border-t rounded-tl-md' : ''}`}
              style={{ left: LABEL_BASE_PX + level * INDENT_PX, top: asOutline ? 0 : -1, bottom: 0 }}
            />
          )
        })}
        {/* Bottom divider, inset so it starts at the bracket it meets (never
            crossing a parent's bracket region); the divider above a first child
            is drawn by that child's curve instead. */}
        {dividerInset != null && (
          <span
            className="pointer-events-none absolute right-0 bottom-0 border-b border-b-[var(--timeline-row-line,var(--border))]"
            style={{ left: dividerInset }}
          />
        )}
        {/* The instrument mark. Its shape comes from the track (a pure function,
            no subscription); its color is the row's own display color, so a
            replace-drop previews the incoming instrument's color here too.
            `relative` is LOAD-BEARING, not tidiness: the row-state background a
            few lines up is an absolutely positioned sibling, and a positioned
            element paints above every non-positioned in-flow box regardless of
            DOM order. A static icon slot therefore reserved its width and then
            rendered UNDERNEATH the opaque background - a gap where the mark
            should be, which reads as the glyph failing to draw. Every other
            content box in this label (the name group, the control cluster)
            carries `relative` for the same reason. */}
        <span className="relative flex flex-shrink-0 items-center" style={{ opacity: ghostOpacity }}>
          <TrackIcon glyph={trackGlyph(track, activeIsMain)} color={identityColor} muted={isDarkenedRow} gradient={track.moverId === 'gradient' ? (track.inputValues?.flip ?? 0) >= 0.5 ? [track.stringParams?.colorB ?? '#ff4d88', track.stringParams?.colorA ?? '#4dd2ff'] : [track.stringParams?.colorA ?? '#4dd2ff', track.stringParams?.colorB ?? '#ff4d88'] : undefined} />
        </span>
        {/* Name + its collapse toggle, grouped so the chevron hugs the name text
            (the empty space sits to their right, not between them). */}
        {/* Rows showing the opacity fader give it the free space (DAW-style
            channel strip); other rows keep it on the name as before. */}
        <div
          style={{ opacity: ghostOpacity }}
          className={`relative ${showFader ? '' : 'flex-1'} min-w-0 flex ${showTagBadges ? 'flex-col justify-center' : 'items-center gap-1.5'}`}
        >
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
              onDoubleClick={isSceneTrack ? undefined : () => setRenaming(true)}
              title={isSceneTrack ? 'The scene itself - rename it on its tab' : 'Double-click to rename'}
              className="text-[11px] font-medium truncate text-[var(--text)]"
            >
              {replacePreview?.name ?? track.name}
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

        <div
          style={{ opacity: ghostOpacity }}
          className={`relative flex items-center gap-1 ${showFader ? 'flex-1 min-w-0' : 'flex-shrink-0'}`}
          onClick={(e) => e.stopPropagation()}
        >
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
                  className="absolute inset-y-0 left-0 rounded-l-full opacity-90 group-hover:opacity-100"
                  style={{ width: `${opacityValue * 100}%`, background: trackChromeColor(identityColor) }}
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
          {/* No M/S on the scene instrument: it is virtual (core/sceneTrack.ts)
              and carries no mute/solo field, so the buttons would toggle a
              value the next materialization throws away. */}
          {!isSceneTrack && (
          <>
          <button
            onPointerDown={(e) => {
              if (e.button !== 0) return
              startMsPaint('mute', !track.muted)
              toggleMute(track.id)
            }}
            onPointerEnter={() => {
              if (msPaint?.kind === 'mute' && track.muted !== msPaint.value) toggleMute(track.id)
            }}
            className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center active:scale-75 cursor-pointer ${
              track.muted
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
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
            className={`w-4 h-4 rounded-[3px] text-[9px] font-bold flex items-center justify-center active:scale-75 cursor-pointer ${
              track.solo
                ? 'bg-[var(--warn)] text-[var(--on-accent)]'
                : 'bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-2)]'
            }`}
          >
            S
          </button>
          </>
          )}
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
              className={`w-4 h-4 rounded-[3px] flex items-center justify-center active:scale-75 cursor-pointer ${
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
          {hasTransform && (
            <button
              aria-label="Open transform panel"
              title="Transform"
              data-transform-opener={track.id}
              onClick={(e) => {
                if (panelAnchor) { setPanelAnchor(null); return }
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setPanelAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
              }}
              className={`w-4 h-4 rounded-[3px] flex items-center justify-center active:scale-75 cursor-pointer ${
                panelAnchor
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-2)]'
              }`}
            >
              <Move3d size={10} />
            </button>
          )}
        </div>
        {showLivePreview && <TrackLivePreview trackId={track.id} />}
        {panelAnchor && hasTransform && (
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
      <div className={`flex-shrink-0 ${isLast ? '' : 'border-b border-[var(--timeline-row-line,var(--border))]'}`} style={{ width: PLAYHEAD_TRIANGLE_HALF }} />

      <div
        data-track-lane={track.id}
        // flex-1, not an explicit `width: timelineWidthPx`: the row's flex
        // parent already has the full content width, so the lane filling the
        // remainder is the same pixels - without the row taking a prop that
        // changes whenever the project auto-grows. During a block drag toward
        // the song end every totalBars bump re-rendered EVERY row for what is
        // purely a CSS width change (measured 2026-08-19: 4 bumps x the whole
        // stack, the bulk of the drag's foreign-row renders).
        className={`relative flex-1 ${isDarkenedRow ? 'bg-black/10' : ''} ${isLast ? '' : 'border-b border-[var(--timeline-row-line,var(--border))]'}`}
        // A muted track's blocks go gray (hue stripped, alpha kept) so the mute
        // state reads from the MIDI side without the blocks fading into the lane.
        style={{ filter: track.muted ? 'grayscale(1)' : undefined }}
        // Audio lanes have no MIDI gestures (no right-click block drawing / marquee),
        // but clicking their empty space still deselects blocks, like any lane.
        onPointerDown={track.type === 'audio'
          ? (e) => { if (e.button === 0 && !e.shiftKey) useUIStore.getState().setSelectedBlockIds(new Set()) }
          : (e) => onLanePointerDown(e, track.id)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Block space is offset by the pickup: bar 0 of the music sits pickupPx
            into the lane, so audio with startBar < 0 still renders on-lane
            (flush with the left edge when it defines the pickup). */}
        <div className="absolute inset-y-0" style={{ left: pickupPx, right: 0, opacity: ghostOpacity }}>
        {/* Audio retains its selection wash; solid MIDI clips use only their
            own perimeter. Audio widths follow trimmed seconds at this tempo. */}
        {(track.type === 'audio'
          ? (track.audioBlocks ?? []).map((block) => {
              if (!selectedBlockIds.has(block.id)) return null
              const widthBars = ((block.trimEnd - block.trimStart) * bpm) / 60 / beatsPerBar
              const widthPx = Math.max(widthBars * barWidthPx, 4)
              return { id: block.id, centerPx: block.startBar * barWidthPx + widthPx / 2, widthPx }
            })
          : []
        ).map((spill) =>
          spill && (
            <div
              key={`spill:${spill.id}`}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{ background: midiSelectionSpill(blockColor, spill.centerPx, spill.widthPx) }}
            />
          ))}
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
                name={replacePreview?.name ?? track.name}
                barWidthPx={barWidthPx}
                beatsPerBar={beatsPerBar}
                color={blockColor}
                isSelected={selectedBlockIds.has(block.id)}
                muted={track.muted}
                previewRowPitches={previewRowPitches}
                strictPreviewRows={strictPreviewRows}
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
      {/* Replace-drop preview: a whole-row wash + inset hairline in the incoming
          instrument's post-swap color, over label and lane alike (the swap
          changes the whole row, so the state reads row-wide - unlike the
          nest-into highlight, which is the label's). Above the sticky label
          (z-20) so the hairline runs unbroken across the seam. */}
      {replacePreview && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30"
          style={{
            background: `color-mix(in srgb, ${replacePreview.color} 13%, transparent)`,
            boxShadow: `inset 0 0 0 1px ${replacePreview.color}`,
          }}
        />
      )}
    </div>
  )
}, trackPropsEqual)

/** memo's shallow compare, except `selectedBlockIds`: the row reads the
 *  selection only through its own blocks (`has(id)` for each Block's
 *  isSelected and the spill geometry), so a new Set that agrees with the old
 *  one about every block ON THIS ROW must not re-render it. Compared by
 *  identity, one selection write swept every row in the timeline - measured
 *  2026-08-19: one whole-stack Track render per selection change during a
 *  block drag. The membership check is only reached when `track` is identical
 *  (the loop above), so both sides are asked about the same block list. */
function trackPropsEqual(prev: TrackProps, next: TrackProps) {
  for (const k of Object.keys(next) as (keyof TrackProps)[]) {
    if (k === 'selectedBlockIds') continue
    if (!Object.is(prev[k], next[k])) return false
  }
  if (prev.selectedBlockIds !== next.selectedBlockIds) {
    const blocks = next.track.type === 'audio' ? next.track.audioBlocks ?? [] : next.track.blocks
    for (const b of blocks) {
      if (prev.selectedBlockIds.has(b.id) !== next.selectedBlockIds.has(b.id)) return false
    }
  }
  return true
}
