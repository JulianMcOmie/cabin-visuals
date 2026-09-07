import { useUIStore } from '../../store/UIStore'
import { loopLengthBeats, tileLoopNotes } from '../../core/visual/noteFlatten'
import { LOOP_CURSOR } from '../../utils/dragCursor'
import { BLOCK_EDGE_HIT, edgeHitPx } from '../../constants'
import { graphiteMidiBlockPalette, type MidiBlockPalette } from '../../utils/colors'
import { notePreviewPitchPositions } from '../../core/visual/notePreviewLayout'
import { memo, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Block as BlockType } from '../../types'
import { createMidiActivityBlock, type MidiActivityRegistration } from './midiActivityRegistry'
import { observeTimelineViewport } from './observeTimelineViewport'

interface BlockProps {
  block: BlockType
  trackId: string
  barWidthPx: number
  beatsPerBar: number
  color: string
  isSelected: boolean
  /** Muted tracks don't pulse on note hits (they're greyed and silent). */
  muted?: boolean
  /** Semantic MIDI row order from the full editor (first pitch = top). */
  previewRowPitches?: number[]
  /** Hide pitches outside the declared vocabulary, matching strict editors. */
  strictPreviewRows?: boolean
  onBlockPointerDown: (e: ReactPointerEvent, trackId: string, blockId: string) => void
}

/** Memoized: during a drag every pointermove rewrites the store, and only the
 *  dragged block's identity changes - every other block must skip. Depends on
 *  Track keeping `previewRowPitches` and the handlers referentially stable. */
export const Block = memo(function Block({ block, trackId, barWidthPx, beatsPerBar, color, isSelected, muted, previewRowPitches, strictPreviewRows, onBlockPointerDown }: BlockProps) {
  const isEditing = useUIStore((s) => s.editingBlock?.blockId === block.id)
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  const blockRef = useRef<HTMLDivElement>(null)
  const activityRef = useRef<MidiActivityRegistration | null>(null)
  const visibleRef = useRef(false)
  useEffect(() => {
    const element = blockRef.current
    if (!element) return
    return observeTimelineViewport(element, visible => {
      // Visibility is transient browser state, not a React render. Keep the
      // observer alive across edits; its callback uses the current activity.
      visibleRef.current = visible
      element.toggleAttribute('data-midi-offscreen', !visible)
      activityRef.current?.setVisible(visible)
    })
  }, [])

  const left = block.startBar * barWidthPx
  const width = block.durationBars * barWidthPx
  const renderedWidth = Math.max(width, 4)
  const totalBeatsInBlock = block.durationBars * beatsPerBar
  const loopBeats = block.loop ? loopLengthBeats(block, beatsPerBar) : null
  const hasLoopSections = loopBeats != null && loopBeats > 0 && loopBeats < totalBeatsInBlock
  // Stable object: NotePreview is memoized and takes the palette as a prop.
  const palette = useMemo(() => graphiteMidiBlockPalette(color), [color])
  const active = isSelected || isEditing

  // Graphite body in both states; the perimeter is painted above the
  // loop sections so their opaque fills cannot hide the selection outline.

  useEffect(() => {
    const element = blockRef.current
    if (!element) return
    const activity = createMidiActivityBlock(block, beatsPerBar, element, muted)
    activityRef.current = activity
    activity.setVisible(visibleRef.current)
    return () => { activityRef.current = null; activity.dispose() }
  }, [beatsPerBar, block, muted, previewRowPitches, strictPreviewRows, active])

  return (
    <div
      ref={blockRef}
      data-block-id={block.id}
      data-midi-offscreen=""
      data-looped-block={hasLoopSections ? '' : undefined}
      title="Double-click to edit notes"
      className="absolute top-0 bottom-0 overflow-hidden rounded-[6px]"
      style={{
        left: `${left}px`,
        width: `${renderedWidth}px`,
        background: hasLoopSections ? 'transparent' : active ? palette.selectedBody : palette.fill,
        // Nothing on THIS element moves per frame any more - no filter, no
        // blend mode, no per-frame background. The pulse lives entirely in the
        // MattePulse overlay below, whose opacity the compositor can animate
        // without repainting anything.
      }}
      onPointerDown={(e) => onBlockPointerDown(e, trackId, block.id)}
      onPointerMove={(e) => {
        // Measure relative to the block (currentTarget), not offsetX - offsetX is
        // relative to whatever child is under the pointer (e.g. a note sliver).
        const rect = e.currentTarget.getBoundingClientRect()
        const w = rect.width
        // Same zone the gesture uses (useTrackGestures) - shared so the cursor
        // can't advertise a handle the pointerdown wouldn't honour.
        const edge = edgeHitPx(w, BLOCK_EDGE_HIT)
        const localX = e.clientX - rect.left
        const onRightEdge = localX > w - edge
        const onLeftEdge = localX < edge
        // The top half of the right edge arms looping (drag past the pattern to
        // repeat) - dedicated loop icon cursor. The bottom half and
        // the left edge are plain resizes; the body is a move (default).
        const topHalf = e.clientY < rect.top + rect.height / 2
        const onLoopHandle = onRightEdge && topHalf
        e.currentTarget.style.cursor =
          onLoopHandle ? LOOP_CURSOR : onRightEdge || onLeftEdge ? 'ew-resize' : 'default'
        // Tooltip tracks the zone under the pointer (updated live so it swaps as
        // you cross the halves): the right edge splits top = loop, bottom =
        // resize; the left edge resizes; the body opens the editor.
        e.currentTarget.title = onLoopHandle
          ? 'Drag to loop'
          : onRightEdge
            ? 'Drag to resize'
          : onLeftEdge
            ? 'Drag to resize'
            : 'Double-click to edit notes'
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditingBlock({ trackId, blockId: block.id })
      }}
    >
      {!hasLoopSections && !active && <MattePulse color={palette.activeFill} />}
      <NotePreview
        notes={block.notes}
        totalBeats={totalBeatsInBlock}
        loopBeats={loopBeats}
        palette={palette}
        selected={isSelected || isEditing}
        rowPitches={previewRowPitches}
        strictRows={strictPreviewRows}
      />
      {!hasLoopSections && <BlockOutline color={active ? palette.selectedOutline : palette.edge} selected={active} />}
    </div>
  )
})

