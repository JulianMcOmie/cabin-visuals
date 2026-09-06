'use client'

import { memo, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { midiNoteColor, midiRowLabelColor } from '../../utils/midiEditorPalette'
import { beatToX } from './coords'
import type { TiledNote } from '../../core/visual/noteFlatten'
import type { Note } from '../../types'
import type { MidiRow } from './types'

// The piano roll's per-row and per-note DOM, split out of MidiEditor and
// memoized. MidiEditor re-renders on EVERY note-drag pointermove (the notes
// array is local state that streams through it), and before this split every
// row label, row stripe and note element was rebuilt on each of those renders -
// hundreds of inline style objects and closures per frame for a one-note move.
// Each piece here takes primitives plus callbacks that MidiEditor keeps
// referentially stable (ref-backed), so a drag re-renders only the notes that
// actually moved. Vertical note geometry is relative to the grid height so
// row zoom can also reuse note elements; timeline-density.mjs ROLL=1 VERIFY=1
// checks computed geometry and pointer gestures.

/** One note body. Vertical geometry is a fraction of the full row grid, whose
 * height is rowCount * rowHeight. Resizing rows then needs only browser layout,
 * with no per-note React updates or inherited custom-property invalidation.
 *
 * `noteId` rides the callbacks (and the `data-note-id`
 *  attribute, which scripts/perf/roll-smoke.mjs targets) so the handlers can be
 *  shared by every note instead of closing over each one. */
export interface NoteRectProps {
  noteId: string
  left: number
  rowIndex: number
  rowCount: number
  wordFontSize: number
  width: number
  color: string
  isSelected: boolean
  /** Selected or being drawn: lifted fill plus the laser glow. */
  isLive: boolean
  /** Text rolls: the word this note sings ('∅' = orphan); undefined on
   *  rolls without words, in which case no label span renders at all. */
  word: string | undefined
  /** Whether double-click opens the inline word editor (text rolls). */
  wordEditable: boolean
  /** The in-progress edit value while THIS note's word is being retyped. */
  editValue: string | null
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, noteId: string) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerOut: () => void
  onWordEditStart: (noteId: string, value: string) => void
  onWordEditChange: (noteId: string, value: string) => void
  onWordEditCommit: (noteId: string, value: string) => void
  onWordEditCancel: () => void
}

export const NoteRect = memo(function NoteRect({
  noteId,
  left,
  rowIndex,
  rowCount,
  wordFontSize,
  width,
  color,
  isSelected,
  isLive,
  word,
  wordEditable,
  editValue,
  onPointerDown,
  onPointerMove,
  onPointerOut,
  onWordEditStart,
  onWordEditChange,
  onWordEditCommit,
  onWordEditCancel,
}: NoteRectProps) {
  const editing = editValue !== null
  return (
    <div
      data-note-id={noteId}
      style={{
        position: 'absolute',
        left,
        top: `calc(${rowIndex * 100 / rowCount}% + 2px)`,
        width,
        height: `calc(${100 / rowCount}% - 4px)`,
        backgroundColor: color,
        borderRadius: 3,
        boxShadow: isLive
          ? `0 0 14px ${color}, 0 0 6px ${color}`
          : 'none',
        cursor: 'inherit',
        zIndex: isSelected ? 6 : 5,
      }}
      onPointerDown={(e) => onPointerDown(e, noteId)}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      onDoubleClick={wordEditable ? (e) => { e.stopPropagation(); onWordEditStart(noteId, word === '∅' ? '' : (word ?? '')) } : undefined}
    >
      {word !== undefined && !editing && (
        <span
          style={{
            position: 'absolute',
            inset: '0 3px',
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            fontSize: wordFontSize,
            fontWeight: 700,
            color: word === '∅' ? '#f0a0a0' : 'rgba(10,12,16,0.9)',
            pointerEvents: 'none',
          }}
        >{word}</span>
      )}
      {editing && (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => onWordEditChange(noteId, e.target.value)}
          onBlur={() => onWordEditCommit(noteId, editValue)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') onWordEditCommit(noteId, editValue)
            if (e.key === 'Escape') onWordEditCancel()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Word"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            background: 'rgba(10,12,16,0.92)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.6)',
            borderRadius: 3,
            fontSize: 11,
            padding: '0 3px',
            outline: 'none',
          }}
        />
      )}
    </div>
  )
})

