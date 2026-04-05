'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Block, Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { MidiEditor, MidiNote, generateRows } from '@daw/components/shared/MidiEditor';
import { QuantizeSelect } from '@daw/components/shared/QuantizeSelect';
import { useMidiEditorState } from '@daw/hooks/useMidiEditorState';
import { getInstrument } from '@daw/instruments';
import { getAllEventsFromBlock, eventsToMidiNotes, notesToEvents } from '@daw/utils/midiConverters';
import { DEFAULT_QUANTIZE } from '@daw/core/constants';

interface ChordEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
  instrumentId?: string;
}

function extractNotesFromBlock(block: Block): MidiNote[] {
  const allEvents = getAllEventsFromBlock(block);
  // Get all pitched events (not drum pitches - those are <24)
  const pitchedEvents = allEvents.filter(e => e.pitch !== undefined && e.pitch >= 24);
  return eventsToMidiNotes(pitchedEvents, 'note');
}

export function ChordEditor({ block, track, beatsPerBar, instrumentId }: ChordEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const { updateBlockEvents } = useProjectStore();

  const instrument = getInstrument(instrumentId);
  const rows = useMemo(() => generateRows(instrument?.noteRange), [instrument?.noteRange]);
  const rangeLabels = instrument?.rangeLabels;

  const saveNotes = useCallback((notes: MidiNote[], trackId: string, blockId: string) => {
    const events = notesToEvents(notes);
    updateBlockEvents(trackId, blockId, events);
  }, [updateBlockEvents]);

  const { notes, quantize, setQuantize, handleNotesChange, handleClear } = useMidiEditorState({
    block,
    track,
    extractNotes: extractNotesFromBlock,
    saveNotes,
    defaultQuantize: DEFAULT_QUANTIZE,
  });

  const totalBeats = block.durationBars * beatsPerBar;

  // Scroll to center of instrument range on mount
  useEffect(() => {
    if (hasScrolledRef.current || !containerRef.current) return;

    const scrollContainer = containerRef.current.querySelector('.overflow-auto');
    if (scrollContainer) {
      const rowHeight = 28;
      const range = instrument?.noteRange;
      // Center on the middle of the range, or C5 (72) as fallback
      const centerPitch = range ? Math.round((range.min + range.max) / 2) : 72;
      const centerIdx = rows.findIndex(r => r.pitch <= centerPitch);
      const targetIdx = centerIdx === -1 ? 0 : centerIdx;
      // Center the target row in the visible area
      const visibleHeight = scrollContainer.clientHeight;
      const scrollTop = Math.max(0, targetIdx * rowHeight - visibleHeight / 2);
      scrollContainer.scrollTop = scrollTop;
      hasScrolledRef.current = true;
    }
  }, [rows, instrument?.noteRange]);

  // Reset scroll flag when block changes
  useEffect(() => {
    hasScrolledRef.current = false;
  }, [block.id]);

  return (
    <div ref={containerRef} className="flex flex-col h-full" data-editor-panel="chord">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <QuantizeSelect value={quantize} onChange={setQuantize} />

        <button
          onClick={handleClear}
          className="px-3 py-1.5 bg-background border border-border text-foreground rounded-lg text-sm font-medium hover:bg-border transition-colors"
        >
          Clear All
        </button>

        <div className="flex-1" />

        <span className="text-xs text-muted">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'} | Click + drag to draw
        </span>
      </div>

      {/* Piano roll area using MidiEditor */}
      <MidiEditor
        blockStartBeat={block.startBar * beatsPerBar}
        rows={rows}
        notes={notes}
        onNotesChange={handleNotesChange}
        totalBeats={totalBeats}
        beatsPerBar={beatsPerBar}
        quantize={quantize}
        rangeLabels={rangeLabels}
      />
    </div>
  );
}
