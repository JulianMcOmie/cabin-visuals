'use client';

import { useCallback } from 'react';
import { Block, Track, DRUM_PITCHES, getDrumType } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { MidiEditor, MidiNote, MidiRow } from '@daw/components/shared/MidiEditor';
import { QuantizeSelect } from '@daw/components/shared/QuantizeSelect';
import { useMidiEditorState } from '@daw/hooks/useMidiEditorState';
import { getAllEventsFromBlock, eventsToMidiNotes, notesToEvents } from '@daw/utils/midiConverters';
import { DEFAULT_QUANTIZE } from '@daw/core/constants';

interface DrumEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
}

// Define rows using MidiRow format: { pitch, label, color }
const DRUM_ROWS: MidiRow[] = [
  { pitch: DRUM_PITCHES.hihat, label: 'HiHat', color: '#FFD93D' },
  { pitch: DRUM_PITCHES.clap, label: 'Clap', color: '#6BCB77' },
  { pitch: DRUM_PITCHES.snare, label: 'Snare', color: '#4D96FF' },
  { pitch: DRUM_PITCHES.kick, label: 'Kick', color: '#FF6B6B' },
];

function extractDrumsFromBlock(block: Block): MidiNote[] {
  const allEvents = getAllEventsFromBlock(block);
  const drumEvents = allEvents.filter(e => getDrumType(e.pitch) !== null);
  return eventsToMidiNotes(drumEvents, 'drum');
}

export function DrumEditor({ block, track, beatsPerBar }: DrumEditorProps) {
  const { updateBlockDrums } = useProjectStore();

  const saveNotes = useCallback((notes: MidiNote[], trackId: string, blockId: string) => {
    const events = notesToEvents(notes);
    updateBlockDrums(trackId, blockId, events);
  }, [updateBlockDrums]);

  const { notes, quantize, setQuantize, handleNotesChange, handleClear } = useMidiEditorState({
    block,
    track,
    extractNotes: extractDrumsFromBlock,
    saveNotes,
    defaultQuantize: DEFAULT_QUANTIZE,
  });

  const totalBeats = block.durationBars * beatsPerBar;

  return (
    <div className="flex flex-col h-full" data-editor-panel="drum">
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
          {notes.length} {notes.length === 1 ? 'hit' : 'hits'} | Click + drag to draw
        </span>
      </div>

      {/* Piano roll area using MidiEditor */}
      <MidiEditor
        blockStartBeat={block.startBar * beatsPerBar}
        rows={DRUM_ROWS}
        notes={notes}
        onNotesChange={handleNotesChange}
        totalBeats={totalBeats}
        beatsPerBar={beatsPerBar}
        quantize={quantize}
      />
    </div>
  );
}