/** Draw the rounded section perimeter without vertical seams between repeats.
 *  Only internal straight sides are masked away; their curved top/bottom
 *  corners remain, so the outline follows the divot instead of bridging it. */
function BlockOutline({ color, selected, first = true, last = true }: { color: string; selected?: boolean; first?: boolean; last?: boolean }) {
  const masks = ['linear-gradient(to bottom, #000 6px, transparent 6px, transparent calc(100% - 6px), #000 calc(100% - 6px))']
  if (first) masks.push('linear-gradient(to right, #000 6px, transparent 6px)')
  if (last) masks.push('linear-gradient(to left, #000 6px, transparent 6px)')
  return <div
    aria-hidden="true"
    data-midi-outline=""
    className="absolute inset-0 pointer-events-none rounded-[6px]"
    style={{ border: `${selected ? 2 : 1}px solid ${color}`, maskImage: masks.join(', ') }}
  />
}

// Preview divs per looped block stay bounded; a tiny pattern in a huge block
// caps out instead of flooding the DOM.
const PREVIEW_NOTE_CAP = 512

/**
 * The block's playing pulse: a flat wash of the track's `activeFill` faded in
 * over the resting pane. Matte by construction - one opaque colour at an alpha,
 * the move the MIDI editor's own chrome makes (`regionTint`, `marqueeFill`) -
 * where the old pulse was light: a `brightness()` filter plus a screen-blended
 * overlay.
 *
 * **Opacity is the point, not just the look.** Of everything that could say
 * "this block is sounding right now", opacity is the only property the
 * compositor can animate without repainting, so a promoted overlay costs
 * nothing per frame. Walking the pane's own background-colour instead renders
 * identically and was measured at ~920ms of raster per 6s of playback on an
 * 80-block project: a paint change on hundreds of unpromoted elements
 * re-rasters every tile they cover, filter or no filter. That is the same trap
 * the `brightness()` filter fell into, one layer down - which is why "make it
 * matte" and "make it cheap" turned out to be different problems.
 *
 * `will-change: opacity` is applied by the registry only while the transport
 * runs: an imperative per-frame write is not an accelerated animation, so
 * without the hint this repaints like anything else. See midiActivityRegistry.
 */
function MattePulse({ color }: { color: string }) {
  return (
    <div
      aria-hidden="true"
      data-midi-activity-pulse=""
      className="absolute inset-0 pointer-events-none rounded-[6px]"
      style={{ backgroundColor: color, opacity: 0 }}
    />
  )
}

/** A note dash's colour as a function of ITS activity: `resting` at 0, `active`
 *  at 1, interpolated in oklab by the browser. Notes take the colour walk
 *  rather than the overlay above because there are tens of thousands of them on
 *  a real project - one promoted layer each is not on the table - and measured
 *  against the block pulse they are minor (~140ms of that 1060ms). */
function noteActivityMix(resting: string, active: string): string {
  return `color-mix(in oklab, ${resting}, ${active} calc(var(--midi-note-activity, 0) * 100%))`
}

