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
  /** Semantic MIDI row order from the full editor (first pitch = top). */
  previewRowPitches?: number[]
  /** Hide pitches outside the declared vocabulary, matching strict editors. */
  strictPreviewRows?: boolean
  onBlockPointerDown: (e: ReactPointerEvent, trackId: string, blockId: string) => void
}

export function Block({ block, trackId, barWidthPx, beatsPerBar, color, isSelected, previewRowPitches, strictPreviewRows, onBlockPointerDown }: BlockProps) {
  const editingBlock = useUIStore((s) => s.editingBlock)
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  const rowHeight = useUIStore((s) => s.tracksRowHeight)
  const isEditing = editingBlock?.blockId === block.id
  const blockRef = useRef<HTMLDivElement>(null)

  const left = block.startBar * barWidthPx
  const width = block.durationBars * barWidthPx
  const renderedWidth = Math.max(width, 4)
  const renderedHeight = Math.max(rowHeight - 8, 1)
  const totalBeatsInBlock = block.durationBars * beatsPerBar
  const loopBeats = block.loop ? loopLengthBeats(block, beatsPerBar) : null
  const hasLoopSections = loopBeats != null && loopBeats > 0 && loopBeats < totalBeatsInBlock
  const palette = midiBlockPalette(color)
  const outlineColor = isEditing || isSelected ? palette.selectedOutline : palette.outline

  useEffect(() => {
    const element = blockRef.current
    if (!element) return
    return registerMidiActivityBlock(block, beatsPerBar, element)
  }, [beatsPerBar, block, previewRowPitches, strictPreviewRows])

  return (
    <div
      ref={blockRef}
      data-block-id={block.id}
      data-looped-block={hasLoopSections ? '' : undefined}
      title="Double-click to edit notes"
      className={`absolute top-1 bottom-1 overflow-hidden ${hasLoopSections ? '' : 'rounded-[3px]'}`}
      style={{
        left: `${left}px`,
        width: `${renderedWidth}px`,
        backgroundColor: hasLoopSections ? 'transparent' : palette.fill,
        borderTop: hasLoopSections ? undefined : `1px solid ${outlineColor}`,
        borderRight: hasLoopSections ? undefined : `1px solid ${outlineColor}`,
        borderBottom: hasLoopSections ? undefined : `1px solid ${outlineColor}`,
        borderLeft: hasLoopSections ? undefined : `2px solid ${outlineColor}`,
        boxShadow: !hasLoopSections && (isSelected || isEditing)
          ? `0 0 0 1px ${palette.selectedOutline}, 0 3px 10px rgba(0,0,0,0.24)`
          : undefined,
        filter: 'brightness(calc(1 + var(--midi-activity-opacity, 0) * 1.5))',
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
          className="absolute inset-0 pointer-events-none rounded-[3px]"
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
        highlighted={isEditing || isSelected}
        widthPx={renderedWidth}
        heightPx={renderedHeight}
        rowPitches={previewRowPitches}
        strictRows={strictPreviewRows}
      />
    </div>
  )
}

// Preview divs per looped block stay bounded; a tiny pattern in a huge block
// caps out instead of flooding the DOM.
const PREVIEW_NOTE_CAP = 512
const LOOP_CORNER_RADIUS_PX = 4

interface LoopSection {
  startBeat: number
  durationBeats: number
}

/** One closed contour around the union of all repeated sections. At each
 *  internal join the path follows the two rounded corners into a divot, but
 *  deliberately omits the tangent vertical edges because those are internal
 *  to the combined loop shape. */
function loopOutlinePath(sections: LoopSection[], totalBeats: number, width: number, height: number, strokeWidth: number): string {
  const inset = strokeWidth / 2
  const left = inset
  const top = inset
  const right = Math.max(left, width - inset)
  const bottom = Math.max(top, height - inset)
  const maxVerticalRadius = Math.max(0, (bottom - top) / 2)
  const seams = sections.slice(1).map((section, index) => {
    const x = (section.startBeat / totalBeats) * width
    const previousWidth = sections[index].durationBeats / totalBeats * width
    const nextWidth = section.durationBeats / totalBeats * width
    const radius = Math.min(LOOP_CORNER_RADIUS_PX, maxVerticalRadius, previousWidth / 2, nextWidth / 2)
    return { x, radius }
  })
  const outerRadius = Math.min(
    LOOP_CORNER_RADIUS_PX,
    maxVerticalRadius,
    (sections[0]?.durationBeats ?? totalBeats) / totalBeats * width / 2,
    (sections.at(-1)?.durationBeats ?? totalBeats) / totalBeats * width / 2,
  )

  let path = `M ${left + outerRadius} ${top}`
  for (const seam of seams) {
    path += ` H ${seam.x - seam.radius} Q ${seam.x} ${top} ${seam.x} ${top + seam.radius}`
    path += ` Q ${seam.x} ${top} ${seam.x + seam.radius} ${top}`
  }
  path += ` H ${right - outerRadius} Q ${right} ${top} ${right} ${top + outerRadius}`
  path += ` V ${bottom - outerRadius} Q ${right} ${bottom} ${right - outerRadius} ${bottom}`
  for (let index = seams.length - 1; index >= 0; index -= 1) {
    const seam = seams[index]
    path += ` H ${seam.x + seam.radius} Q ${seam.x} ${bottom} ${seam.x} ${bottom - seam.radius}`
    path += ` Q ${seam.x} ${bottom} ${seam.x - seam.radius} ${bottom}`
  }
  path += ` H ${left + outerRadius} Q ${left} ${bottom} ${left} ${bottom - outerRadius}`
  path += ` V ${top + outerRadius} Q ${left} ${top} ${left + outerRadius} ${top} Z`
  return path
}

/** Miniature of the block's notes: x/width from time, y from the MIDI editor's
 *  row order (or numeric pitch for a plain piano roll), dashes long notes read
 *  as dashes and hits as ticks. A looping block
 *  tiles the pattern (repeats dimmed) across touching rounded sections. Those
 *  sections are the block surface itself, rather than decorations inside one
 *  large outer pill, so their touching corners form the familiar DAW divots. */
function NotePreview({ notes, totalBeats, loopBeats, palette, highlighted, widthPx, heightPx, rowPitches, strictRows }: { notes: BlockType['notes']; totalBeats: number; loopBeats: number | null; palette: MidiBlockPalette; highlighted: boolean; widthPx: number; heightPx: number; rowPitches?: number[]; strictRows?: boolean }) {
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
  const outlineStrokeWidth = highlighted ? 2 : 1
  const outlinePath = looping
    ? loopOutlinePath(sections, totalBeats, widthPx, heightPx, outlineStrokeWidth)
    : null

  return (
    <>
      {sections.map(({ startBeat, durationBeats }) => {
        const leftPct = (startBeat / totalBeats) * 100
        const widthPct = (durationBeats / totalBeats) * 100
        return (
          <div
            key={`loop-section:${startBeat}`}
            data-loop-section=""
            className="absolute pointer-events-none rounded-[4px]"
            style={{
              // Adjacent border boxes meet exactly: their flat vertical portions
              // are flush while the paired rounded corners expose a small notch.
              left: `${leftPct}%`,
              width: `max(${widthPct}%, 1px)`,
              top: 0,
              bottom: 0,
              backgroundColor: palette.fill,
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
      {outlinePath && (
        <svg
          data-loop-outline=""
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${widthPx} ${heightPx}`}
          preserveAspectRatio="none"
        >
          <path
            d={outlinePath}
            fill="none"
            stroke={highlighted ? palette.selectedOutline : palette.outline}
            strokeWidth={outlineStrokeWidth}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
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
