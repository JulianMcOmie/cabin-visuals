import { useUIStore } from '../../store/UIStore'
import { loopLengthBeats, tileLoopNotes } from '../../core/visual/noteFlatten'
import { LOOP_CURSOR } from '../../utils/dragCursor'
import { midiBlockPalette, type MidiBlockPalette } from '../../utils/colors'
import { notePreviewPitchPositions } from '../../core/visual/notePreviewLayout'
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
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

export function Block({ block, trackId, barWidthPx, beatsPerBar, color, isSelected, muted, previewRowPitches, strictPreviewRows, onBlockPointerDown }: BlockProps) {
  const editingBlock = useUIStore((s) => s.editingBlock)
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const isEditing = editingBlock?.blockId === block.id
  const blockRef = useRef<HTMLDivElement>(null)

  const left = block.startBar * barWidthPx
  const width = block.durationBars * barWidthPx
  const renderedWidth = Math.max(width, 4)
  const renderedHeight = Math.max(rowHeight, 1)
  const totalBeatsInBlock = block.durationBars * beatsPerBar
  const loopBeats = block.loop ? loopLengthBeats(block, beatsPerBar) : null
  const hasLoopSections = loopBeats != null && loopBeats > 0 && loopBeats < totalBeatsInBlock
  const palette = midiBlockPalette(color)
  const active = isSelected || isEditing

  // A looped block's surface is the UNION of its touching rounded sections, so
  // its perimeter has a small notch (divot) at every loop boundary. A box-shadow
  // ring can't express that - it traces the bounding RECTANGLE and paves the
  // divots over. drop-shadow is built from the rendered alpha instead, so four
  // 1px offsets lay a ring that hugs the real silhouette, divots included. The
  // sections meet flush, so nothing is drawn along their shared edge (which is
  // why the ring can't live on the sections themselves - see NotePreview).
  const silhouetteRing = (ringColor: string) =>
    `drop-shadow(1px 0 0 ${ringColor}) drop-shadow(-1px 0 0 ${ringColor})` +
    ` drop-shadow(0 1px 0 ${ringColor}) drop-shadow(0 -1px 0 ${ringColor})`
  const activityFilter = 'brightness(calc(1 + var(--midi-activity-opacity, 0) * 1.5))'

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
        // No borders: instead each block casts a super-thin, almost-black ring
        // shadow - significant in darkness, hairline in geometry - so it reads
        // as a border/margin against the lane and neighbouring blocks. The ring
        // lives on THIS outer element for looped blocks too, so a looped block
        // has ONE perimeter border; per-section rings would double up where two
        // sections touch and read as a hard dividing line (the loop boundary is
        // shown by the sections' corner notch instead).
        backgroundColor: hasLoopSections ? 'transparent' : active ? palette.selectedFill : palette.fill,
        // Square-cornered blocks keep the cheaper box-shadow ring; only looped
        // blocks pay for the silhouette filter, and only they need it.
        boxShadow: hasLoopSections
          ? undefined
          : active
            ? `0 0 0 1px ${palette.selectedOutline}, 0 0 0 2px rgba(0,0,0,0.6), 0 3px 10px rgba(0,0,0,0.24)`
            : '0 0 0 1px rgba(0,0,0,0.6)',
        filter: hasLoopSections
          // Selected: the accent ring first, then a black ring laid around the
          // result - the same colour order the box-shadow version stacks in.
          ? active
            ? `${activityFilter} ${silhouetteRing(palette.selectedOutline)} ${silhouetteRing('rgba(0,0,0,0.6)')}`
            : `${activityFilter} ${silhouetteRing('rgba(0,0,0,0.6)')}`
          : activityFilter,
        willChange: 'filter',
      }}
      onPointerDown={(e) => onBlockPointerDown(e, trackId, block.id)}
      onPointerMove={(e) => {
        // Measure relative to the block (currentTarget), not offsetX - offsetX is
        // relative to whatever child is under the pointer (e.g. a note sliver).
        const rect = e.currentTarget.getBoundingClientRect()
        const w = rect.width
        const edge = Math.min(8, w / 4)
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
}

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
function NotePreview({ notes, totalBeats, loopBeats, palette, selected, rowPitches, strictRows }: { notes: BlockType['notes']; totalBeats: number; loopBeats: number | null; palette: MidiBlockPalette; selected?: boolean; rowPitches?: number[]; strictRows?: boolean }) {
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
              backgroundColor: selected ? palette.selectedFill : palette.fill,
              // No per-section ring: the perimeter border lives on the outer
              // block, so touching sections merge into one fill and the loop
              // boundary reads only from the small corner notch their rounding
              // leaves - never a hard dark dividing line.
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
                willChange: 'opacity',
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
              backgroundColor: repeat > 0 ? palette.repeatedNote : palette.note,
              filter: 'brightness(calc(1 + var(--midi-note-activity, 0) * 2.6)) saturate(1.25)',
              willChange: 'filter',
            }}
          >
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-[inherit]"
              style={{
                backgroundColor: palette.selectedOutline,
                opacity: 'var(--midi-note-activity, 0)',
                boxShadow: `0 0 6px ${palette.outline}`,
                willChange: 'opacity',
              }}
            />
          </div>
        )
      })}
    </>
  )
}