interface LoopSection {
  startBeat: number
  durationBeats: number
}

/** Miniature of the block's notes: x/width from time, y from the MIDI editor's
 *  row order (or numeric pitch for a plain piano roll), dashes long notes read
 *  as dashes and hits as ticks. A looping block
 *  tiles the pattern (repeats dimmed) across touching rounded sections. Those
 *  sections are the block surface itself, rather than decorations inside one
 *  large outer pill, so their touching corners form the familiar DAW divots. */
/** Memoized separately from Block: a plain block MOVE keeps `notes` (and every
 *  other prop) referentially identical, so the potentially hundreds of preview
 *  divs skip reconciliation entirely while the block repositions. */
const NotePreview = memo(function NotePreview({ notes, totalBeats, loopBeats, palette, selected, rowPitches, strictRows }: { notes: BlockType['notes']; totalBeats: number; loopBeats: number | null; palette: MidiBlockPalette; selected?: boolean; rowPitches?: number[]; strictRows?: boolean }) {
  if (totalBeats <= 0) return null
  // Loop boundaries describe the block's repeated pattern even when that
  // pattern is currently empty, so note previews and divisions stay separate.
  const pitchPositions = notePreviewPitchPositions(notes, rowPitches, strictRows)

  const looping = loopBeats != null && loopBeats > 0 && loopBeats < totalBeats
  const occurrences = looping
    ? tileLoopNotes(notes, loopBeats, totalBeats, PREVIEW_NOTE_CAP)
    : notes.map((note) => ({ note, startBeat: note.startBeat, durationBeats: note.durationBeats, repeat: 0 }))
  const sections: LoopSection[] = []
  if (looping) {
    for (let startBeat = 0; startBeat < totalBeats; startBeat += loopBeats) {
      sections.push({ startBeat, durationBeats: Math.min(loopBeats, totalBeats - startBeat) })
    }
  }

  return (
    <>
      {sections.map(({ startBeat, durationBeats }) => {
        const leftPct = (startBeat / totalBeats) * 100
        const widthPct = (durationBeats / totalBeats) * 100
        return (
          <div
            key={`loop-section:${startBeat}`}
            data-loop-section=""
            className="absolute pointer-events-none rounded-[6px]"
            style={{
              // Adjacent border boxes meet exactly: their flat vertical portions
              // are flush while the paired rounded corners expose a small notch.
              left: `${leftPct}%`,
              width: `max(${widthPct}%, 1px)`,
              top: 0,
              bottom: 0,
              background: selected ? palette.selectedBody : palette.fill,
              // The shared perimeter is above every section; touching
              // corners retain the existing loop notches.
            }}
          >
            {!selected && <MattePulse color={palette.activeFill} />}
          </div>
        )
      })}
      {occurrences.map(({ note, startBeat, durationBeats, repeat }) => {
        const pitchPosition = pitchPositions.get(note.pitch)
        if (pitchPosition == null) return null
        const leftPct = (startBeat / totalBeats) * 100
        const widthPct = (durationBeats / totalBeats) * 100
        // 8%–88% band keeps dashes inside the rounded border. Semantic tracks
        // follow their declared row order; plain piano rolls keep high pitch up.
        const topPct = 8 + pitchPosition * 80
        // Notes carry the track hue in both states and brighten on activity.
        const noteFill = selected
          ? (repeat > 0
              ? noteActivityMix(palette.selectedRepeatedNote, palette.activeSelectedRepeatedNote)
              : noteActivityMix(palette.selectedNote, palette.activeSelectedNote))
          : (repeat > 0
              ? noteActivityMix(palette.repeatedNote, palette.activeRepeatedNote)
              : noteActivityMix(palette.note, palette.activeNote))
        return (
          <div
            key={`${note.id}:${repeat}`}
            data-midi-preview-key={`${note.id}:${repeat}`}
            className="absolute rounded-full pointer-events-none"
            style={{
              left: `${leftPct}%`,
              width: `max(${widthPct}%, 3px)`,
              top: `${topPct}%`,
              height: 2,
              background: noteFill,
            }}
          />
        )
      })}
      {sections.map(({ startBeat, durationBeats }, index) => (
        <div
          key={`loop-outline:${startBeat}`}
          className="absolute inset-y-0 pointer-events-none"
          style={{ left: `${startBeat / totalBeats * 100}%`, width: `max(${durationBeats / totalBeats * 100}%, 1px)` }}
        >
          <BlockOutline
            color={selected ? palette.selectedOutline : palette.edge}
            selected={selected}
            first={index === 0}
            last={index === sections.length - 1}
          />
        </div>
      ))}
    </>
  )
})
