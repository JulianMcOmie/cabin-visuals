'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Magnet } from 'lucide-react'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { useMidiEditorState } from './useMidiEditorState'
import { MidiEditor, LABEL_WIDTH } from './MidiEditor'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { generateRows } from './generateRows'
import type { Block } from '../../types'

const DEFAULT_QUANTIZE = 0.25

// Minimum bars the editor timeline spans, so short projects still have room to
// work past the block. Longer projects span their full length (TimeStore.totalBars).
const INITIAL_TOTAL_BARS = 10

const QUANTIZE_OPTIONS = [
  { value: 1, label: '1/4' },
  { value: 0.5, label: '1/8' },
  { value: 0.25, label: '1/16' },
  { value: 0.125, label: '1/32' },
]

export function PianoRollPanel() {
  const editingBlock = useUIStore((s) => s.editingBlock)
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  const tracks = useProjectStore((s) => s.tracks)

  const track = editingBlock ? tracks[editingBlock.trackId] : undefined
  const block = track?.blocks.find((b) => b.id === editingBlock?.blockId)

  // Auto-close if the block disappeared (track/block deleted)
  useEffect(() => {
    if (editingBlock && !block) setEditingBlock(null)
  }, [editingBlock, block, setEditingBlock])

  // Esc closes (MidiEditor consumes Esc first when notes are selected)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditingBlock(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setEditingBlock])

  if (!editingBlock || !track || !block) return null

  return (
    <PianoRollContent
      key={block.id}
      trackId={track.id}
      trackName={track.name}
      trackColor={track.color}
      block={block}
      onClose={() => setEditingBlock(null)}
    />
  )
}

interface PianoRollContentProps {
  trackId: string
  trackName: string
  trackColor: string
  block: Block
  onClose: () => void
}

function PianoRollContent({ trackId, trackName, trackColor, block, onClose }: PianoRollContentProps) {
  const beatsPerBar = useTimeStore((s) => s.beatsPerBar)
  const totalBars = useTimeStore((s) => s.totalBars)
  const midiPixelsPerBeat = useUIStore((s) => s.midiPixelsPerBeat)
  const setMidiPixelsPerBeat = useUIStore((s) => s.setMidiPixelsPerBeat)
  const midiRowScale = useUIStore((s) => s.midiRowScale)
  const setMidiRowScale = useUIStore((s) => s.setMidiRowScale)

  const [snapEnabled, setSnapEnabled] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  const { notes, setNotes, commit, quantize, setQuantize } = useMidiEditorState({
    trackId,
    block,
    defaultQuantize: DEFAULT_QUANTIZE,
  })

  const rows = generateRows()
  const rowHeight = Math.round(28 * midiRowScale)
  const blockDurationBeats = block.durationBars * beatsPerBar
  // Span the full project length so the MIDI editor scrolls to the same end as
  // the tracks view (at least INITIAL_TOTAL_BARS so short projects still have room).
  const initialTotalBeats = Math.max(totalBars, INITIAL_TOTAL_BARS) * beatsPerBar

  // On open: scroll horizontally to just before the block starts, and vertically
  // to the block's first note (the earliest by time), or C4 if the block is empty.
  useEffect(() => {
    if (hasScrolledRef.current || !containerRef.current) return
    const scrollContainer = containerRef.current.querySelector('.overflow-auto')
    if (!scrollContainer) return

    // Vertical: center on the first note's pitch (or C4 when empty).
    const firstNote = notes.length > 0
      ? notes.reduce((earliest, n) => (n.startBeat < earliest.startBeat ? n : earliest))
      : null
    const targetPitch = firstNote ? firstNote.pitch : 60
    const pitchIdx = rows.findIndex((r) => r.pitch <= targetPitch)
    const targetIdx = pitchIdx === -1 ? Math.floor(rows.length / 2) : pitchIdx
    scrollContainer.scrollTop = Math.max(0, targetIdx * rowHeight - scrollContainer.clientHeight / 2)

    // Horizontal: place the block start a one-bar lead-in from the left edge.
    const blockStartPx = LABEL_WIDTH + PLAYHEAD_TRIANGLE_HALF + block.startBar * beatsPerBar * midiPixelsPerBeat
    const leadInPx = beatsPerBar * midiPixelsPerBeat
    scrollContainer.scrollLeft = Math.max(0, blockStartPx - leadInPx)

    hasScrolledRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={containerRef} className="flex flex-col h-full border-t border-zinc-800">
      {/* Toolbar */}
      <div className="flex items-center gap-2 h-8 px-3 bg-zinc-900/60 border-b border-zinc-800 flex-shrink-0">
        <button
          onClick={onClose}
          title="Close (Esc)"
          className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <X size={12} />
        </button>

        <div className="w-px h-4 bg-zinc-800" />

        <span className="text-xs font-medium" style={{ color: trackColor }}>
          {trackName}
        </span>
        <span className="text-xs text-zinc-600">
          Bar {block.startBar + 1} · {block.durationBars} bar{block.durationBars !== 1 ? 's' : ''}
        </span>

        <div className="w-px h-4 bg-zinc-800" />

        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          title={snapEnabled ? 'Snap to grid (on)' : 'Snap to grid (off)'}
          className={`flex items-center gap-1 px-1.5 h-5 rounded text-[10px] font-medium transition-colors ${
            snapEnabled
              ? 'bg-indigo-600/30 text-indigo-300'
              : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Magnet size={10} />
          Snap
        </button>

        <select
          value={quantize}
          onChange={(e) => setQuantize(Number(e.target.value))}
          title="Grid resolution"
          className="h-5 px-1 rounded bg-zinc-800 text-[10px] text-zinc-300 border border-zinc-700 outline-none"
        >
          {QUANTIZE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5" title="Horizontal zoom (Alt+scroll sideways)">
          <span className="text-[10px] text-zinc-600">H</span>
          <input
            type="range"
            min={5}
            max={200}
            value={midiPixelsPerBeat}
            onChange={(e) => setMidiPixelsPerBeat(Number(e.target.value))}
            className="w-14 h-1 accent-indigo-500 cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-1.5" title="Vertical zoom (Alt+scroll)">
          <span className="text-[10px] text-zinc-600">V</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={midiRowScale}
            onChange={(e) => setMidiRowScale(Number(e.target.value))}
            className="w-14 h-1 accent-indigo-500 cursor-pointer"
          />
        </div>

      </div>

      {/* Piano roll grid */}
      <MidiEditor
        trackId={trackId}
        blockStartBeat={block.startBar * beatsPerBar}
        blockDurationBeats={blockDurationBeats}
        rows={rows}
        block={block}
        notes={notes}
        onNotesChange={setNotes}
        onCommit={commit}
        initialTotalBeats={initialTotalBeats}
        beatsPerBar={beatsPerBar}
        quantize={quantize}
        snapEnabled={snapEnabled}
        pixelsPerBeat={midiPixelsPerBeat}
        rowHeight={rowHeight}
      />
    </div>
  )
}
