import { memo, useMemo, type PointerEvent, type RefObject } from 'react'
import { useUIStore } from '../../store/UIStore'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { midiEditorChrome, midiNoteBaseColor, midiNoteColor } from '../../utils/midiEditorPalette'
import { midiBlockLanes, midiBlockPreviewNotes, type MidiBlockView } from './multiBlock'
import type { MidiRow } from './types'

function focus(view: MidiBlockView) {
  useUIStore.getState().focusEditingBlock({ trackId: view.trackId, blockId: view.block.id })
}

export function MultiBlockHeaders({ blocks, activeId, labelWidth, contentWidth, pixelsPerBeat, beatsPerBar, contentRef, onActivePointerDown, onActivePointerMove }: {
  blocks: MidiBlockView[]; activeId: string; labelWidth: number; contentWidth: number
  pixelsPerBeat: number; beatsPerBar: number; contentRef: RefObject<HTMLDivElement | null>
  onActivePointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onActivePointerMove: (event: PointerEvent<HTMLDivElement>) => void
}) {
  const lanes = useMemo(() => midiBlockLanes(blocks), [blocks])
  const height = Math.max(1, ...lanes.map(view => view.lane + 1)) * 24
  return <div className="flex shrink-0 border-b border-white/10 bg-[#202024]" data-midi-block-headers>
    <div className="flex shrink-0 items-center px-2 text-[10px] text-white/50" style={{ width: labelWidth }} title="Click a block to edit its notes; the other blocks stay visible.">{blocks.length} blocks</div>
    <div className="relative flex-1 overflow-hidden" style={{ height, maxHeight: 120, overflowY: height > 120 ? 'auto' : 'hidden' }}>
      <div ref={contentRef} className="relative" style={{ height, width: contentWidth, left: PLAYHEAD_TRIANGLE_HALF }}>
        {lanes.map(view => {
          const active = view.block.id === activeId
          const chrome = midiEditorChrome(view.color)
          return <div key={view.block.id} role="button" tabIndex={0}
            aria-pressed={active} aria-label={`Edit ${view.name}`}
            data-midi-clip-header={view.block.id} title={`${view.name} · Bar ${view.block.startBar + 1}${active ? ' · Active — drag to move or resize' : ' · Click to edit'}`}
            className="absolute truncate rounded-sm px-1.5 text-[10px] leading-[21px] outline-none focus-visible:ring-1 focus-visible:ring-white"
            style={{ top: view.lane * 24 + 1, height: 22, left: view.block.startBar * beatsPerBar * pixelsPerBeat,
              width: Math.max(2, view.block.durationBars * beatsPerBar * pixelsPerBeat - 1), background: active ? chrome.band : chrome.regionTint,
              border: `1px solid ${active ? chrome.regionEdge : view.color}`, color: active ? '#fff' : midiNoteBaseColor(view.color), cursor: 'pointer' }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); focus(view) } }}
            onPointerDown={event => {
              if (event.button !== 0) return
              if (active) onActivePointerDown(event)
              else { event.preventDefault(); event.stopPropagation(); focus(view) }
            }} onPointerMove={active ? onActivePointerMove : undefined}>{view.name}</div>
        })}
      </div>
    </div>
  </div>
}

/** Other clips are visible context. Focusing one hands it to the existing note editor. */
export const MultiBlockLayer = memo(function MultiBlockLayer({ blocks, activeId, rows, beatsPerBar, pixelsPerBeat }: {
  blocks: MidiBlockView[]; activeId: string; rows: MidiRow[]; beatsPerBar: number; pixelsPerBeat: number
}) {
  const previews = useMemo(() => blocks.filter(view => view.block.id !== activeId).map(view => ({
    ...view, notes: midiBlockPreviewNotes(view.block, beatsPerBar),
  })), [blocks, activeId, beatsPerBar])
  const rowByPitch = useMemo(() => new Map(rows.map((row, index) => [row.pitch, index])), [rows])
  return <>{previews.map(view => {
    const left = view.block.startBar * beatsPerBar * pixelsPerBeat
    const chrome = midiEditorChrome(view.color)
    return <div key={view.block.id}>
      <div data-midi-block-region={view.block.id} data-midi-context-block={view.block.id}
        title={`Edit ${view.name}`} onPointerDown={event => { if (event.button === 0 || event.button === 2) { event.preventDefault(); event.stopPropagation(); focus(view) } }}
        style={{ position: 'absolute', left, width: view.block.durationBars * beatsPerBar * pixelsPerBeat, top: 0, bottom: 0,
          background: chrome.regionTint, borderLeft: `1px solid ${chrome.regionEdge}`, borderRight: `1px solid ${chrome.regionEdge}`, cursor: 'pointer' }} />
      {view.notes.map((note, index) => {
        const row = rowByPitch.get(note.pitch)
        if (row === undefined) return null
        return <div key={`${note.id}:${index}`} data-midi-context-note={note.id} data-midi-note-owner={view.block.id}
          title={`${view.name} · MIDI ${note.pitch} · Click to edit block`}
          onPointerDown={event => { if (event.button === 0 || event.button === 2) { event.preventDefault(); event.stopPropagation(); focus(view) } }}
          style={{ position: 'absolute', left: Math.round(left + note.startBeat * pixelsPerBeat),
            top: `calc(${row * 100 / rows.length}% + 3px)`, height: `calc(${100 / rows.length}% - 6px)`,
            width: Math.max(3, Math.round(note.durationBeats * pixelsPerBeat) - 1), borderRadius: 2,
            background: midiNoteColor(midiNoteBaseColor(view.color), note.velocity), opacity: note.repeat > 0 ? .28 : .5,
            border: `1px solid ${midiNoteBaseColor(view.color)}`, zIndex: 4, cursor: 'pointer' }} />
      })}
    </div>
  })}</>
})
