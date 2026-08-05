import { useUIStore } from '../../store/UIStore'
import { loopLengthBeats, tileLoopNotes } from '../../core/visual/noteFlatten'
import { LOOP_CURSOR } from '../../utils/dragCursor'
import { BLOCK_EDGE_HIT, edgeHitPx } from '../../constants'
import { midiBlockPalette, type MidiBlockPalette } from '../../utils/colors'
import { notePreviewPitchPositions } from '../../core/visual/notePreviewLayout'
import { memo, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Block as BlockType } from '../../types'
import { registerMidiActivityBlock } from './midiActivityRegistry'

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

  const left = block.startBar * barWidthPx
  const width = block.durationBars * barWidthPx
  const renderedWidth = Math.max(width, 4)
  const totalBeatsInBlock = block.durationBars * beatsPerBar
  const loopBeats = block.loop ? loopLengthBeats(block, beatsPerBar) : null
  const hasLoopSections = loopBeats != null && loopBeats > 0 && loopBeats < totalBeatsInBlock
  // Stable object: NotePreview is memoized and takes the palette as a prop.
  const palette = useMemo(() => midiBlockPalette(color), [color])
  const active = isSelected || isEditing

  const activityFilter = 'brightness(calc(1 + var(--midi-activity-opacity, 0) * 1.5))'
  // Resting: the neon-signage pane - an inset hue hairline plus a near-black
  // separation ring against the lane. Selected: the supernova - the body IS
  // the light, so the only "edge" is the burning rim inside its bloom stack.
  const restingShadow = `inset 0 0 0 1px ${palette.edge}, 0 0 0 1px rgba(0,0,0,0.45)`

  useEffect(() => {
    const element = blockRef.current
    if (!element) return
    return registerMidiActivityBlock(block, beatsPerBar, element, muted)
  }, [beatsPerBar, block, muted, previewRowPitches, strictPreviewRows])

  return (
    <div
      ref={blockRef}
      data-block-id={block.id}
      data-looped-block={hasLoopSections ? '' : undefined}
      title="Double-click to edit notes"
      className="absolute top-0 bottom-0 overflow-hidden rounded-[6px]"
      style={{
        left: `${left}px`,
        width: `${renderedWidth}px`,
        // No borders in either state. A looped block keeps its fill on the
        // flush rounded sections (their touching corners form the loop-divot
        // notches) while the shadow work - resting hairlines or the selected
        // bloom - lives on THIS outer element, one perimeter for the whole
        // block. The bloom is pure light, so it needs no silhouette hugging;
        // the resting inset hairline sits under the sections and survives only
        // at the notches, which reads as intended.
        background: hasLoopSections ? 'transparent' : active ? palette.selectedBody : palette.fill,
        boxShadow: active ? palette.selectedBloom : restingShadow,
        filter: activityFilter,
        willChange: 'filter',
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
      {!hasLoopSections && (
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none rounded-[6px]"
          style={{
            backgroundColor: palette.selectedOutline,
            opacity: 'var(--midi-activity-opacity, 0)',
            boxShadow: `inset 0 0 16px ${palette.outline}`,
            mixBlendMode: 'screen',
            willChange: 'opacity',
          }}
        />
      )}
      <NotePreview
        notes={block.notes}
        totalBeats={totalBeatsInBlock}
        loopBeats={loopBeats}
        palette={palette}
        selected={isSelected || isEditing}
        rowPitches={previewRowPitches}
        strictRows={strictPreviewRows}
      />
    </div>
  )
})

// Preview divs per looped block stay bounded; a tiny pattern in a huge block
// caps out instead of flooding the DOM.
const PREVIEW_NOTE_CAP = 512

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
              // No per-section ring: the perimeter shadows live on the outer
              // block, so touching sections merge into one fill and the loop
              // boundary reads only from the small corner notch their rounding
              // leaves - never a hard dark dividing line. Each selected section
              // gets its own star-anatomy gradient (per-section cores), which
              // makes the loop repeats read as a chain of small suns.
            }}
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 rounded-[inherit]"
              style={{
                backgroundColor: palette.selectedOutline,
                opacity: 'var(--midi-activity-opacity, 0)',
                boxShadow: `inset 0 0 16px ${palette.outline}`,
                mixBlendMode: 'screen',
              }}
            />
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
        // Resting: lit tubing with a glow. Selected: the notes flip DARK -
        // outshone by the ignited body - and the body's light wraps around
        // each first-pass mark (repeats stay unwrapped so they read dimmer).
        const noteFill = selected
          ? (repeat > 0 ? palette.selectedRepeatedNote : palette.selectedNote)
          : (repeat > 0 ? palette.repeatedNote : palette.note)
        const noteHalo = repeat > 0
          ? undefined
          : selected
            ? `0 0 4px ${palette.selectedNoteWrap}`
            : `0 0 6px ${palette.noteGlow}`
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
              backgroundColor: noteFill,
              boxShadow: noteHalo,
              // No will-change here (or on the spans below): these hint-promoted
              // compositor layers numbered in the tens of thousands on a large
              // project. A 2px dash repaints trivially when its activity var
              // moves; the block-level layers above are hint enough.
              filter: 'brightness(calc(1 + var(--midi-note-activity, 0) * 2.6)) saturate(1.25)',
            }}
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-[inherit]"
              style={{
                backgroundColor: palette.selectedOutline,
                opacity: 'var(--midi-note-activity, 0)',
                boxShadow: `0 0 6px ${palette.outline}`,
              }}
            />
          </div>
        )
      })}
    </>
  )
})
