'use client';

import { useCallback } from 'react';
import { Block, Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { MidiEditor, MidiNote, MidiRow } from '@daw/components/shared/MidiEditor';
import { QuantizeSelect } from '@daw/components/shared/QuantizeSelect';
import { useMidiEditorState } from '@daw/hooks/useMidiEditorState';
import { getAllEventsFromBlock, eventsToMidiNotesFixed, notesToEventsFixed } from '@daw/utils/midiConverters';
import { DEFAULT_QUANTIZE } from '@daw/core/constants';

interface RhythmEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
}

// Single row for rhythm (C4 = 60 as reference pitch)
const RHYTHM_PITCH = 60;

const RHYTHM_ROWS: MidiRow[] = [
  { pitch: RHYTHM_PITCH, label: 'Rhythm', color: '#F9A826' },
];

function extractRhythmFromBlock(block: Block): MidiNote[] {
  const allEvents = getAllEventsFromBlock(block).filter(e => e.pitch !== undefined);
  return eventsToMidiNotesFixed(allEvents, RHYTHM_PITCH, 'rhythm');
}

export function RhythmEditor({ block, track, beatsPerBar }: RhythmEditorProps) {
  const { updateBlock } = useProjectStore();

  const saveNotes = useCallback((notes: MidiNote[], trackId: string, blockId: string) => {
    const events = notesToEventsFixed(notes, RHYTHM_PITCH);
    updateBlock(trackId, blockId, { streams: [{ events }] });
  }, [updateBlock]);

  const { notes, setNotes, quantize, setQuantize, handleNotesChange, handleClear } = useMidiEditorState({
    block,
    track,
    extractNotes: extractRhythmFromBlock,
    saveNotes,
    defaultQuantize: DEFAULT_QUANTIZE,
  });

  const totalBeats = block.durationBars * beatsPerBar;

  // Fill all beats
  const handleFill = useCallback(() => {
    const newNotes: MidiNote[] = [];
    for (let i = 0; i < totalBeats; i += quantize) {
      newNotes.push({
        id: `rhythm-${i}-${Date.now()}`,
        pitch: RHYTHM_PITCH,
        time: i,
        duration: quantize,
        velocity: 100,
      });
    }
    setNotes(newNotes);
  }, [totalBeats, quantize, setNotes]);

  return (
    <div className="flex flex-col h-full" data-editor-panel="rhythm">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <QuantizeSelect value={quantize} onChange={setQuantize} />

        <button
          onClick={handleFill}
          className="px-3 py-1.5 bg-background border border-border text-foreground rounded-lg text-sm font-medium hover:bg-border transition-colors"
        >
          Fill All
        </button>

        <button
          onClick={handleClear}
          className="px-3 py-1.5 bg-background border border-border text-foreground rounded-lg text-sm font-medium hover:bg-border transition-colors"
        >
          Clear All
        </button>

        <div className="flex-1" />

        <span className="text-xs text-muted">
          {notes.length} trigger{notes.length === 1 ? '' : 's'} | Click + drag to draw
        </span>
      </div>

      {/* Midi editor with single row and larger row height */}
      <MidiEditor
        blockStartBeat={block.startBar * beatsPerBar}
        rows={RHYTHM_ROWS}
        notes={notes}
        onNotesChange={handleNotesChange}
        totalBeats={totalBeats}
        beatsPerBar={beatsPerBar}
        quantize={quantize}
        rowHeight={48}
      />
    </div>
  );
}