/** The frozen label gutter: one row per MidiRow. Selection lights a row's
 *  label; `selectedPitchKey` is a sorted-pitch STRING rather than the Set so
 *  the memo holds while a drag keeps notes on their rows. */
export interface RowLabelsProps {
  rows: MidiRow[]
  rowHeight: number
  /** Comma-joined sorted pitches of rows holding a selected note. */
  selectedPitchKey: string
  /** Style-lane rows are clickable only when the host handles the click. */
  laneRowsClickable: boolean
  activeLaneIndex: number | null | undefined
  onLaneRowClick: (laneIndex: number) => void
  /** midi vim: the key that writes each row (null while the mode is off). */
  vimRowKeys: Map<number, string> | null
  /** The vim cursor's row, or -1 while the mode is off. */
  vimCursorRow: number
  vimAccent: string
}

export const RowLabels = memo(function RowLabels({
  rows,
  rowHeight,
  selectedPitchKey,
  laneRowsClickable,
  activeLaneIndex,
  onLaneRowClick,
  vimRowKeys,
  vimCursorRow,
  vimAccent,
}: RowLabelsProps) {
  const selectedPitches = useMemo(
    () => new Set(selectedPitchKey === '' ? [] : selectedPitchKey.split(',').map(Number)),
    [selectedPitchKey],
  )
  return (
    <>
      {rows.map((row, rowIndex) => {
        const isLane = row.laneIndex !== undefined && laneRowsClickable
        return (
          <RowLabel
            key={row.pitch}
            row={row}
            rowIndex={rowIndex}
            rowHeight={rowHeight}
            isLane={isLane}
            laneActive={isLane && row.laneIndex === activeLaneIndex}
            selected={selectedPitches.has(row.pitch)}
            // In vim the gutter teaches its own key map: each row shows the
            // letter that writes it. It takes the note-name slot, because while
            // you're typing that IS the more useful name for the row - and it's
            // the only way an arbitrary row vocabulary can explain itself.
            vimKey={vimRowKeys ? vimRowKeys.get(rowIndex) : undefined}
            onCursorRow={rowIndex === vimCursorRow}
            vimAccent={vimAccent}
            onLaneRowClick={onLaneRowClick}
          />
        )
      })}
    </>
  )
})

/** One gutter row. Memoized per row so lighting one row's label (the selection
 *  following a dragged note) re-renders that row and the one it left, not the
 *  whole column. */
const RowLabel = memo(function RowLabel({ row, rowIndex, rowHeight, isLane, laneActive, selected, vimKey, onCursorRow, vimAccent, onLaneRowClick }: {
  row: MidiRow
  rowIndex: number
  rowHeight: number
  isLane: boolean
  laneActive: boolean
  selected: boolean
  vimKey: string | undefined
  onCursorRow: boolean
  vimAccent: string
  onLaneRowClick: (laneIndex: number) => void
}) {
  return (
    <div
      title={row.noteLabel ? `${row.label} (${row.noteLabel})` : isLane ? `${row.label} - click to edit this style lane` : row.label}
      onClick={isLane ? () => onLaneRowClick(row.laneIndex!) : undefined}
      role={isLane ? 'button' : undefined}
      aria-pressed={isLane ? laneActive : undefined}
      style={{
        height: rowHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 4,
        paddingLeft: 6,
        paddingRight: 8,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        backgroundColor: onCursorRow
          ? 'rgba(255,255,255,0.07)'
          : laneActive
          ? 'rgba(255,255,255,0.09)'
          : rowIndex % 2 === 1 ? 'rgba(0,0,0,0.08)' : 'transparent',
        boxSizing: 'border-box',
        overflow: 'hidden',
        cursor: isLane ? 'pointer' : undefined,
      }}
    >
      <span
        style={{
          // A style-lane row IS its style preview: the lane's own
          // face, color and (clamped) size - what you read here is
          // what a note at this height wears.
          fontSize: row.sizeScale !== undefined
            ? Math.min(rowHeight - 6, Math.max(9, 10 + row.sizeScale * 3.5))
            : row.noteLabel ? 11 : 13,
          fontFamily: row.fontFamily,
          // Selection feedback: rows holding a selected note light up
          // in the row's color. Emphasized rows (octave anchors,
          // flagship instrument rows) sit a step brighter than the
          // rest, but stay neutral so color always means selection.
          color: row.laneIndex !== undefined
            ? row.color
            : selected
              ? midiRowLabelColor(row.color)
              : row.emphasized ? '#9a9aa3' : '#666666',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {row.label}
      </span>
      {vimKey ? (
        <span
          style={{
            fontSize: 9,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            lineHeight: '13px',
            minWidth: 13,
            textAlign: 'center',
            borderRadius: 3,
            padding: '0 3px',
            flexShrink: 0,
            color: onCursorRow ? '#0b0d12' : 'rgba(255,255,255,0.55)',
            backgroundColor: onCursorRow ? vimAccent : 'rgba(255,255,255,0.09)',
          }}
        >
          {vimKey}
        </span>
      ) : row.noteLabel && (
        <span
          style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.35)',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {row.noteLabel}
        </span>
      )}
    </div>
  )
})

/** Loop ghosts: the pattern's repeats, dimmed and non-interactive. A ceiling-
 *  length loop block tiles up to 2000 of these, and the tiled list is rebuilt
 *  on every drag frame (a moved note's ghosts move with it) - but the ghosts of
 *  every OTHER note come back with the same note object (the gesture's `map`
 *  returns un-dragged notes by identity) at the same beats. So this keeps last
 *  frame's ELEMENTS in a ref and hands the unchanged ones straight back: an
 *  identical element reference is React's cheapest possible child (a bailout
 *  with no reconciliation), and it skips the per-element JSX cost - which in a
 *  dev build was most of a drag frame's script time. */
export interface LoopGhostsProps {
  ghosts: TiledNote[]
  rows: MidiRow[]
  pitchToRowIndex: (pitch: number) => number
  blockStartPx: number
  pixelsPerBeat: number
}

interface GhostCacheEntry {
  note: Note
  startBeat: number
  durationBeats: number
  element: ReactElement | null
}

export const LoopGhosts = memo(function LoopGhosts({ ghosts, rows, pitchToRowIndex, blockStartPx, pixelsPerBeat }: LoopGhostsProps) {
  const cacheRef = useRef<{ geometry: string; rows: MidiRow[]; entries: Map<string, GhostCacheEntry> }>({ geometry: '', rows, entries: new Map() })
  const geometry = `${blockStartPx}|${pixelsPerBeat}`
  const prev = cacheRef.current
  // Horizontal geometry and row vocabulary invalidate ghosts; vertical zoom
  // follows the grid height through percentages without rebuilding elements.
  const reusable = prev.geometry === geometry && prev.rows === rows ? prev.entries : null
  const next = new Map<string, GhostCacheEntry>()
  const out: (ReactElement | null)[] = []
  for (const t of ghosts) {
    const key = `${t.note.id}:${t.repeat}`
    const hit = reusable?.get(key)
    if (hit && hit.note === t.note && hit.startBeat === t.startBeat && hit.durationBeats === t.durationBeats) {
      next.set(key, hit)
      out.push(hit.element)
      continue
    }
    const rowIndex = pitchToRowIndex(t.note.pitch)
    let element: ReactElement | null = null
    if (rowIndex !== -1) {
      const row = rows[rowIndex]
      const ghostLeft = Math.round(blockStartPx + beatToX(t.startBeat, pixelsPerBeat))
      const ghostRight = Math.round(blockStartPx + beatToX(t.startBeat + t.durationBeats, pixelsPerBeat))
      element = (
        <div
          key={key}
          style={{
            position: 'absolute',
            left: ghostLeft,
            top: `calc(${rowIndex * 100 / rows.length}% + 2px)`,
            width: Math.max(ghostRight - ghostLeft, 8),
            height: `calc(${100 / rows.length}% - 4px)`,
            backgroundColor: midiNoteColor(row.color, t.note.velocity),
            opacity: 0.3,
            borderRadius: 3,
            pointerEvents: 'none',
          }}
        />
      )
    }
    next.set(key, { note: t.note, startBeat: t.startBeat, durationBeats: t.durationBeats, element })
    out.push(element)
  }
  cacheRef.current = { geometry, rows, entries: next }
  return <>{out}</>
})

/** Alternating row bands + dividers across the grid - pure geometry, so it
 *  re-renders only when the row count or height changes. */
export const RowStripes = memo(function RowStripes({ count, rowHeight }: { count: number; rowHeight: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: i * rowHeight,
            left: 0,
            right: 0,
            height: rowHeight,
            backgroundColor: i % 2 === 1 ? 'rgba(0,0,0,0.08)' : 'transparent',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      ))}
    </>
  )
})
